// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import '../interfaces/IStorageT.sol';
import '../interfaces/IPEXPairInfos.sol';
import '../interfaces/ICallbacks.sol';
import '../interfaces/IReferralStorage.sol';

contract PEXAdlCallbacksV1_1 is Initializable {
    using SafeERC20 for IERC20;

    // Contracts (constant)
    IStorageT public storageT;
    IPEXPairInfos public pairInfos;
    ICallbacks public callbacks;

    // Params (constant)
    uint constant PRECISION = 1e10;  // 10 decimals

    // Params (adjustable)
    uint public maxProfitP; // max profit position should less than vault usdt balance * maxProfitP
    uint public adlSlUpnlP; // adl loss positions upnl should > adlSlUpnlP

    // State
    bool public isPaused;

    // Custom data types
    struct AggregatorBatchAnswer{
        uint orderId;
        uint[] pairIndices;
        uint[] prices;
        uint[] spreadPs;
    }

    struct AdlConditionInfo {
        IStorageT.PendingAdlOrder[] o;
        uint totalAdlOrderLength;
        uint totalSendToGov;
        uint totalSendToVault;
        uint totalSendToTrader;
    }

    struct Values{
        uint posUsdt; 
        uint levPosUsdt; 
        int profitP; 
        uint price;
        uint usdtSentToTrader;
        uint realSentToTrader;
        uint storageTSentToTrader;
        uint sentToGov;
        bool isVaultToTrader;
    }

    struct UsdtFlowInfo {
        uint vaultSentToTrader;
        uint storageTSentToTrader;
    }

    struct Fees{
        uint rolloverFee;
        int fundingFee;
        uint closingFee;
        uint referralSaveFee;
    }

    // adl pair prices
    mapping (uint => uint) public aggregatorPrices;

    // adl independent traders
    address[] public adlBatchTraders;
    mapping(address => uint) public adlTradesCount;
    mapping(address => UsdtFlowInfo) public adlTradersUsdtFlows;

    // Events
    event Paused(bool isPaused);
    event AddressUpdated(string name, address a);
    event NumberUpdated(string name,uint value);

    event AdlClosingExecuted(
        uint indexed orderId,
        address indexed trader,
        uint adlIndex,
        IStorageT.Trade t,
        address indexed botAddr,
        IStorageT.AdlOrder orderType,
        uint price,
        uint priceImpactP,
        uint positionSizeUsdt,
        int percentProfit,
        uint usdtSentToTrader,
        uint rolloverFee,
        int fundingFee,
        uint fee
    );

    event AdlUsdtFlow(
        uint indexed orderId,
        address indexed botAddr,
        uint totalStorageTSendToGov,
        uint totalStorageTSendToVault,
        uint vaultSendToTrader
    );

    function initialize(
        IStorageT _storageT,
        IPEXPairInfos _pairInfos,
        ICallbacks _callbacks
    ) external initializer{
        require(address(_storageT) != address(0)
            && address(_pairInfos) != address(0)
            && address(_callbacks) != address(0), "WRONG_PARAMS");

        storageT = _storageT;
        pairInfos = _pairInfos;
        callbacks = _callbacks;

        maxProfitP = 50;
        adlSlUpnlP = 50;
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
    modifier notPaused(){
        require(!isPaused, "PAUSED");
        _;
    }

    // Manage state
    function paused() external onlyGov{
        isPaused = !isPaused;

        emit Paused(isPaused); 
    }

    // Manage params
    function setPairInfos(address _pairInfos) external onlyGov{
        require(_pairInfos != address(0));
        pairInfos = IPEXPairInfos(_pairInfos);
        emit AddressUpdated("pairInfos", _pairInfos);
    }

    function setCallbacks(address _callbacks) external onlyGov{
        require(_callbacks != address(0));
        callbacks = ICallbacks(_callbacks);
        emit AddressUpdated("callbacks", _callbacks);
    }

    function updateMaxProfitP(uint _maxProfitP) external onlyGov{
        require(_maxProfitP > 0);
        maxProfitP = _maxProfitP;
        emit NumberUpdated("maxProfitP", _maxProfitP);
    }

    function updateAdlSlUpnlP(uint _adlSlUpnlP) external onlyGov{
        require(_adlSlUpnlP > 0);
        adlSlUpnlP = _adlSlUpnlP;
        emit NumberUpdated("adlSlUpnlP", _adlSlUpnlP);
    }

    // Callbacks
    function executeAdlCloseOrderCallback(
        AggregatorBatchAnswer memory a
    ) external onlyPriceAggregator notPaused{

        AdlConditionInfo memory adlConditionInfo;
        Values memory v;

        Fees memory fees;
        IStorageT.Trade memory t;
        IStorageT.TradeInfo memory tradeInfo;

        adlConditionInfo.o = storageT.pendingAdlOrders(a.orderId);
        adlConditionInfo.totalAdlOrderLength = storageT.pendingAdlOrdersCount(a.orderId);

        IAggregator aggregator = storageT.priceAggregator();
        IPairsStorage pairsStorage = aggregator.pairsStorage();

        adlConditionInfo.totalSendToVault = 0;
        adlConditionInfo.totalSendToTrader = 0;
        adlConditionInfo.totalSendToGov = 0;

        // mapping aggregator price
        for(uint i = 0; i < a.pairIndices.length; i++) {
            aggregatorPrices[a.pairIndices[i]] = a.prices[i];
        }

        // loop all adl target positions, and confirm whether adl conditions are satisfied
        // Simultaneously categorize and record positions according to traders, along with their profits and losses.
        for(uint i = 0; i < adlConditionInfo.totalAdlOrderLength; i++) {

            t = storageT.openTrades(
                adlConditionInfo.o[i].trader, adlConditionInfo.o[i].pairIndex, adlConditionInfo.o[i].index
            );

            tradeInfo = storageT.openTradesInfo(
                t.trader, t.pairIndex, t.index
            );

            require(aggregatorPrices[t.pairIndex] > 0, "AggregatorPrice Wrong");
            require(t.leverage > 0, "Leverage Wrong");
            require(uint(adlConditionInfo.o[i].adlType) < 2, "AdlTypes Wrong");


            // get adl position infos
            v.price = aggregatorPrices[t.pairIndex];
            v.profitP = currentPercentProfit(t.openPrice, v.price, t.buy, t.leverage);
            v.levPosUsdt = t.positionSizeUsdt * t.leverage;
            v.posUsdt = v.levPosUsdt / t.leverage;

            (v.isVaultToTrader ,v.usdtSentToTrader, v.storageTSentToTrader, v.sentToGov, fees) = getVaultToTradersPure(
                t,
                v.profitP,
                v.posUsdt,
                v.levPosUsdt * pairsStorage.pairCloseFeeP(t.pairIndex) / 100 / PRECISION
            );

            if(v.isVaultToTrader){
                v.realSentToTrader = v.usdtSentToTrader + v.storageTSentToTrader;
            }else {
                v.realSentToTrader = v.storageTSentToTrader;
            }

            uint maxProfitUsdtBalance = storageT.vault().currentBalanceUsdt() * maxProfitP /100;

            // 1.
            // check adl Tp position net pnl > vault usdt balance 50%
            if (adlConditionInfo.o[i].adlType == IStorageT.AdlOrder.ADLTP) {

                if(v.usdtSentToTrader > maxProfitUsdtBalance && v.isVaultToTrader == true ){

                    adlConditionInfo.totalSendToTrader += v.usdtSentToTrader;
                } else {
                    
                    revert("Condition1 Wrong");
                }
            }

            uint newTotalSendToVault;

            // 2.
            // check adl sl position upnl > 50%
            if (adlConditionInfo.o[i].adlType == IStorageT.AdlOrder.ADLSL) {

                if(v.profitP <= -50 && v.isVaultToTrader == false){

                    newTotalSendToVault = adlConditionInfo.totalSendToVault + v.usdtSentToTrader;
                } else {

                    revert("Condition2 Wrong");
                }
            }

            // 3.
            // Determine if the flow of funds from the loss positions to the vault 
            // can just cover (equal to or less than) the actual outflow of funds from the profit positions to users,
            // without exceeding the required position.
            if (newTotalSendToVault <= adlConditionInfo.totalSendToTrader) {

                adlConditionInfo.totalSendToVault = newTotalSendToVault;
            } else {

                // If the sum of new loss positions (trader -> vault) 
                // is still less than or equal to the sum of profit positions (vault -> trader)
                // then add this loss position
                if (newTotalSendToVault - adlConditionInfo.totalSendToTrader <= v.usdtSentToTrader) {

                    adlConditionInfo.totalSendToVault = newTotalSendToVault;
                } else {

                    revert("Condition3 Wrong");
                }
            }

            // calculate same trader positions should be transfered amount
            // To record how many different traders participated in this ADL batch
            adlTradesCount[t.trader]++;
            if(adlTradesCount[t.trader] == 1) {
                adlBatchTraders.push(t.trader);
            }

            // get usdt flow
            // adlConditionInfo.totalSendToVault  // 1. adl loss position total loss collateral send to vault
            adlConditionInfo.totalSendToGov += v.sentToGov; // 2. total fee to gov
            adlTradersUsdtFlows[t.trader].storageTSentToTrader += v.storageTSentToTrader; // 3. adl storageT remain collateral back to user
            if(v.isVaultToTrader){
                adlTradersUsdtFlows[t.trader].vaultSentToTrader += v.usdtSentToTrader; // 4. adl profit positions vault send to trader
            }

            // unregister trades
            // avoid stack too deep
            unregistAndEmit(a, t, tradeInfo, adlConditionInfo.o[i], v, fees);
        }

        // delete aggregator price
        for(uint i = 0; i < a.pairIndices.length; i++) {
            delete aggregatorPrices[a.pairIndices[i]];
        }

        // transfer usdt
        callbacks.callSendToVault(adlConditionInfo.totalSendToVault, adlConditionInfo.o[0].nftHolder); // 1. total loss position collateral from storageT to vault
        storageT.handlePlatformFee(adlConditionInfo.totalSendToGov, 0); // 2. total platform fee

        for(uint i = 0; i < adlBatchTraders.length; i++) {

            // 3 adl loss or profit postion storageT remain collateral to traders
            if (adlTradersUsdtFlows[adlBatchTraders[i]].storageTSentToTrader > 0) {
                storageT.transferUsdt(address(storageT), adlBatchTraders[i], adlTradersUsdtFlows[adlBatchTraders[i]].storageTSentToTrader);
            }

            // 4. adl profit positions vault to traders
            if (adlTradersUsdtFlows[adlBatchTraders[i]].vaultSentToTrader > 0) {
                callbacks.callVaultSendToTrader(adlTradersUsdtFlows[adlBatchTraders[i]].vaultSentToTrader, adlBatchTraders[i]);
            }

            delete adlTradesCount[adlBatchTraders[i]];
            delete adlTradersUsdtFlows[adlBatchTraders[i]];
        }
        
        delete adlBatchTraders;

        emit AdlUsdtFlow(
            a.orderId,
            adlConditionInfo.o[0].nftHolder,
            adlConditionInfo.totalSendToGov,
            adlConditionInfo.totalSendToVault,
            adlConditionInfo.totalSendToTrader
        );
    }

    //Utils
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

    function eventPercentProfit(
        uint positionSizeUsdt,
        uint usdtSentToTrader
    ) private pure returns(int p){ // PRECISION (%)
        require(positionSizeUsdt > 0, "WRONG_PARAMS");
        int pnl = int(usdtSentToTrader) - int(positionSizeUsdt);
        p = pnl * 100 * int(PRECISION) / int(positionSizeUsdt);
    }

    function getNetPnl(
        int percentProfit,
        uint currentUsdtPos,
        Fees memory fees
    ) private view returns(uint usdtSentToTrader){

        int value = int(currentUsdtPos)
            + int(currentUsdtPos) * percentProfit / int(PRECISION) / 100
            - int(fees.rolloverFee) - fees.fundingFee;

        if(value <= int(currentUsdtPos) * int(100 - pairInfos.LIQ_THRESHOLD_P()) / 100){
            return 0;
        }

        value -= int(fees.closingFee);

        if(value > 0){
            return uint(value);
        }else {
            return 0;
        }
    }

    function getVaultToTradersPure(
        IStorageT.Trade memory trade,
        int percentProfit,
        uint currentUsdtPos,
        uint closingFeeUsdt
    ) private returns(bool isVaultToTrader, uint vaultSentToTrader,uint storageTSentToTrader, uint sentToGov, Fees memory fees){
        pairInfos.adlStoreAccFundingFees(trade.pairIndex);

        fees = getFee(trade, currentUsdtPos, closingFeeUsdt);

        uint usdtSentToTrader = getNetPnl(
            percentProfit,
            currentUsdtPos,
            fees
        );

        sentToGov = fees.closingFee + fees.rolloverFee;
        uint usdtLeftInStorage = currentUsdtPos - sentToGov;

        sentToGov = sentToGov - fees.referralSaveFee;

        if(usdtSentToTrader > usdtLeftInStorage){
            return (true, usdtSentToTrader - usdtLeftInStorage, usdtLeftInStorage, sentToGov, fees);
        } else {
            return (false, usdtLeftInStorage - usdtSentToTrader, usdtSentToTrader, sentToGov, fees);
        }

    }

    // avoid stack too deep
    function getFee(
        IStorageT.Trade memory trade,
        uint currentUsdtPos,
        uint closingFeeUsdt
    ) private returns (Fees memory fees){

        fees.rolloverFee = pairInfos.getTradeRolloverFee(trade.trader, trade.pairIndex, trade.index, currentUsdtPos);
        fees.fundingFee = pairInfos.getTradeFundingFee(trade.trader, trade.pairIndex, trade.index, trade.buy, currentUsdtPos, trade.leverage);

        uint nftSaveP = trade.initialPosUSDT > 0 ? callbacks.nftPassSaveFeeP() : 0;
        fees.closingFee = closingFeeUsdt * callbacks.usdtVaultFeeP() / 100;
        fees.closingFee = fees.closingFee - (fees.closingFee * nftSaveP / PRECISION / 100);

        fees.referralSaveFee = callbacks.referralStorage().distributeReferralAndSaveFee(trade.trader, currentUsdtPos * trade.leverage, fees.closingFee);
    }

    function unregistAndEmit(
        AggregatorBatchAnswer memory a,
        IStorageT.Trade memory t,
        IStorageT.TradeInfo memory tradeInfo,
        IStorageT.PendingAdlOrder memory o,
        Values memory v,
        Fees memory fees
    )private {

        // Calls to other contracts
        storageT.priceAggregator().pairsStorage().updateGroupCollateral(
            t.pairIndex, tradeInfo.openInterestUsdt / t.leverage, t.buy, false
        );

        // Unregister trade
        storageT.unregisterTrade(t.trader, t.pairIndex, t.index);
        storageT.increaseUpnlLastId();

        // emit event
        emit AdlClosingExecuted(
            a.orderId,
            t.trader,
            o.index,
            t,
            o.nftHolder,
            o.adlType,
            v.price,
            0,
            v.posUsdt,
            eventPercentProfit(v.posUsdt, v.realSentToTrader),
            v.realSentToTrader,
            fees.rolloverFee,
            fees.fundingFee,
            fees.closingFee
        );
    }
}