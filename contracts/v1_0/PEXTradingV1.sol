// SPDX-License-Identifier: MIT
import './Delegatable.sol';
import '../interfaces/ITokenV1.sol';
import '../interfaces/IPairsStorage.sol';
import '../interfaces/IStorageT.sol';
import '../interfaces/IPEXPairInfos.sol';
import '../interfaces/INftRewards.sol';
import '../interfaces/ICallbacks.sol';
import '../interfaces/IMonthPassNft.sol';

pragma solidity 0.8.17;

contract PEXTradingV1 is Delegatable {

    // Contracts (constant)
    IStorageT public immutable storageT;
    INftRewards public immutable nftRewards;
    IPEXPairInfos public immutable pairInfos;
    ICallbacks public immutable pexCallbacks;

    // Params (constant)
    uint constant PRECISION = 1e10;

    // Params (adjustable)
    uint public maxPosUsdt;           // eg. 500000 * 1e6
    uint public limitOrdersTimelock;  // block (eg. 30)
    uint public marketOrdersTimeout;  // block (eg. 30)

    // State
    bool public isPaused;  // Prevent opening new trades
    bool public isDone;    // Prevent any interaction with the contract

    // sl tp
    struct PnlLimits {
        uint minTpDist;
        uint maxTpDist;
        uint minSlDist;
        uint maxSlDist;
    }

    // Events
    event Done(bool done);
    event Paused(bool paused);

    event NumberUpdated(string name, uint value);

    event MarketOrderInitiated(
        uint indexed orderId,
        address indexed trader,
        uint indexed pairIndex,
        bool open
    );

    event OpenLimitPlaced(
        address indexed trader,
        uint indexed pairIndex,
        uint index
    );
    event OpenLimitUpdated(
        address indexed trader,
        uint indexed pairIndex,
        uint index,
        uint newPrice,
        uint newTp,
        uint newSl
    );
    event OpenLimitCanceled(
        address indexed trader,
        uint indexed pairIndex,
        uint index
    );

    event TpUpdated(
        address indexed trader,
        uint indexed pairIndex,
        uint index,
        uint newTp
    );
    event SlUpdated(
        address indexed trader,
        uint indexed pairIndex,
        uint index,
        uint newSl
    );
    event SlUpdateInitiated(
        uint indexed orderId,
        address indexed trader,
        uint indexed pairIndex,
        uint index,
        uint newSl
    );

    event NftOrderInitiated(
        uint orderId,
        address indexed nftHolder,
        address indexed trader,
        uint indexed pairIndex
    );
    event NftOrderSameBlock(
        address indexed nftHolder,
        address indexed trader,
        uint indexed pairIndex
    );

    event ChainlinkCallbackTimeout(
        uint indexed orderId,
        IStorageT.PendingMarketOrder order
    );
    event CouldNotCloseTrade(
        address indexed trader,
        uint indexed pairIndex,
        uint index
    );

    constructor(
        IStorageT _storageT,
        INftRewards _nftRewards,
        IPEXPairInfos _pairInfos,
        ICallbacks _callbacks,
        uint _maxPosUsdt,
        uint _limitOrdersTimelock,
        uint _marketOrdersTimeout
    ) {
        require(address(_storageT) != address(0)
            && address(_nftRewards) != address(0)
            && address(_pairInfos) != address(0)
            && address(_callbacks) != address(0)
            && _maxPosUsdt > 0
            && _limitOrdersTimelock > 0
            && _marketOrdersTimeout > 0, "WRONG_PARAMS");

        storageT = _storageT;
        nftRewards = _nftRewards;
        pairInfos = _pairInfos;
        pexCallbacks = _callbacks;

        maxPosUsdt = _maxPosUsdt;
        limitOrdersTimelock = _limitOrdersTimelock;
        marketOrdersTimeout = _marketOrdersTimeout;
    }

    // Modifiers
    modifier onlyGov(){
        require(msg.sender == storageT.gov(), "GOV_ONLY");
        _;
    }
    modifier notContract(){
        require(tx.origin == msg.sender);
        _;
    }
    modifier notDone(){
        require(!isDone, "DONE");
        _;
    }

    // Manage params
    function setMaxPosUsdt(uint value) external onlyGov{
        require(value > 0, "VALUE_0");
        maxPosUsdt = value;
        
        emit NumberUpdated("maxPosUsdt", value);
    }
    function setLimitOrdersTimelock(uint value) external onlyGov{
        require(value > 0, "VALUE_0");
        limitOrdersTimelock = value;
        
        emit NumberUpdated("limitOrdersTimelock", value);
    }
    function setMarketOrdersTimeout(uint value) external onlyGov{
        require(value > 0, "VALUE_0");
        marketOrdersTimeout = value;
        
        emit NumberUpdated("marketOrdersTimeout", value);
    }

    // Manage state
    function pause() external onlyGov{
        isPaused = !isPaused;

        emit Paused(isPaused);
    }
    function done() external onlyGov{
        isDone = !isDone;

        emit Done(isDone);
    }

    // Open new trade (MARKET/LIMIT)
    function openTrade(
        IStorageT.Trade memory t,
        INftRewards.OpenLimitOrderType orderType, // LEGACY => market
        uint slippageP, // for market orders only
        uint monthPassId
    ) external notContract notDone{

        require(!isPaused, "PAUSED");

        IAggregator aggregator = storageT.priceAggregator();
        IPairsStorage pairsStored = aggregator.pairsStorage();

        address sender = _msgSender();

        require(storageT.openTradesCount(sender, t.pairIndex)
            + storageT.pendingMarketOpenCount(sender, t.pairIndex)
            + storageT.openLimitOrdersCount(sender, t.pairIndex)
            < storageT.maxTradesPerPair(), 
            "MAX_TRADES_PER_PAIR");

        require(storageT.pendingOrderIdsCount(sender)
            < storageT.maxPendingMarketOrders(), 
            "MAX_PENDING_ORDERS");

        require(t.positionSizeUsdt * t.leverage <= maxPosUsdt, "ABOVE_MAX_POS");
        require(t.positionSizeUsdt * t.leverage
            >= pairsStored.pairMinLevPosUsdt(t.pairIndex), "BELOW_MIN_POS");

        require(t.leverage > 0 && t.leverage >= pairsStored.pairMinLeverage(t.pairIndex) 
            && t.leverage <= pairsStored.pairMaxLeverage(t.pairIndex), 
            "LEVERAGE_INCORRECT");

        PnlLimits memory pnlLimits;

        pnlLimits.minTpDist = t.openPrice * pexCallbacks.MIN_GAIN_P() / 100 / t.leverage;
        require(t.tp == 0 || (t.buy ?
            t.tp > t.openPrice + pnlLimits.minTpDist :
            t.tp < t.openPrice - pnlLimits.minTpDist), "TP_TOO_SMALL");

        pnlLimits.maxTpDist = t.openPrice * pexCallbacks.MAX_GAIN_P() / 100 / t.leverage;
        require(t.tp == 0 || (t.buy ? 
            t.tp <= t.openPrice + pnlLimits.maxTpDist :
            t.tp >= t.openPrice - pnlLimits.maxTpDist), "TP_TOO_BIG");

        pnlLimits.minSlDist = t.openPrice * pexCallbacks.MIN_SL_P() / 100 / t.leverage;
        require(t.sl == 0 || (t.buy ?
            t.sl < t.openPrice - pnlLimits.minSlDist:
            t.sl > t.openPrice + pnlLimits.minSlDist), "SL_TOO_SMALL");

        pnlLimits.maxSlDist = t.openPrice * pexCallbacks.MAX_SL_P() / 100 / t.leverage;
        require(t.sl == 0 || (t.buy ? 
            t.sl >= t.openPrice - pnlLimits.maxSlDist :
            t.sl <= t.openPrice + pnlLimits.maxSlDist), "SL_TOO_BIG");

        /*
        (uint priceImpactP, ) = pairInfos.getTradePriceImpact(
            0,
            t.pairIndex,
            t.buy,
            t.positionSizeUsdt * t.leverage
        );

        require(priceImpactP * t.leverage
            <= pairInfos.maxNegativePnlOnOpenP(), "PRICE_IMPACT_TOO_HIGH");
        */

        require(uint(orderType) >= 0 && uint(orderType) <= 1, "WRONG_ORDERTYPE");

        require(pexCallbacks.withinExposureLimits(
            t.pairIndex,
            t.buy,
            t.positionSizeUsdt,
            t.leverage), "OUT_EXPOSURELIMITS");
        
        // check nft used
        IMonthPassNft monthPassNft = storageT.monthPassNft();

        require(monthPassId == 0 
            || (monthPassNft.exists(monthPassId)
            && monthPassNft.isValidTokenId(monthPassId)
            && monthPassNft.isTokenIdExist(monthPassId)), "WRONG_PASSID");

        uint usedNft = 0;
        if(monthPassNft.balanceOf(sender, monthPassId) > 0 && monthPassNft.isUsable(monthPassId)){
            usedNft = 1;
        }

        storageT.transferUsdt(sender, address(storageT), t.positionSizeUsdt);

        if(orderType != INftRewards.OpenLimitOrderType.LEGACY){
            
            storeOpenLimitOrderAndEmit(sender, t, orderType, usedNft);
        }else{
            uint orderId = aggregator.getPrice(
                t.pairIndex, 
                IAggregator.OrderType.MARKET_OPEN, 
                t.positionSizeUsdt * t.leverage
            );

            storeMarketOrderAndEmit(orderId, sender, t, slippageP, usedNft);
        }
    }

    // avoid stack too deep
    function storeOpenLimitOrderAndEmit(
        address sender,
        IStorageT.Trade memory t,
        INftRewards.OpenLimitOrderType orderType,
        uint usedNft
    ) private {
        uint index = storageT.firstEmptyOpenLimitIndex(sender, t.pairIndex);

        storageT.storeOpenLimitOrder(
            IStorageT.OpenLimitOrder(
                sender,
                t.pairIndex,
                index,
                t.positionSizeUsdt,
                0,
                t.buy,
                t.leverage,
                t.tp,
                t.sl,
                t.openPrice,
                t.openPrice,
                block.number,
                usedNft // tokenid, use for nftPass
            )
        );

        nftRewards.setOpenLimitOrderType(sender, t.pairIndex, index, orderType);

        emit OpenLimitPlaced(
            sender,
            t.pairIndex,
            index
        );
    }

    function storeMarketOrderAndEmit(
        uint orderId,
        address sender,
        IStorageT.Trade memory t,
        uint slippageP,
        uint usedNft
    ) private {
        storageT.storePendingMarketOrder(
            IStorageT.PendingMarketOrder(
                IStorageT.Trade(
                    sender,
                    t.pairIndex,
                    0,
                    usedNft,
                    t.positionSizeUsdt,
                    0, 
                    t.buy,
                    t.leverage,
                    t.tp,
                    t.sl
                ),
                0,
                t.openPrice,
                slippageP,
                0,
                0
            ), orderId, true
        );

        emit MarketOrderInitiated(
            orderId,
            sender,
            t.pairIndex,
            true
        );
    }

    // Close trade (MARKET)
    function closeTradeMarket(
        uint pairIndex,
        uint index
    ) external notContract notDone{

        address sender = _msgSender();

        IStorageT.Trade memory t = storageT.openTrades(
            sender, pairIndex, index
        );

        IStorageT.TradeInfo memory i = storageT.openTradesInfo(
            sender, pairIndex, index
        );

        require(storageT.pendingOrderIdsCount(sender)
            < storageT.maxPendingMarketOrders(), "MAX_PENDING_ORDERS");

        require(!i.beingMarketClosed, "ALREADY_BEING_CLOSED");
        require(t.leverage > 0, "NO_TRADE");

        uint orderId = storageT.priceAggregator().getPrice(
            pairIndex, 
            IAggregator.OrderType.MARKET_CLOSE, 
            t.positionSizeUsdt * t.leverage
        );

        storageT.storePendingMarketOrder(
            IStorageT.PendingMarketOrder(
                IStorageT.Trade(
                    sender, pairIndex, index, 0, 0, 0, false, 0, 0, 0
                ),
                0, 0, 0, 0, 0
            ), orderId, false
        );

        emit MarketOrderInitiated(
            orderId,
            sender,
            pairIndex,
            false
        );
    }

    // Manage limit order (OPEN)
    function updateOpenLimitOrder(
        uint pairIndex, 
        uint index, 
        uint price,  // PRECISION
        uint tp,
        uint sl
    ) external notContract notDone{

        address sender = _msgSender();

        require(storageT.hasOpenLimitOrder(sender, pairIndex, index),
            "NO_LIMIT");

        IStorageT.OpenLimitOrder memory o = storageT.getOpenLimitOrder(
            sender, pairIndex, index
        );

        require(block.number - o.block >= limitOrdersTimelock, "LIMIT_TIMELOCK");

        PnlLimits memory pnlLimits;

        pnlLimits.minTpDist = price * pexCallbacks.MIN_GAIN_P() / 100 / o.leverage;
        require(tp == 0 || (o.buy ?
            tp > price + pnlLimits.minTpDist:
            tp < price - pnlLimits.minTpDist), "TP_TOO_SMALL");
        
        pnlLimits.maxTpDist = price * pexCallbacks.MAX_GAIN_P() / 100 / o.leverage;
        require(tp == 0 || (o.buy ? 
            tp <= price + pnlLimits.maxTpDist :
            tp >= price - pnlLimits.maxTpDist), "TP_TOO_BIG");

        pnlLimits.minSlDist = price * pexCallbacks.MIN_SL_P() / 100 / o.leverage;
        require(sl == 0 || (o.buy ?
            sl < price - pnlLimits.minSlDist :
            sl > price + pnlLimits.minSlDist), "SL_TOO_SMALL");

        pnlLimits.maxSlDist = price * pexCallbacks.MAX_SL_P() / 100 / o.leverage;
        require(sl == 0 || (o.buy ? 
            sl >= price - pnlLimits.maxSlDist :
            sl <= price + pnlLimits.maxSlDist), "SL_TOO_BIG");

        o.minPrice = price;
        o.maxPrice = price;

        o.tp = tp;
        o.sl = sl;

        storageT.updateOpenLimitOrder(o);

        emit OpenLimitUpdated(
            sender,
            pairIndex,
            index,
            price,
            tp,
            sl
        );
    }

    function cancelOpenLimitOrder(
        uint pairIndex,
        uint index
    ) external notContract notDone{

        address sender = _msgSender();

        require(storageT.hasOpenLimitOrder(sender, pairIndex, index),
            "NO_LIMIT");

        IStorageT.OpenLimitOrder memory o = storageT.getOpenLimitOrder(
            sender, pairIndex, index
        );

        require(block.number - o.block >= limitOrdersTimelock, "LIMIT_TIMELOCK");

        storageT.unregisterOpenLimitOrder(sender, pairIndex, index);
        storageT.transferUsdt(address(storageT), sender, o.positionSize);

        emit OpenLimitCanceled(
            sender,
            pairIndex,
            index
        );
    }

    // Manage limit order (TP/SL)
    function updateTp(
        uint pairIndex,
        uint index,
        uint newTp
    ) external notContract notDone{

        address sender = _msgSender();

        IStorageT.Trade memory t = storageT.openTrades(
            sender, pairIndex, index
        );

        IStorageT.TradeInfo memory i = storageT.openTradesInfo(
            sender, pairIndex, index
        );

        require(t.leverage > 0, "NO_TRADE");
        require(block.number - i.tpLastUpdated >= limitOrdersTimelock,
            "LIMIT_TIMELOCK");

        PnlLimits memory pnlLimits;

        pnlLimits.minTpDist = t.openPrice * pexCallbacks.MIN_GAIN_P() / 100 / t.leverage;
        require(newTp == 0 || (t.buy ?
                newTp > t.openPrice + pnlLimits.minTpDist :
                newTp < t.openPrice - pnlLimits.minTpDist), "TP_TOO_SMALL");

        pnlLimits.maxTpDist = t.openPrice * pexCallbacks.MAX_GAIN_P() / 100 / t.leverage;
        require(newTp == 0 || (t.buy ? 
            newTp <= t.openPrice + pnlLimits.maxTpDist :
            newTp >= t.openPrice - pnlLimits.maxTpDist), "TP_TOO_BIG");

        storageT.updateTp(sender, pairIndex, index, newTp);

        emit TpUpdated(
            sender,
            pairIndex,
            index,
            newTp
        );
    }

    function updateSl(
        uint pairIndex,
        uint index,
        uint newSl
    ) external notContract notDone{

        address sender = _msgSender();

        IStorageT.Trade memory t = storageT.openTrades(
            sender, pairIndex, index
        );

        IStorageT.TradeInfo memory i = storageT.openTradesInfo(
            sender, pairIndex, index
        );

        require(t.leverage > 0, "NO_TRADE");

        PnlLimits memory pnlLimits;

        pnlLimits.minSlDist = t.openPrice * pexCallbacks.MIN_SL_P() / 100 / t.leverage;
        require(newSl == 0 || (t.buy ?
                newSl < t.openPrice - pnlLimits.minSlDist :
                newSl > t.openPrice + pnlLimits.minSlDist), "SL_TOO_SMALL");

        uint maxSlDist = t.openPrice * pexCallbacks.MAX_SL_P() / 100 / t.leverage;
        require(newSl == 0 || (t.buy ? 
            newSl >= t.openPrice - maxSlDist :
            newSl <= t.openPrice + maxSlDist), "SL_TOO_BIG");
        
        require(block.number - i.slLastUpdated >= limitOrdersTimelock,
            "LIMIT_TIMELOCK");

        IAggregator aggregator = storageT.priceAggregator();

        if(newSl == 0
        || !aggregator.pairsStorage().guaranteedSlEnabled(pairIndex)){

            storageT.updateSl(sender, pairIndex, index, newSl);

            emit SlUpdated(
                sender,
                pairIndex,
                index,
                newSl
            );

        }else{
            uint orderId = aggregator.getPrice(
                pairIndex,
                IAggregator.OrderType.UPDATE_SL, 
                t.positionSizeUsdt * t.leverage
            );

            aggregator.storePendingSlOrder(
                orderId, 
                IAggregator.PendingSl(
                    sender, pairIndex, index, t.openPrice, t.buy, newSl
                )
            );
            
            emit SlUpdateInitiated(
                orderId,
                sender,
                pairIndex,
                index,
                newSl
            );
        }
    }

    // Execute limit order
    function executeNftOrder(
        IStorageT.LimitOrder orderType, 
        address trader, 
        uint pairIndex, 
        uint index,
        uint nftId
    ) external notContract notDone{

        address sender = _msgSender();

        require(storageT.isBotListed(sender), "NOT_IN_BOTLISTS");

        require(block.number >=
            storageT.nftLastSuccess(nftId) + storageT.nftSuccessTimelock(),
            "SUCCESS_TIMELOCK");

        IStorageT.Trade memory t;

        if(orderType == IStorageT.LimitOrder.OPEN){
            require(storageT.hasOpenLimitOrder(trader, pairIndex, index),
                "NO_LIMIT");

            IStorageT.OpenLimitOrder memory l = storageT.getOpenLimitOrder(
                trader, pairIndex, index
            );
            require(pexCallbacks.withinExposureLimits(
                pairIndex,
                l.buy,
                l.positionSize,
                l.leverage), "OUT_EXPOSURELIMITS");

        }else{
            t = storageT.openTrades(trader, pairIndex, index);

            require(t.leverage > 0, "NO_TRADE");

            if(orderType == IStorageT.LimitOrder.LIQ){
                uint liqPrice = getTradeLiquidationPrice(t);
                
                require(t.sl == 0 || (t.buy ?
                    liqPrice > t.sl :
                    liqPrice < t.sl), "HAS_SL");

            }else{
                require(orderType != IStorageT.LimitOrder.SL || t.sl > 0,
                    "NO_SL");
                require(orderType != IStorageT.LimitOrder.TP || t.tp > 0,
                    "NO_TP");
            }
        }

        INftRewards.TriggeredLimitId memory triggeredLimitId =
            INftRewards.TriggeredLimitId(
                trader, pairIndex, index, orderType
            );

        if(!nftRewards.triggered(triggeredLimitId)
        || nftRewards.timedOut(triggeredLimitId)){
            
            uint leveragedPosUsdt;

            if(orderType == IStorageT.LimitOrder.OPEN){

                IStorageT.OpenLimitOrder memory l = storageT.getOpenLimitOrder(
                    trader, pairIndex, index
                );

                leveragedPosUsdt = l.positionSize * l.leverage;

                /*
                (uint priceImpactP, ) = pairInfos.getTradePriceImpact(
                    0,
                    l.pairIndex,
                    l.buy,
                    leveragedPosUsdt
                );
                
                require(priceImpactP * l.leverage <= pairInfos.maxNegativePnlOnOpenP(),
                    "PRICE_IMPACT_TOO_HIGH");
                */

            }else{
                leveragedPosUsdt = t.positionSizeUsdt * t.leverage;
            }

            storageT.transferLinkToAggregator(sender, pairIndex, leveragedPosUsdt);

            uint orderId = storageT.priceAggregator().getPrice(
                pairIndex, 
                orderType == IStorageT.LimitOrder.OPEN ? 
                    IAggregator.OrderType.LIMIT_OPEN : 
                    IAggregator.OrderType.LIMIT_CLOSE,
                leveragedPosUsdt
            );

            storageT.storePendingNftOrder(
                IStorageT.PendingNftOrder(
                    sender,
                    nftId,
                    trader,
                    pairIndex,
                    index,
                    orderType
                ), orderId
            );

            nftRewards.storeFirstToTrigger(triggeredLimitId, sender);
            
            emit NftOrderInitiated(
                orderId,
                sender,
                trader,
                pairIndex
            );

        }else{
            nftRewards.storeTriggerSameBlock(triggeredLimitId, sender);
            
            emit NftOrderSameBlock(
                sender,
                trader,
                pairIndex
            );
        }
    }
    // Avoid stack too deep error in executeNftOrder
    function getTradeLiquidationPrice(
        IStorageT.Trade memory t
    ) private view returns(uint){
        return pairInfos.getTradeLiquidationPrice(
            t.trader,
            t.pairIndex,
            t.index,
            t.openPrice,
            t.buy,
            t.positionSizeUsdt,
            t.leverage
        );
    }

    // Market timeout
    function openTradeMarketTimeout(uint _order) external notContract notDone{
        address sender = _msgSender();

        IStorageT.PendingMarketOrder memory o =
            storageT.reqID_pendingMarketOrder(_order);

        IStorageT.Trade memory t = o.trade;

        require(o.block > 0
            && block.number >= o.block + marketOrdersTimeout, "WAIT_TIMEOUT");

        require(t.trader == sender, "NOT_YOUR_ORDER");
        require(t.leverage > 0, "WRONG_MARKET_ORDER_TYPE");

        storageT.unregisterPendingMarketOrder(_order, true);
        storageT.transferUsdt(address(storageT), sender, t.positionSizeUsdt);

        emit ChainlinkCallbackTimeout(
            _order,
            o
        );
    }
    
    function closeTradeMarketTimeout(uint _order) external notContract notDone{
        address sender = _msgSender();

        IStorageT.PendingMarketOrder memory o =
            storageT.reqID_pendingMarketOrder(_order);

        IStorageT.Trade memory t = o.trade;

        require(o.block > 0
            && block.number >= o.block + marketOrdersTimeout, "WAIT_TIMEOUT");

        require(t.trader == sender, "NOT_YOUR_ORDER");
        require(t.leverage == 0, "WRONG_MARKET_ORDER_TYPE");

        storageT.unregisterPendingMarketOrder(_order, false);

        (bool success, ) = address(this).delegatecall(
            abi.encodeWithSignature(
                "closeTradeMarket(uint256,uint256)",
                t.pairIndex,
                t.index
            )
        );

        if(!success){
            emit CouldNotCloseTrade(
                sender,
                t.pairIndex,
                t.index
            );
        }

        emit ChainlinkCallbackTimeout(
            _order,
            o
        );
    }
}