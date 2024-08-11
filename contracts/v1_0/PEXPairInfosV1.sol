// SPDX-License-Identifier: MIT
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import '../interfaces/IStorageT.sol';
pragma solidity 0.8.17;

contract PEXPairInfosV1 is Initializable {

    // Addresses
    IStorageT storageT;
    address public manager;

    // Constant parameters
    uint constant PRECISION = 1e10;     // 10 decimals
    uint public constant LIQ_THRESHOLD_P = 90; // -90% (of collateral)

    // Adjustable parameters
    uint public maxNegativePnlOnOpenP; // PRECISION (%)

    // Pair parameters
    struct PairParams{
        uint onePercentDepthAbove; // USDT
        uint onePercentDepthBelow; // USDT
        uint rolloverFeePerBlockP; // PRECISION (%)
        uint fundingFeePerBlockP;  // PRECISION (%)
    }

    mapping(uint => PairParams) public pairParams;

    // Pair acc funding fees
    struct PairFundingFees{
        int accPerOiLong;  // USDT
        int accPerOiShort; // USDT
        uint lastUpdateBlock;
    }

    mapping(uint => PairFundingFees) public pairFundingFees;

    // Pair acc rollover fees
    struct PairRolloverFees{
        uint accPerCollateral; // USDT
        uint lastUpdateBlock;
    }

    mapping(uint => PairRolloverFees) public pairRolloverFees;

    // Trade initial acc fees
    struct TradeInitialAccFees{
        uint rollover; // USDT
        int funding;   // USDT
        bool openedAfterUpdate;
    }

    mapping(
        address => mapping(
            uint => mapping(
                uint => TradeInitialAccFees
            )
        )
    ) public tradeInitialAccFees;

    // Events
    event ManagerUpdated(address value);
    event MaxNegativePnlOnOpenPUpdated(uint value);

    event PairParamsUpdated(uint pairIndex, PairParams value);
    event OnePercentDepthUpdated(uint pairIndex, uint valueAbove, uint valueBelow);
    event RolloverFeePerBlockPUpdated(uint pairIndex, uint value);
    event FundingFeePerBlockPUpdated(uint pairIndex, uint value);

    event TradeInitialAccFeesStored(
        address trader,
        uint pairIndex,
        uint index,
        uint rollover,
        int funding
    );

    event AccFundingFeesStored(uint pairIndex, int valueLong, int valueShort);
    event AccRolloverFeesStored(uint pairIndex, uint value);

    event FeesCharged(
        uint pairIndex,
        bool long,
        uint collateral,   // USDT
        uint leverage,
        int percentProfit, // PRECISION (%)
        uint rolloverFees, // USDT
        int fundingFees    // USDT
    );

    function initialize(IStorageT _storageT) external initializer {
        storageT = _storageT;

        maxNegativePnlOnOpenP = 40 * PRECISION;
    }

    // Modifiers
    modifier onlyGov(){
        require(msg.sender == storageT.gov(), "GOV_ONLY");
        _;
    }
    modifier onlyManager(){
        require(msg.sender == manager, "MANAGER_ONLY");
        _;
    }
    modifier onlyCallbacks(){
        require(msg.sender == storageT.callbacks() 
            || msg.sender == storageT.adlCallbacks()
            || msg.sender == address(storageT.tradeRegister()), "CALLBACKS_ONLY");
        _;
    }

    // Set manager address
    function setManager(address _manager) external onlyGov{
        manager = _manager;

        emit ManagerUpdated(_manager);
    }

    // Set max negative PnL % on trade opening
    function setMaxNegativePnlOnOpenP(uint value) external onlyManager{
        maxNegativePnlOnOpenP = value;

        emit MaxNegativePnlOnOpenPUpdated(value);
    }

    // Set parameters for pair
    function setPairParams(uint pairIndex, PairParams memory value) public onlyManager{
        storeAccRolloverFees(pairIndex);
        storeAccFundingFees(pairIndex);

        pairParams[pairIndex] = value;

        emit PairParamsUpdated(pairIndex, value);
    }
    function setPairParamsArray(
        uint[] memory indices,
        PairParams[] memory values
    ) external onlyManager{
        require(indices.length == values.length, "WRONG_LENGTH");

        for(uint i = 0; i < indices.length; i++){
            setPairParams(indices[i], values[i]);
        }
    }

    // Set one percent depth for pair
    function setOnePercentDepth(
        uint pairIndex,
        uint valueAbove,
        uint valueBelow
    ) public onlyManager{
        PairParams storage p = pairParams[pairIndex];

        p.onePercentDepthAbove = valueAbove;
        p.onePercentDepthBelow = valueBelow;

        emit OnePercentDepthUpdated(pairIndex, valueAbove, valueBelow);
    }
    function setOnePercentDepthArray(
        uint[] memory indices,
        uint[] memory valuesAbove,
        uint[] memory valuesBelow
    ) external onlyManager{
        require(indices.length == valuesAbove.length
            && indices.length == valuesBelow.length, "WRONG_LENGTH");

        for(uint i = 0; i < indices.length; i++){
            setOnePercentDepth(indices[i], valuesAbove[i], valuesBelow[i]);
        }
    }

    // Set rollover fee for pair
    function setRolloverFeePerBlockP(uint pairIndex, uint value) public onlyManager{
        require(value <= 25000000, "TOO_HIGH"); // ≈ 100% per day

        storeAccRolloverFees(pairIndex);

        pairParams[pairIndex].rolloverFeePerBlockP = value;

        emit RolloverFeePerBlockPUpdated(pairIndex, value);
    }
    function setRolloverFeePerBlockPArray(
        uint[] memory indices,
        uint[] memory values
    ) external onlyManager{
        require(indices.length == values.length, "WRONG_LENGTH");

        for(uint i = 0; i < indices.length; i++){
            setRolloverFeePerBlockP(indices[i], values[i]);
        }
    }

    // Set funding fee for pair
    function setFundingFeePerBlockP(uint pairIndex, uint value) public onlyManager{
        require(value <= 10000000, "TOO_HIGH"); // ≈ 40% per day

        storeAccFundingFees(pairIndex);

        pairParams[pairIndex].fundingFeePerBlockP = value;

        emit FundingFeePerBlockPUpdated(pairIndex, value);
    }
    function setFundingFeePerBlockPArray(
        uint[] memory indices,
        uint[] memory values
    ) external onlyManager{
        require(indices.length == values.length, "WRONG_LENGTH");

        for(uint i = 0; i < indices.length; i++){
            setFundingFeePerBlockP(indices[i], values[i]);
        }
    }

    // Store trade details when opened (acc fee values)
    function storeTradeInitialAccFees(
        address trader,
        uint pairIndex,
        uint index,
        bool long
    ) external onlyCallbacks{
        storeAccFundingFees(pairIndex);

        TradeInitialAccFees storage t = tradeInitialAccFees[trader][pairIndex][index];

        t.rollover = getPendingAccRolloverFees(pairIndex);

        t.funding = long ?
            pairFundingFees[pairIndex].accPerOiLong :
            pairFundingFees[pairIndex].accPerOiShort;

        t.openedAfterUpdate = true;

        emit TradeInitialAccFeesStored(trader, pairIndex, index, t.rollover, t.funding);
    }

    // Acc rollover fees (store right before fee % update)
    function storeAccRolloverFees(uint pairIndex) private{
        PairRolloverFees storage r = pairRolloverFees[pairIndex];

        r.accPerCollateral = getPendingAccRolloverFees(pairIndex);
        r.lastUpdateBlock = block.number;

        emit AccRolloverFeesStored(pairIndex, r.accPerCollateral);
    }
    function getPendingAccRolloverFees(
        uint pairIndex
    ) public view returns(uint){ // USDT
        PairRolloverFees storage r = pairRolloverFees[pairIndex];

        return r.accPerCollateral +
            (block.number - r.lastUpdateBlock)
            * pairParams[pairIndex].rolloverFeePerBlockP
            * 1e6 / PRECISION / 100;
    }

    // Acc funding fees (store right before trades opened / closed and fee % update)
    function storeAccFundingFees(uint pairIndex) private{
        PairFundingFees storage f = pairFundingFees[pairIndex];

        (f.accPerOiLong, f.accPerOiShort) = getPendingAccFundingFees(pairIndex);
        f.lastUpdateBlock = block.number;

        emit AccFundingFeesStored(pairIndex, f.accPerOiLong, f.accPerOiShort);
    }
    // for adlcallbacks
    function adlStoreAccFundingFees(uint pairIndex) external onlyCallbacks{
        storeAccFundingFees(pairIndex);
    }

    function getPendingAccFundingFees(uint pairIndex) public view returns(
        int valueLong,
        int valueShort
    ){
        PairFundingFees storage f = pairFundingFees[pairIndex];

        valueLong = f.accPerOiLong;
        valueShort = f.accPerOiShort;

        int openInterestUsdtLong = int(storageT.openInterestUsdt(pairIndex, 0));
        int openInterestUsdtShort = int(storageT.openInterestUsdt(pairIndex, 1));

        int fundingFeesPaidByLongs = (openInterestUsdtLong - openInterestUsdtShort)
            * int(block.number - f.lastUpdateBlock)
            * int(pairParams[pairIndex].fundingFeePerBlockP)
            / int(PRECISION) / 100;

        if(openInterestUsdtLong > 0){
            valueLong += fundingFeesPaidByLongs * 1e6
                / openInterestUsdtLong;
        }

        if(openInterestUsdtShort > 0){
            valueShort += fundingFeesPaidByLongs * 1e6 * (-1)
                / openInterestUsdtShort;
        }
    }

    // Dynamic price impact value on trade opening
    function getTradePriceImpact(
        uint openPrice,        // PRECISION
        uint pairIndex,
        bool long,
        uint tradeOpenInterest // USDT
    ) external view returns(
        uint priceImpactP,     // PRECISION (%)
        uint priceAfterImpact  // PRECISION
    ){
        (priceImpactP, priceAfterImpact) = getTradePriceImpactPure(
            openPrice,
            long,
            storageT.openInterestUsdt(pairIndex, long ? 0 : 1),
            tradeOpenInterest,
            long ?
                pairParams[pairIndex].onePercentDepthAbove :
                pairParams[pairIndex].onePercentDepthBelow
        );
    }
    function getTradePriceImpactPure(
        uint openPrice,         // PRECISION
        bool long,
        uint startOpenInterest, // USDT
        uint tradeOpenInterest, // USDT
        uint onePercentDepth
    ) public pure returns(
        uint priceImpactP,      // PRECISION (%)
        uint priceAfterImpact   // PRECISION
    ){
        if(onePercentDepth == 0){
            return (0, openPrice);
        }

        priceImpactP = (startOpenInterest + tradeOpenInterest / 2)
            * PRECISION / 1e6 / onePercentDepth;

        uint priceImpact = priceImpactP * openPrice / PRECISION / 100;

        priceAfterImpact = long ? openPrice + priceImpact : openPrice - priceImpact;
    }

    // Rollover fee value
    function getTradeRolloverFee(
        address trader,
        uint pairIndex,
        uint index,
        uint collateral // USDT
    ) public view returns(uint){ // USDT
        TradeInitialAccFees memory t = tradeInitialAccFees[trader][pairIndex][index];

        if(!t.openedAfterUpdate){
            return 0;
        }

        return getTradeRolloverFeePure(
            t.rollover,
            getPendingAccRolloverFees(pairIndex),
            collateral
        );
    }
    function getTradeRolloverFeePure(
        uint accRolloverFeesPerCollateral,
        uint endAccRolloverFeesPerCollateral,
        uint collateral // USDT
    ) public pure returns(uint){ // USDT
        return (endAccRolloverFeesPerCollateral - accRolloverFeesPerCollateral)
            * collateral / 1e6;
    }

    // Funding fee value
    function getTradeFundingFee(
        address trader,
        uint pairIndex,
        uint index,
        bool long,
        uint collateral, // USDT
        uint leverage
    ) public view returns(
        int // USDT | Positive => Fee, Negative => Reward
    ){
        TradeInitialAccFees memory t = tradeInitialAccFees[trader][pairIndex][index];

        if(!t.openedAfterUpdate){
            return 0;
        }

        (int pendingLong, int pendingShort) = getPendingAccFundingFees(pairIndex);

        return getTradeFundingFeePure(
            t.funding,
            long ? pendingLong : pendingShort,
            collateral,
            leverage
        );
    }
    function getTradeFundingFeePure(
        int accFundingFeesPerOi,
        int endAccFundingFeesPerOi,
        uint collateral, // USDT
        uint leverage
    ) public pure returns(
        int // USDT | Positive => Fee, Negative => Reward
    ){
        return (endAccFundingFeesPerOi - accFundingFeesPerOi)
            * int(collateral) * int(leverage) / 1e6;
    }

    // Liquidation price value after rollover and funding fees
    function getTradeLiquidationPrice(
        address trader,
        uint pairIndex,
        uint index,
        uint openPrice,  // PRECISION
        bool long,
        uint collateral, // USDT
        uint leverage
    ) external view returns(uint){ // PRECISION
        return getTradeLiquidationPricePure(
            openPrice,
            long,
            collateral,
            leverage,
            getTradeRolloverFee(trader, pairIndex, index, collateral),
            getTradeFundingFee(trader, pairIndex, index, long, collateral, leverage)
        );
    }
    function getTradeLiquidationPricePure(
        uint openPrice,   // PRECISION
        bool long,
        uint collateral,  // USDT
        uint leverage,
        uint rolloverFee, // USDT
        int fundingFee    // USDT
    ) public pure returns(uint){ // PRECISION
        int liqPriceDistance = int(openPrice) * (
                int(collateral * LIQ_THRESHOLD_P / 100)
                - int(rolloverFee) - fundingFee
            ) / int(collateral) / int(leverage);

        int liqPrice = long ?
            int(openPrice) - liqPriceDistance :
            int(openPrice) + liqPriceDistance;

        return liqPrice > 0 ? uint(liqPrice) : 0;
    }

    // Usdt sent to trader after PnL and fees
    function getTradeValue(
        address trader,
        uint pairIndex,
        uint index,
        bool long,
        uint collateral,   // USDT
        uint leverage,
        int percentProfit, // PRECISION (%)
        uint closingFee    // USDT
    ) external onlyCallbacks returns(uint amount, uint rolloverFee){ // USDT
        storeAccFundingFees(pairIndex);

        uint r = getTradeRolloverFee(trader, pairIndex, index, collateral);
        int f = getTradeFundingFee(trader, pairIndex, index, long, collateral, leverage);

        (amount, rolloverFee) = getTradeValuePure(collateral, percentProfit, r, f, closingFee);

        emit FeesCharged(pairIndex, long, collateral, leverage, percentProfit, r, f);
    }
    function getTradeValuePure(
        uint collateral,   // USDT
        int percentProfit, // PRECISION (%)
        uint rolloverFee,  // USDT
        int fundingFee,    // USDT
        uint closingFee    // USDT
    ) public pure returns(uint v, uint Fee){ // USDT
        int value = int(collateral)
            + int(collateral) * percentProfit / int(PRECISION) / 100
            - int(rolloverFee) - fundingFee;

        if(value <= int(collateral) * int(100 - LIQ_THRESHOLD_P) / 100){
            return (0, rolloverFee);
        }

        value -= int(closingFee);

        if(value > 0){
            return (uint(value), rolloverFee);
        }else {
            return (0, uint(value + int(rolloverFee)));
        }
    }

    // Useful getters
    function getPairInfos(uint[] memory indices) external view returns(
        PairParams[] memory,
        PairRolloverFees[] memory,
        PairFundingFees[] memory
    ){
        PairParams[] memory params = new PairParams[](indices.length);
        PairRolloverFees[] memory rolloverFees = new PairRolloverFees[](indices.length);
        PairFundingFees[] memory fundingFees = new PairFundingFees[](indices.length);

        for(uint i = 0; i < indices.length; i++){
            uint index = indices[i];

            params[i] = pairParams[index];
            rolloverFees[i] = pairRolloverFees[index];
            fundingFees[i] = pairFundingFees[index];
        }

        return (params, rolloverFees, fundingFees);
    }
    function getOnePercentDepthAbove(uint pairIndex) external view returns(uint){
        return pairParams[pairIndex].onePercentDepthAbove;
    }
    function getOnePercentDepthBelow(uint pairIndex) external view returns(uint){
        return pairParams[pairIndex].onePercentDepthBelow;
    }
    function getRolloverFeePerBlockP(uint pairIndex) external view returns(uint){
        return pairParams[pairIndex].rolloverFeePerBlockP;
    }
    function getFundingFeePerBlockP(uint pairIndex) external view returns(uint){
        return pairParams[pairIndex].fundingFeePerBlockP;
    }
    function getAccRolloverFees(uint pairIndex) external view returns(uint){
        return pairRolloverFees[pairIndex].accPerCollateral;
    }
    function getAccRolloverFeesUpdateBlock(uint pairIndex) external view returns(uint){
        return pairRolloverFees[pairIndex].lastUpdateBlock;
    }
    function getAccFundingFeesLong(uint pairIndex) external view returns(int){
        return pairFundingFees[pairIndex].accPerOiLong;
    }
    function getAccFundingFeesShort(uint pairIndex) external view returns(int){
        return pairFundingFees[pairIndex].accPerOiShort;
    }
    function getAccFundingFeesUpdateBlock(uint pairIndex) external view returns(uint){
        return pairFundingFees[pairIndex].lastUpdateBlock;
    }
    function getTradeInitialAccRolloverFeesPerCollateral(
        address trader,
        uint pairIndex,
        uint index
    ) external view returns(uint){
        return tradeInitialAccFees[trader][pairIndex][index].rollover;
    }
    function getTradeInitialAccFundingFeesPerOi(
        address trader,
        uint pairIndex,
        uint index
    ) external view returns(int){
        return tradeInitialAccFees[trader][pairIndex][index].funding;
    }
    function getTradeOpenedAfterUpdate(
        address trader,
        uint pairIndex,
        uint index
    ) external view returns(bool){
        return tradeInitialAccFees[trader][pairIndex][index].openedAfterUpdate;
    }
}