// SPDX-License-Identifier: MIT
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import '../interfaces/IStorageT.sol';
import '../interfaces/IPEXPairInfos.sol';
import '../interfaces/INftRewards.sol';
import '../interfaces/IReferralStorage.sol';
import '../interfaces/ITradeRegister.sol';

pragma solidity 0.8.17;

contract PEXTradingCallbacksV1 is Initializable {
    using SafeERC20 for IERC20;

    // Contracts (constant)
    IStorageT public storageT;
    INftRewards public nftRewards;
    IPEXPairInfos public pairInfos;

    // Params (constant)
    uint constant PRECISION = 1e10;  // 10 decimals

    // Params (adjustable)
    uint public usdtVaultFeeP;  // % of closing fee going to USDT vault (eg. 40)
    uint public lpFeeP;        // % of closing fee going to PEX/USDT LPs (eg. 20)
    uint public sssFeeP;       // % of closing fee going to PEX staking (eg. 40)

    // State
    bool public isPaused;  // Prevent opening new trades
    bool public isDone;    // Prevent any interaction with the contract

    uint public MAX_SL_P;     // -75% PNL
    uint public MIN_SL_P;
    uint public MAX_GAIN_P;  // 900% PnL (10x)
    uint public MIN_GAIN_P;

    IReferralStorage public referralStorage;

    // execution Fee
    uint public executionFee; // 1e6
    uint public nftPassSaveFeeP; // % of save fee

    // Custom data types
    struct AggregatorAnswer{
        uint orderId;
        uint price;
        uint spreadP;
    }

    // Useful to avoid stack too deep errors
    struct Values{
        uint posUsdt; 
        uint levPosUsdt; 
        int profitP; 
        uint price;
        uint liqPrice;
        uint usdtSentToTrader;
        uint reward1;
        uint reward2;
        uint reward3;
        uint referralSaveFee;
    }

    // Events
    event MarketExecuted(
        uint indexed orderId,
        address indexed trader,
        IStorageT.Trade t,
        bool open,
        uint price,
        uint priceImpactP,
        uint positionSizeUsdt,
        int percentProfit,
        uint usdtSentToTrader,
        uint rolloverFee,
        int fundingFee,
        uint fee,
        uint executionFee
    );
    
    event LimitExecuted(
        uint indexed orderId,
        address indexed trader,
        uint limitIndex,
        IStorageT.Trade t,
        address indexed nftHolder,
        IStorageT.LimitOrder orderType,
        uint price,
        uint priceImpactP,
        uint positionSizeUsdt,
        int percentProfit,
        uint usdtSentToTrader,
        uint rolloverFee,
        int fundingFee,
        uint fee,
        uint executionFee
    );

    event MarketOpenCanceled(
        uint indexed orderId,
        address indexed trader,
        uint indexed pairIndex
    );
    event MarketCloseCanceled(
        uint indexed orderId,
        address indexed trader,
        uint indexed pairIndex,
        uint index
    );

    event SlUpdated(
        uint indexed orderId,
        address indexed trader,
        uint indexed pairIndex,
        uint index,
        uint newSl
    );
    event SlCanceled(
        uint indexed orderId,
        address indexed trader,
        uint indexed pairIndex,
        uint index
    );
    
    event Pause(bool paused);
    event Done(bool done);

    event DevGovFeeCharged(address indexed trader, uint valueUsdt);
    event ClosingRolloverFeeCharged(address indexed trader, uint valueUsdt);

    event AddressUpdated(string name, address a);
    event NumberUpdated(string name, uint value);

    event SLTPParamsUpdaated(uint maxSL, uint minSL, uint maxTP, uint minTP);

    function initialize(
        IStorageT _storageT,
        INftRewards _nftRewards,
        IPEXPairInfos _pairInfos,
        address vaultToApprove,
        uint _usdtVaultFeeP,
        uint _lpFeeP,
        uint _sssFeeP,
        uint _max_sl_p,
        uint _min_sl_p,
        uint _max_gain_p,
        uint _min_gain_p
    ) external initializer{
        require(address(_storageT) != address(0)
            && address(_nftRewards) != address(0)
            && address(_pairInfos) != address(0)
            && _usdtVaultFeeP + _lpFeeP + _sssFeeP == 100
            && _max_sl_p > 0 && _min_sl_p >= 0 && _max_gain_p > 0 && _min_gain_p >= 0, "WRONG_PARAMS");

        storageT = _storageT;
        nftRewards = _nftRewards;
        pairInfos = _pairInfos;

        usdtVaultFeeP = _usdtVaultFeeP;
        lpFeeP = _lpFeeP;
        sssFeeP = _sssFeeP;

        MAX_SL_P = _max_sl_p;
        MIN_SL_P = _min_sl_p;
        MAX_GAIN_P = _max_gain_p;
        MIN_GAIN_P = _min_gain_p;

        storageT.usdt().safeApprove(vaultToApprove, type(uint256).max);
    }

    // Modifiers
    modifier onlyGov(){
        require(msg.sender == storageT.gov(), "GOV_ONLY");
        _;
    }
    modifier onlyPriceAggregator(){
        require(msg.sender == address(storageT.priceAggregator()), "AGGREGATOR_ONLY");
        _;
    }
    modifier onlyAdlCallbacksAndRegister(){
        require(msg.sender == storageT.adlCallbacks() 
            || msg.sender == address(storageT.tradeRegister()), "CBSONLY");
        _;
    }
    modifier notDone(){
        require(!isDone, "DONE");
        _;
    }

    function setReferralStorage(address _referralStorage) external onlyGov {
        require(_referralStorage != address(0));
        referralStorage = IReferralStorage(_referralStorage);
        emit AddressUpdated("referralStorage", _referralStorage);
    }

    function setPairInfos(address _pairInfos) external onlyGov{
        require(_pairInfos != address(0));
        pairInfos = IPEXPairInfos(_pairInfos);
        emit AddressUpdated("pairInfos", _pairInfos);
    }

    function setNftRewards(address _nftRewards) external onlyGov{
        require(_nftRewards != address(0));
        nftRewards = INftRewards(_nftRewards);
        emit AddressUpdated("nftRewards", _nftRewards);
    }

    function setSLTP(uint _max_sl_p, uint _min_sl_p, uint _max_gain_p, uint _min_gain_p) external onlyGov{
        require(_max_sl_p > 0 && _min_sl_p >= 0 && _max_gain_p > 0 && _min_gain_p >= 0, "WRONG_PARAM");
        MAX_SL_P = _max_sl_p;
        MIN_SL_P = _min_sl_p;
        MAX_GAIN_P = _max_gain_p;
        MIN_GAIN_P = _min_gain_p;
        emit SLTPParamsUpdaated(_max_sl_p, _min_sl_p, _max_gain_p, _min_gain_p);
    }

    // Manage params
    function setClosingFeeSharesP(
        uint _usdtVaultFeeP,
        uint _lpFeeP,
        uint _sssFeeP
    ) external onlyGov{
        require(_usdtVaultFeeP + _lpFeeP + _sssFeeP == 100, "SUM_NOT_100");
        
        usdtVaultFeeP = _usdtVaultFeeP;
        lpFeeP = _lpFeeP;
        sssFeeP = _sssFeeP;
    }

    // execution fee should not loarger than collateral - open fee (collateral are decided on minPos/maxLev)
    function setExecutionFee(uint _executionFee) external onlyGov{
        executionFee = _executionFee;
        emit NumberUpdated("ExecutionFee", _executionFee);
    }

    function setNftPassSaveFeeP(uint _nftPassSaveFeeP) external onlyGov{
        require(_nftPassSaveFeeP <= 100 * PRECISION && _nftPassSaveFeeP >= 0, "WRONG_PARAMS");

        nftPassSaveFeeP = _nftPassSaveFeeP;

        emit NumberUpdated("nftPassSaveFeeP", _nftPassSaveFeeP);
    }

    // Manage state
    function pause() external onlyGov{
        isPaused = !isPaused;

        emit Pause(isPaused); 
    }
    function done() external onlyGov{
        isDone = !isDone;

        emit Done(isDone); 
    }

    // Callbacks
    function openTradeMarketCallback(
        AggregatorAnswer memory a
    ) external onlyPriceAggregator notDone{

        ITradeRegister tradeRegister = storageT.tradeRegister();

        IStorageT.PendingMarketOrder memory o = 
            storageT.reqID_pendingMarketOrder(a.orderId);

        if(o.block == 0){ return; }
        
        IStorageT.Trade memory t = o.trade;

        t.openPrice = a.price;

        uint maxSlippage = o.wantedPrice * o.slippageP / 100 / PRECISION;

        uint nftSaveP = t.initialPosUSDT > 0 ? nftPassSaveFeeP : 0;

        if(isPaused || a.price == 0
        || (t.buy ?
            t.openPrice > o.wantedPrice + maxSlippage :
            t.openPrice < o.wantedPrice - maxSlippage)
        || (t.tp > 0 && (t.buy ?
            t.openPrice >= t.tp :
            t.openPrice <= t.tp))
        || (t.sl > 0 && (t.buy ?
            t.openPrice <= t.sl :
            t.openPrice >= t.sl))
        || !withinExposureLimits(t.pairIndex, t.buy, t.positionSizeUsdt, t.leverage)){

            uint devGovFeesUsdt = storageT.handleDevGovFees(
                t.pairIndex, 
                t.positionSizeUsdt * t.leverage
            );

            devGovFeesUsdt = devGovFeesUsdt - (devGovFeesUsdt * nftSaveP / PRECISION / 100);
            storageT.handlePlatformFee(devGovFeesUsdt, executionFee);
            storageT.transferUsdt(
                address(storageT),
                t.trader,
                t.positionSizeUsdt - devGovFeesUsdt - executionFee
            );

            emit DevGovFeeCharged(t.trader, devGovFeesUsdt + executionFee);

            emit MarketOpenCanceled(
                a.orderId,
                t.trader,
                t.pairIndex
            );

        }else{
            uint devGovFeesUsdt = storageT.handleDevGovFees(t.pairIndex, t.positionSizeUsdt * t.leverage);
            devGovFeesUsdt = devGovFeesUsdt - (devGovFeesUsdt * nftSaveP / PRECISION / 100);

            IStorageT.Trade memory finalTrade = tradeRegister.registerTrade(
                t, 1500, 0
            );

            emit MarketExecuted(
                a.orderId,
                finalTrade.trader,
                finalTrade,
                true,
                finalTrade.openPrice,
                0, //priceImpactP,
                finalTrade.positionSizeUsdt,
                0,
                0,
                0,
                0,
                devGovFeesUsdt,
                executionFee
            );
        }

        storageT.unregisterPendingMarketOrder(a.orderId, true);
    }

    function closeTradeMarketCallback(
        AggregatorAnswer memory a
    ) external onlyPriceAggregator notDone{
        
        IStorageT.PendingMarketOrder memory o = storageT.reqID_pendingMarketOrder(
            a.orderId
        );

        if(o.block == 0){ return; }

        IStorageT.Trade memory t = storageT.openTrades(
            o.trade.trader, o.trade.pairIndex, o.trade.index
        );

        if(t.leverage > 0){
            IStorageT.TradeInfo memory i = storageT.openTradesInfo(
                t.trader, t.pairIndex, t.index
            );
            
            Values memory v;

            v.levPosUsdt = t.positionSizeUsdt * t.leverage;

            if(a.price == 0){

                // Dev / gov rewards to pay for oracle cost
                // Charge in USDT if collateral in storage or token if collateral in vault
                v.reward1 = storageT.handleDevGovFees(
                        t.pairIndex,
                        v.levPosUsdt
                    );
                v.reward1 = t.initialPosUSDT > 0 ? 
                    v.reward1 - (v.reward1 * nftPassSaveFeeP * PRECISION / 100) : v.reward1;
                
                storageT.handlePlatformFee(v.reward1, 0);

                t.positionSizeUsdt -= v.reward1;
                storageT.updateTrade(t);

                emit DevGovFeeCharged(t.trader, v.reward1);

                emit MarketCloseCanceled(
                    a.orderId,
                    t.trader,
                    t.pairIndex,
                    t.index
                );

            }else{
                closeTradeMarketUnregisterAndEmit(a, v, t, i);
            }
        }

        storageT.unregisterPendingMarketOrder(a.orderId, false);
    }

    // avoid stack too deep
    function closeTradeMarketUnregisterAndEmit(
        AggregatorAnswer memory a,
        Values memory v,
        IStorageT.Trade memory t,
        IStorageT.TradeInfo memory i
    ) private {
        IAggregator aggregator = storageT.priceAggregator();
        IPairsStorage pairsStorage = aggregator.pairsStorage();

        v.profitP = currentPercentProfit(t.openPrice, a.price, t.buy, t.leverage);
        v.posUsdt = v.levPosUsdt / t.leverage;
                
        ITradeRegister.Fees memory fees;

        (v.usdtSentToTrader, fees) = storageT.tradeRegister().unregisterTrade(
            t,
            v.profitP,
            v.posUsdt,
            i.openInterestUsdt / t.leverage,
            v.levPosUsdt * pairsStorage.pairCloseFeeP(t.pairIndex) / 100 / PRECISION
        );

        emit MarketExecuted(
            a.orderId,
            t.trader,
            t,
            false,
            a.price,
            0,
            v.posUsdt,
            eventPercentProfit(v.posUsdt, v.usdtSentToTrader),
            v.usdtSentToTrader,
            fees.rolloverFee,
            fees.fundingFee,
            fees.closingFee,
            0
        );
    }

    function executeNftOpenOrderCallback(
        AggregatorAnswer memory a
    ) external onlyPriceAggregator notDone{

        IStorageT.PendingNftOrder memory n = storageT.reqID_pendingNftOrder(a.orderId);

        if(!isPaused && a.price > 0
        && storageT.hasOpenLimitOrder(n.trader, n.pairIndex, n.index)
        && block.number >= storageT.nftLastSuccess(n.nftId) + storageT.nftSuccessTimelock()){

            IStorageT.OpenLimitOrder memory o = storageT.getOpenLimitOrder(
                n.trader, n.pairIndex, n.index
            );

            INftRewards.OpenLimitOrderType t = nftRewards.openLimitOrderTypes(
                n.trader, n.pairIndex, n.index
            );

            if((t == INftRewards.OpenLimitOrderType.LEGACY ?
                    (a.price >= o.minPrice && a.price <= o.maxPrice) :
                t == INftRewards.OpenLimitOrderType.REVERSAL ?
                    (o.buy ?
                        a.price <= o.maxPrice :
                        a.price >= o.minPrice) :
                    (o.buy ?
                        a.price >= o.minPrice :
                        a.price <= o.maxPrice))
                && withinExposureLimits(o.pairIndex, o.buy, o.positionSize, o.leverage)){

                if(o.buy){
                    o.maxPrice = a.price < o.maxPrice ? a.price : o.maxPrice ;
                } else {
                    o.maxPrice = a.price > o.maxPrice ? a.price : o.maxPrice ;
                }

                executeNftOpenOrderRegisterAndEmit(t, o, a, n);
            }
        }

        nftRewards.unregisterTrigger(
            INftRewards.TriggeredLimitId(n.trader, n.pairIndex, n.index, n.orderType)
        );

        storageT.unregisterPendingNftOrder(a.orderId);
    }

    // avoid stack too deep
    function executeNftOpenOrderRegisterAndEmit(
        INftRewards.OpenLimitOrderType t,
        IStorageT.OpenLimitOrder memory o, 
        AggregatorAnswer memory a,
        IStorageT.PendingNftOrder memory n
    ) private{
        ITradeRegister tradeRegister = storageT.tradeRegister();

        IStorageT.Trade memory finalTrade = tradeRegister.registerTrade(
            IStorageT.Trade(
                o.trader,
                o.pairIndex,
                0,
                o.tokenId, // initialposition, use or not use nft
                o.positionSize,
                t == INftRewards.OpenLimitOrderType.REVERSAL ?
                    o.maxPrice : // o.minPrice = o.maxPrice in that case
                    a.price,
                o.buy,
                o.leverage,
                o.tp,
                o.sl
            ), 
            n.nftId, // old logic, fix value
            n.index
        );
                
        uint devGovFeesUsdt = storageT.handleDevGovFees(o.pairIndex, o.positionSize * o.leverage);
        devGovFeesUsdt = finalTrade.initialPosUSDT > 0 ?
            devGovFeesUsdt - (devGovFeesUsdt * nftPassSaveFeeP / PRECISION / 100) : devGovFeesUsdt;

        storageT.unregisterOpenLimitOrder(o.trader, o.pairIndex, o.index);

        emit LimitExecuted(
            a.orderId,
            finalTrade.trader,
            n.index,
            finalTrade,
            n.nftHolder,
            IStorageT.LimitOrder.OPEN,
            finalTrade.openPrice,
            0, //priceImpactP,
            finalTrade.positionSizeUsdt,
            0,
            0,
            0,
            0,
            devGovFeesUsdt,
            executionFee
        );  
    }

    function executeNftCloseOrderCallback(
        AggregatorAnswer memory a
    ) external onlyPriceAggregator notDone{
        
        IStorageT.PendingNftOrder memory o = storageT.reqID_pendingNftOrder(a.orderId);

        IStorageT.Trade memory t = storageT.openTrades(
            o.trader, o.pairIndex, o.index
        );

        IAggregator aggregator = storageT.priceAggregator();

        if(a.price > 0 && t.leverage > 0
        && block.number >= storageT.nftLastSuccess(o.nftId) + storageT.nftSuccessTimelock()){

            IStorageT.TradeInfo memory i = storageT.openTradesInfo(
                t.trader, t.pairIndex, t.index
            );

            IPairsStorage pairsStored = aggregator.pairsStorage();
            
            Values memory v;

            v.price =
                pairsStored.guaranteedSlEnabled(t.pairIndex) ?
                    o.orderType == IStorageT.LimitOrder.TP ?
                        t.tp : 
                    o.orderType == IStorageT.LimitOrder.SL ?
                        t.sl :
                    a.price :
                a.price;

            v.profitP = currentPercentProfit(t.openPrice, v.price, t.buy, t.leverage);
            v.levPosUsdt = t.positionSizeUsdt * t.leverage;
            v.posUsdt = v.levPosUsdt / t.leverage;

            if(o.orderType == IStorageT.LimitOrder.LIQ){

                v.liqPrice = pairInfos.getTradeLiquidationPrice(
                    t.trader,
                    t.pairIndex,
                    t.index,
                    t.openPrice,
                    t.buy,
                    v.posUsdt,
                    t.leverage
                );

                // NFT reward in USDT
                v.reward1 = (t.buy ?
                        a.price <= v.liqPrice :
                        a.price >= v.liqPrice
                    ) ?
                        v.posUsdt * 5 / 100 : 0;

            }else{

                // NFT reward in USDT
                v.reward1 =
                    (o.orderType == IStorageT.LimitOrder.TP && t.tp > 0 &&
                        (t.buy ?
                            a.price >= t.tp :
                            a.price <= t.tp)
                    ||
                    o.orderType == IStorageT.LimitOrder.SL && t.sl > 0 &&
                        (t.buy ?
                            a.price <= t.sl :
                            a.price >= t.sl)
                    ) ? 1 : 0;
            }

            // If can be triggered
            if(v.reward1 > 0){
                executeNftCloseOrderUnregisterAndEmit(a, t, v, i, o);  
            }
        }

        nftRewards.unregisterTrigger(
            INftRewards.TriggeredLimitId(o.trader, o.pairIndex, o.index, o.orderType)
        );

        storageT.unregisterPendingNftOrder(a.orderId);
    }

    // avoid stack too deep
    function executeNftCloseOrderUnregisterAndEmit(
        AggregatorAnswer memory a,
        IStorageT.Trade memory t,
        Values memory v,
        IStorageT.TradeInfo memory i,
        IStorageT.PendingNftOrder memory o
    ) private {
        
        ITradeRegister.Fees memory fees;
        
        (v.usdtSentToTrader, fees) = storageT.tradeRegister().unregisterTrade(
            t,
            v.profitP,
            v.posUsdt,
            i.openInterestUsdt / t.leverage,
            v.levPosUsdt * storageT.priceAggregator().pairsStorage().pairCloseFeeP(t.pairIndex) / 100 / PRECISION
        );

        nftRewards.distributeNftReward(INftRewards.TriggeredLimitId(o.trader, o.pairIndex, o.index, o.orderType), 0);
        storageT.increaseNftRewards(o.nftId, 0);

        emit LimitExecuted(
            a.orderId,
            t.trader,
            o.index,
            t,
            o.nftHolder,
            o.orderType,
            v.price,
            0,
            v.posUsdt,
            eventPercentProfit(v.posUsdt, v.usdtSentToTrader),
            v.usdtSentToTrader,
            fees.rolloverFee,
            fees.fundingFee,
            fees.closingFee,
            0
        );
    }

    function updateSlCallback(
        AggregatorAnswer memory a
    ) external onlyPriceAggregator notDone{
        
        IAggregator aggregator = storageT.priceAggregator();
        IAggregator.PendingSl memory o = aggregator.pendingSlOrders(a.orderId);
        
        IStorageT.Trade memory t = storageT.openTrades(
            o.trader, o.pairIndex, o.index
        );

        if(t.leverage > 0){

            Values memory v;
            v.levPosUsdt = t.positionSizeUsdt * t.leverage / 4;

            v.reward1 = storageT.handleDevGovFees(
                    t.pairIndex,
                    v.levPosUsdt
                );
            storageT.handlePlatformFee(v.reward1, 0);
            t.positionSizeUsdt -= v.reward1;
            storageT.updateTrade(t);

            emit DevGovFeeCharged(t.trader, v.reward1);

            if(a.price > 0 && t.buy == o.buy && t.openPrice == o.openPrice
            && (t.buy ?
                o.newSl <= a.price :
                o.newSl >= a.price)
            ){
                storageT.updateSl(o.trader, o.pairIndex, o.index, o.newSl);

                emit SlUpdated(
                    a.orderId,
                    o.trader,
                    o.pairIndex,
                    o.index,
                    o.newSl
                );
                
            }else{
                emit SlCanceled(
                    a.orderId,
                    o.trader,
                    o.pairIndex,
                    o.index
                );
            }
        }

        aggregator.unregisterPendingSlOrder(a.orderId);
    }

    // Utils
    function withinExposureLimits(
        uint pairIndex,
        bool buy,
        uint positionSizeUsdt,
        uint leverage
    ) public view returns(bool){
        IPairsStorage pairsStored = storageT.priceAggregator().pairsStorage();
        
        return storageT.openInterestUsdt(pairIndex, buy ? 0 : 1)
            + positionSizeUsdt * leverage <= storageT.openInterestUsdt(pairIndex, 2)
            && pairsStored.groupCollateral(pairIndex, buy)
            + positionSizeUsdt <= pairsStored.groupMaxCollateral(pairIndex);
    }
    function currentPercentProfit(
        uint openPrice,
        uint currentPrice,
        bool buy,
        uint leverage
    ) private view returns(int p){
        int maxPnlP = int(MAX_GAIN_P) * int(PRECISION);
        
        p = (buy ?
                int(currentPrice) - int(openPrice) :
                int(openPrice) - int(currentPrice)
            ) * 100 * int(PRECISION) * int(leverage) / int(openPrice);

        p = p > maxPnlP ? maxPnlP : p;
    }
    function eventPercentProfit(
        uint positionSizeUsdt,
        uint usdtSentToTrader
    ) private pure returns(int p){ // PRECISION (%)
        require(positionSizeUsdt > 0, "WRONG_PARAMS");
        int pnl = int(usdtSentToTrader) - int(positionSizeUsdt);
        p = pnl * 100 * int(PRECISION) / int(positionSizeUsdt);
    }

    function sendToVault(uint amountUsdt, address trader) private{
        storageT.transferUsdt(address(storageT), address(this), amountUsdt);
        storageT.vault().receiveAssets(amountUsdt, trader);
    }

    // for adlcallbacks and TraderResiter
    function callSendToVault(uint amountUsdt, address trader) external onlyAdlCallbacksAndRegister{
        sendToVault(amountUsdt, trader);
    }

    function callVaultSendToTrader(uint amountUsdt, address trader) external onlyAdlCallbacksAndRegister{
        storageT.vault().sendAssets(amountUsdt, trader);
    }
}