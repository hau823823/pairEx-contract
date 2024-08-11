// SPDX-License-Identifier: MIT
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import '../interfaces/IStorageT.sol';
import '../interfaces/IPEXPairInfos.sol';
import '../interfaces/ICallbacks.sol';
import '../interfaces/INftRewards.sol';
import '../interfaces/IReferralStorage.sol';

pragma solidity 0.8.17;

contract PEXTradeRegisterV1_1 is Initializable {

    // Contracts (constant)
    IStorageT public storageT;
    INftRewards public nftRewards;
    IPEXPairInfos public pairInfos;
    ICallbacks public callbacks;

    // Params (constant)
    uint constant PRECISION = 1e10;  // 10 decimals

    event DevGovFeeCharged(address indexed trader, uint valueUsdt);
    event ClosingRolloverFeeCharged(address indexed trader, uint valueUsdt);

    function initialize(
        IStorageT _storageT,
        IPEXPairInfos _pairInfos,
        INftRewards _nftRewards,
        ICallbacks _callbacks
    ) external initializer{

        require(address(_storageT) != address(0)
            && address(_pairInfos) != address(0)
            && address(_nftRewards) != address(0)
            && address(_callbacks) != address(0), "WRONG_PARAMS");

        storageT = _storageT;
        pairInfos = _pairInfos;
        nftRewards = _nftRewards;
        callbacks = _callbacks;
    }

    // Modifiers
    modifier onlyCallbacks(){
        require(msg.sender == storageT.callbacks(), "CBSONLY");
        _;
    }

    // Shared code between market & limit callbacks
    function registerTrade(
        IStorageT.Trade memory trade, 
        uint nftId, 
        uint limitIndex
    ) external onlyCallbacks returns(IStorageT.Trade memory){

        IAggregator aggregator = storageT.priceAggregator();
        IPairsStorage pairsStored = aggregator.pairsStorage();

        ICallbacks.Values memory v;

        v.levPosUsdt = trade.positionSizeUsdt * trade.leverage;

        // Charge opening fee
        uint nftSaveP = trade.initialPosUSDT > 0 ? callbacks.nftPassSaveFeeP() : 0;

        v.reward2 = storageT.handleDevGovFees(trade.pairIndex, v.levPosUsdt);
        v.reward2 = v.reward2 - (v.reward2 * nftSaveP / PRECISION / 100);

        v.referralSaveFee = callbacks.referralStorage().distributeReferralAndSaveFee(trade.trader, v.levPosUsdt, v.reward2);
        storageT.handlePlatformFee(v.reward2 - v.referralSaveFee, callbacks.executionFee());

        trade.positionSizeUsdt = trade.positionSizeUsdt - v.reward2 - callbacks.executionFee();

        emit DevGovFeeCharged(trade.trader, v.reward2 + callbacks.executionFee());

        // Distribute NFT fee and send USDT amount to vault
        if(nftId < 1500){
            v.reward3 = 0;

            nftRewards.distributeNftReward(
                INftRewards.TriggeredLimitId(
                    trade.trader, trade.pairIndex, limitIndex, IStorageT.LimitOrder.OPEN
                ), v.reward3
            );

            storageT.increaseNftRewards(nftId, v.reward3);
        }

        // Set trade final details
        trade.index = storageT.firstEmptyTradeIndex(trade.trader, trade.pairIndex);

        trade.tp = correctTp(trade.openPrice, trade.leverage, trade.tp, trade.buy);
        trade.sl = correctSl(trade.openPrice, trade.leverage, trade.sl, trade.buy);

        // Store final trade in storage contract
        storageT.storeTrade(
            trade,
            IStorageT.TradeInfo(
                trade.positionSizeUsdt * trade.leverage,
                block.number,
                0,
                0,
                false
            )
        );

        // Call other contracts
        pairInfos.storeTradeInitialAccFees(trade.trader, trade.pairIndex, trade.index, trade.buy);
        pairsStored.updateGroupCollateral(trade.pairIndex, trade.positionSizeUsdt, trade.buy, true);
        storageT.increaseUpnlLastId();

        return trade;
    }

    function unregisterTrade(
        IStorageT.Trade memory trade,
        int percentProfit,   // PRECISION
        uint currentUsdtPos,
        uint initialUsdtPos,
        uint closingFeeUsdt
    ) external onlyCallbacks returns(uint usdtSentToTrader, ICallbacks.Fees memory fees){
        ICallbacks.Values memory v;
        
        fees.rolloverFee = pairInfos.getTradeRolloverFee(trade.trader, trade.pairIndex, trade.index, currentUsdtPos);
        fees.fundingFee = pairInfos.getTradeFundingFee(trade.trader, trade.pairIndex, trade.index, trade.buy, currentUsdtPos, trade.leverage);
        fees.closingFee = closingFeeUsdt * callbacks.usdtVaultFeeP() / 100;

        uint nftSaveP = trade.initialPosUSDT > 0 ? callbacks.nftPassSaveFeeP() : 0;
        fees.closingFee = fees.closingFee - (fees.closingFee * nftSaveP / PRECISION / 100);

        // Calculate net PnL (after all closing fees)
        (usdtSentToTrader, ) = pairInfos.getTradeValue(
            trade.trader,
            trade.pairIndex,
            trade.index,
            trade.buy,
            currentUsdtPos,
            trade.leverage,
            percentProfit,
            fees.closingFee
        );

        // If collateral in storage (opened after update)
        if(trade.positionSizeUsdt > 0){

            // rollover fee and closing fee to govAddr
            v.reward2 = fees.closingFee + fees.rolloverFee;
            v.levPosUsdt = currentUsdtPos * trade.leverage;
            v.referralSaveFee = callbacks.referralStorage().distributeReferralAndSaveFee(trade.trader, v.levPosUsdt, fees.closingFee);
            storageT.handlePlatformFee(v.reward2 - v.referralSaveFee, 0);
            
            emit ClosingRolloverFeeCharged(trade.trader, v.reward2);

            // Take USDT from vault if winning trade
            // or send USDT to vault if losing trade
            uint usdtLeftInStorage = currentUsdtPos - v.reward2;

            if(usdtSentToTrader > usdtLeftInStorage){
                callbacks.callVaultSendToTrader(usdtSentToTrader - usdtLeftInStorage, trade.trader);
                storageT.transferUsdt(address(storageT), trade.trader, usdtLeftInStorage);

            }else{
                callbacks.callSendToVault(usdtLeftInStorage - usdtSentToTrader, trade.trader); // funding fee & reward
                storageT.transferUsdt(address(storageT), trade.trader, usdtSentToTrader);
            }

        }else{
            callbacks.callVaultSendToTrader(usdtSentToTrader, trade.trader);
        }

        // Calls to other contracts
        storageT.priceAggregator().pairsStorage().updateGroupCollateral(
            trade.pairIndex, initialUsdtPos, trade.buy, false
        );

        // Unregister trade
        storageT.unregisterTrade(trade.trader, trade.pairIndex, trade.index);
        storageT.increaseUpnlLastId();
    }

    // utils
    function currentPercentProfit(
        uint openPrice,
        uint currentPrice,
        bool buy,
        uint leverage
    ) private view returns(int p){
        int maxPnlP = int(callbacks.MAX_GAIN_P()) * int(PRECISION);
        
        p = (buy ?
                int(currentPrice) - int(openPrice) :
                int(openPrice) - int(currentPrice)
            ) * 100 * int(PRECISION) * int(leverage) / int(openPrice);

        p = p > maxPnlP ? maxPnlP : p;
    }

    function correctTp(
        uint openPrice,
        uint leverage,
        uint tp,
        bool buy
    ) private view returns(uint){
        if(tp == 0
        || currentPercentProfit(openPrice, tp, buy, leverage) == int(callbacks.MAX_GAIN_P()) * int(PRECISION)){

            uint tpDiff = openPrice * callbacks.MAX_GAIN_P() / leverage / 100;

            return buy ? 
                openPrice + tpDiff :
                tpDiff <= openPrice ?
                    openPrice - tpDiff :
                0;
        }
        
        return tp;
    }
    function correctSl(
        uint openPrice,
        uint leverage,
        uint sl,
        bool buy
    ) private view returns(uint){
        if(sl > 0
        && currentPercentProfit(openPrice, sl, buy, leverage) < int(callbacks.MAX_SL_P()) * int(PRECISION) * -1){

            uint slDiff = openPrice * callbacks.MAX_SL_P() / leverage / 100;

            return buy ?
                openPrice - slDiff :
                openPrice + slDiff;
        }
        
        return sl;
    }

}