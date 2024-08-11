// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import '../interfaces/ITokenV1.sol';
import '../interfaces/IAggregator.sol';
import '../interfaces/IPausable.sol';
import '../interfaces/IPairsStorage.sol';
import '../interfaces/IPEXPairInfos.sol';
import '../interfaces/ITradeRegister.sol';
import '../interfaces/IMonthPassNft.sol';
import '../interfaces/IPToken.sol';
import '../interfaces/IEcosystemManage.sol';

contract PairexTradingStorageV1 is Initializable{
    using SafeERC20 for IERC20;

    // Constants
    uint public constant PRECISION = 1e10;
    bytes32 public constant MINTER_ROLE = 0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6; // MINTER_ROLE use keccak256 encode

    // Contracts (updatable)
    IAggregator public priceAggregator;
    IPairsStorage public pairsStorage;
    IPEXPairInfos public pairsInfos;
    IPausable public trading;
    IPausable public callbacks;
    
    address public vault; // ptoken
    IERC20 public usdt;
    ITokenV1 public linkErc677; // link token

    // Trading variables
    uint public maxTradesPerPair;
    uint public maxTradesPerBlock;
    uint public maxPendingMarketOrders;
    uint public maxGainP;
    uint public maxSlP;
    uint public defaultLeverageUnlocked;
    uint public nftSuccessTimelock;

    // Gov addresses (updatable)
    address public gov;
    uint public govFeesUsdt;

    // Stats
    uint public nftRewards;

    // Enums
    enum LimitOrder { TP, SL, LIQ, OPEN }
    enum AdlOrder { ADLTP, ADLSL }

    // Structs
    struct Trader{
        uint leverageUnlocked;
        address referral;
        uint referralRewardsTotal;
    }
    struct Trade{
        address trader;
        uint pairIndex;
        uint index;
        uint initialPosUSDT;        // !!! use as if nft used (cause proxy update)
        uint positionSizeUsdt;
        uint openPrice;             // PRECISION
        bool buy;
        uint leverage;
        uint tp;                    // PRECISION
        uint sl;                    // PRECISION
    }
    struct TradeInfo{
        uint openInterestUsdt;
        uint storeTradeBlock;
        uint tpLastUpdated;
        uint slLastUpdated;
        bool beingMarketClosed;
    }
     struct AllTrades{
        Trade trade;
        TradeInfo tradeInfo;
        uint liqPrice;
        uint rolloverFee;
        int fundingFee;
    }
    struct OpenLimitOrder{
        address trader;
        uint pairIndex;
        uint index;
        uint positionSize;          // USDT
        uint spreadReductionP;
        bool buy;
        uint leverage;
        uint tp;                    // PRECISION (%)
        uint sl;                    // PRECISION (%)
        uint minPrice;              // PRECISION
        uint maxPrice;              // PRECISION
        uint block;
        uint tokenId;               // !!! use as if nft used (cause proxy update)
    }
    struct PendingMarketOrder{
        Trade trade;
        uint block;
        uint wantedPrice;           // PRECISION
        uint slippageP;             // PRECISION (%)
        uint spreadReductionP;
        uint tokenId;               // !!! use as if nft used (cause proxy update)
    }
    struct PendingNftOrder{
        address nftHolder;
        uint nftId;
        address trader;
        uint pairIndex;
        uint index;
        LimitOrder orderType;
    }
    struct PendingAdlOrder{
        address nftHolder;
        address trader;
        uint pairIndex;
        uint index;
        AdlOrder adlType;
    }

    // Supported tokens to open trades with
    address[] public supportedTokens;

    // User info mapping
    mapping(address => Trader) public traders;

    // Trades mappings
    mapping(address => mapping(uint => mapping(uint => Trade))) public openTrades;
    mapping(address => mapping(uint => mapping(uint => TradeInfo))) public openTradesInfo;
    mapping(address => mapping(uint => uint)) public openTradesCount;

    // Limit orders mappings
    mapping(address => mapping(uint => mapping(uint => uint))) public openLimitOrderIds;
    mapping(address => mapping(uint => uint)) public openLimitOrdersCount;
    OpenLimitOrder[] public openLimitOrders;

    // Pending orders mappings
    mapping(uint => PendingMarketOrder) public reqID_pendingMarketOrder;
    mapping(uint => PendingNftOrder) public reqID_pendingNftOrder;
    mapping(address => uint[]) public pendingOrderIds;
    mapping(address => mapping(uint => uint)) public pendingMarketOpenCount;
    mapping(address => mapping(uint => uint)) public pendingMarketCloseCount;

    // List of open trades & limit orders
    mapping(uint => address[]) public pairTraders;
    mapping(address => mapping(uint => uint)) public pairTradersId;

    // Current and max open interests for each pair
    mapping(uint => uint[3]) public openInterestUsdt; // long,short,max

    // Restrictions & Timelocks
    mapping(uint => uint) public tradesPerBlock;
    mapping(uint => uint) public nftLastSuccess;

    // List of allowed contracts => can update storage + mint/burn tokens
    mapping(address => bool) public isTradingContract;

    // bot which can triggered limit order
    mapping (address => bool) public isBotListed;

    // upnl lock id
    uint256 private upnlLastId;

    // new adl storage
    IPausable public adlClosing;
    IPausable public adlCallbacks;

    // Pending adls mappings
    mapping(uint => PendingAdlOrder[]) public reqID_pendingAdlOrder;

    // trades registers
    IMonthPassNft public monthPassNft;
    ITradeRegister public tradeRegister;

    // platform fee
    uint public platformFee;

    // ecosystem
    IEcosystemManage public ecosystemManage;

    // distribute fee parmas
    uint public govFeeP;
    uint public vaultFeeP;
    uint public ecosystemFeeP;

    // Events
    event SupportedCollateralUpdated(address a);
    event TradingContractAdded(address a);
    event TradingContractRemoved(address a);
    event BotWhiteListsAdded(address a);
    event BotWhiteListsRemoved(address a);
    event AddressUpdated(string name, address a);
    event NumberUpdated(string name,uint value);
    event NumberUpdatedPair(string name,uint pairIndex,uint value);
    event upnlLastIdUpdated(uint256 value);
    event NftEarned(address indexed addr, uint amount);
    event GovFeeReceived(uint amount);
    event DistributePlatformFee(uint platformFee);

    function initialize(
        address govAddr,
        address usdtAddr,
        address linkAddr
    ) external initializer {
        require(govAddr != address(0), "GOV_0");
        require(usdtAddr != address(0), "USDT_0");
        require(linkAddr != address(0), "lINK_0");
        gov = govAddr;
        usdt = IERC20(usdtAddr);
        linkErc677 = ITokenV1(linkAddr);

        maxTradesPerPair = 10;
        maxTradesPerBlock = 10;
        maxPendingMarketOrders = 5;
        nftSuccessTimelock = 0;
        upnlLastId = 0;
    }

    // Modifiers
    modifier onlyGov(){ require(msg.sender == gov); _; }
    modifier onlyTrading(){ require(isTradingContract[msg.sender]); _; }

    // Manage addresses
    function setGov(address _gov) external onlyGov{
        require(_gov != address(0));
        gov = _gov;
        emit AddressUpdated("gov", _gov);
    }
    function updateSupportedCollateral(address _token) external onlyGov{
        require(_token != address(0));
        require(trading.isPaused() && callbacks.isPaused(), "NOT_PAUSED");
        usdt = IERC20(_token);
        supportedTokens.push(_token);
        emit SupportedCollateralUpdated(_token);
    }
    function updateLinkToken(address _token) external onlyGov{
        require(_token != address(0));
        require(trading.isPaused() && callbacks.isPaused(), "NOT_PAUSED");
        linkErc677 = ITokenV1(_token);
    }
    // bot white lists
    function addBotWhiteList(address _botAddr) external onlyGov{
        require(_botAddr != address(0));
        isBotListed[_botAddr] = true;
        emit BotWhiteListsAdded(_botAddr);
    }
    function removeBotWhiteList(address _botAddr) external onlyGov{
        require(_botAddr != address(0));
        isBotListed[_botAddr] = false;
        emit BotWhiteListsRemoved(_botAddr);
    }
    // Trading + callbacks contracts
    function addTradingContract(address _trading) external onlyGov{
        require(_trading != address(0));
        isTradingContract[_trading] = true;
        emit TradingContractAdded(_trading);
    }
    function removeTradingContract(address _trading) external onlyGov{
        require(_trading != address(0));
        isTradingContract[_trading] = false;
        emit TradingContractRemoved(_trading);
    }
    function setPriceAggregator(address _aggregator) external onlyGov{
        require(_aggregator != address(0));
        priceAggregator = IAggregator(_aggregator);
        emit AddressUpdated("priceAggregator", _aggregator);
    }
    function setPairsStorage(address _pairsStorage) external onlyGov{
        require(_pairsStorage != address(0));
        pairsStorage = IPairsStorage(_pairsStorage);
        emit AddressUpdated("pairsStorage", _pairsStorage);
    }
    function setPairsInfos(address _pairsInfos) external onlyGov{
        require(_pairsInfos != address(0));
        pairsInfos = IPEXPairInfos(_pairsInfos);
        emit AddressUpdated("pairsInfos", _pairsInfos);
    }
    function setVault(address _vault) external onlyGov{
        require(_vault != address(0));
        vault = _vault;
        emit AddressUpdated("vault", _vault);
    }
    function setTrading(address _trading) external onlyGov{
        require(_trading != address(0));
        trading = IPausable(_trading);
        emit AddressUpdated("trading", _trading);
    }
    function setAdlClosing(address _adlClosing) external onlyGov{
        require(_adlClosing != address(0));
        adlClosing = IPausable(_adlClosing);
        emit AddressUpdated("adlClosing", _adlClosing);
    }
    function setCallbacks(address _callbacks) external onlyGov{
        require(_callbacks != address(0));
        callbacks = IPausable(_callbacks);
        emit AddressUpdated("callbacks", _callbacks);
    }
    function setAdlCallbacks(address _adlCallbacks) external onlyGov{
        require(_adlCallbacks != address(0));
        adlCallbacks = IPausable(_adlCallbacks);
        emit AddressUpdated("adlCallbacks", _adlCallbacks);
    }
    function setTradeRegister(address _tradeRegister) external onlyGov{
        require(_tradeRegister != address(0));
        tradeRegister = ITradeRegister(_tradeRegister);
        emit AddressUpdated("tradeRegister", _tradeRegister);
    }
    function setMonthPassNft(address _monthPassNft) external onlyGov{
        require(_monthPassNft != address(0));
        monthPassNft = IMonthPassNft(_monthPassNft);
        emit AddressUpdated("monthPassNft", _monthPassNft);
    }
    function setEcosystemManage(address _ecosystemManage) external onlyGov{
        require(_ecosystemManage != address(0));
        ecosystemManage = IEcosystemManage(_ecosystemManage);
        emit AddressUpdated("ecosystemManage", _ecosystemManage);
    }
    function setPlatformFeeSharesP(
        uint _govFeeP,
        uint _vaultFeeP,
        uint _ecosystemFeeP
    ) external onlyGov{
        require(_govFeeP + _vaultFeeP + _ecosystemFeeP == 100,"SUN_NOT_100");

        govFeeP = _govFeeP;
        vaultFeeP = _vaultFeeP;
        ecosystemFeeP = _ecosystemFeeP;

        emit NumberUpdated("govFeeP", govFeeP);
        emit NumberUpdated("vaultFeeP", vaultFeeP);
        emit NumberUpdated("ecosystemFeeP", ecosystemFeeP);
    }

    // Manage trading variables
    function setMaxTradesPerBlock(uint _maxTradesPerBlock) external onlyGov{
        require(_maxTradesPerBlock > 0);
        maxTradesPerBlock = _maxTradesPerBlock;
        emit NumberUpdated("maxTradesPerBlock", _maxTradesPerBlock);
    }
    function setMaxTradesPerPair(uint _maxTradesPerPair) external onlyGov{
        require(_maxTradesPerPair > 0);
        maxTradesPerPair = _maxTradesPerPair;
        emit NumberUpdated("maxTradesPerPair", _maxTradesPerPair);
    }
    function setMaxPendingMarketOrders(uint _maxPendingMarketOrders) external onlyGov{
        require(_maxPendingMarketOrders > 0);
        maxPendingMarketOrders = _maxPendingMarketOrders;
        emit NumberUpdated("maxPendingMarketOrders", _maxPendingMarketOrders);
    }
    function setNftSuccessTimelock(uint _blocks) external onlyGov{
        nftSuccessTimelock = _blocks;
        emit NumberUpdated("nftSuccessTimelock", _blocks);
    }
    function setMaxOpenInterestUsdt(uint _pairIndex, uint _newMaxOpenInterest) external onlyGov{
        // Can set max open interest to 0 to pause trading on this pair only
        openInterestUsdt[_pairIndex][2] = _newMaxOpenInterest;
        emit NumberUpdatedPair("maxOpenInterestUsdt", _pairIndex, _newMaxOpenInterest);
    }

    // Manage stored trades
    function storeTrade(Trade memory _trade, TradeInfo memory _tradeInfo) external onlyTrading{
        _trade.index = firstEmptyTradeIndex(_trade.trader, _trade.pairIndex);
        openTrades[_trade.trader][_trade.pairIndex][_trade.index] = _trade;

        openTradesCount[_trade.trader][_trade.pairIndex]++;
        tradesPerBlock[block.number]++;

        if(openTradesCount[_trade.trader][_trade.pairIndex] == 1){
            pairTradersId[_trade.trader][_trade.pairIndex] = pairTraders[_trade.pairIndex].length;
            pairTraders[_trade.pairIndex].push(_trade.trader);
        }

        _tradeInfo.beingMarketClosed = false;
        openTradesInfo[_trade.trader][_trade.pairIndex][_trade.index] = _tradeInfo;

        updateOpenInterestUsdt(_trade.pairIndex, _tradeInfo.openInterestUsdt, true, _trade.buy);
    }
    function unregisterTrade(address trader, uint pairIndex, uint index) external onlyTrading{
        Trade storage t = openTrades[trader][pairIndex][index];
        TradeInfo storage i = openTradesInfo[trader][pairIndex][index];
        if(t.leverage == 0){ return; }

        updateOpenInterestUsdt(pairIndex, i.openInterestUsdt, false, t.buy);

        if(openTradesCount[trader][pairIndex] == 1){
            uint _pairTradersId = pairTradersId[trader][pairIndex];
            address[] storage p = pairTraders[pairIndex];

            p[_pairTradersId] = p[p.length-1];
            pairTradersId[p[_pairTradersId]][pairIndex] = _pairTradersId;
            
            delete pairTradersId[trader][pairIndex];
            p.pop();
        }

        delete openTrades[trader][pairIndex][index];
        delete openTradesInfo[trader][pairIndex][index];

        openTradesCount[trader][pairIndex]--;
        tradesPerBlock[block.number]++;
    }

    // Manage pending market orders
    function storePendingMarketOrder(PendingMarketOrder memory _order, uint _id, bool _open) external onlyTrading{
        pendingOrderIds[_order.trade.trader].push(_id);

        reqID_pendingMarketOrder[_id] = _order;
        reqID_pendingMarketOrder[_id].block = block.number;
        
        if(_open){
            pendingMarketOpenCount[_order.trade.trader][_order.trade.pairIndex]++;
        }else{
            pendingMarketCloseCount[_order.trade.trader][_order.trade.pairIndex]++;
            openTradesInfo[_order.trade.trader][_order.trade.pairIndex][_order.trade.index].beingMarketClosed = true;
        }
    }
    function unregisterPendingMarketOrder(uint _id, bool _open) external onlyTrading{
        PendingMarketOrder memory _order = reqID_pendingMarketOrder[_id];
        uint[] storage orderIds = pendingOrderIds[_order.trade.trader];

        for(uint i = 0; i < orderIds.length; i++){
            if(orderIds[i] == _id){
                if(_open){ 
                    pendingMarketOpenCount[_order.trade.trader][_order.trade.pairIndex]--;
                }else{
                    pendingMarketCloseCount[_order.trade.trader][_order.trade.pairIndex]--;
                    openTradesInfo[_order.trade.trader][_order.trade.pairIndex][_order.trade.index].beingMarketClosed = false;
                }

                orderIds[i] = orderIds[orderIds.length-1];
                orderIds.pop();

                delete reqID_pendingMarketOrder[_id];
                return;
            }
        }
    }

    // Manage open interest
    function updateOpenInterestUsdt(uint _pairIndex, uint _leveragedPosUsdt, bool _open, bool _long) private{
        uint index = _long ? 0 : 1;
        uint[3] storage o = openInterestUsdt[_pairIndex];
        o[index] = _open ? o[index] + _leveragedPosUsdt : o[index] - _leveragedPosUsdt;
    }

    // Manage open limit orders
    function storeOpenLimitOrder(OpenLimitOrder memory o) external onlyTrading{
        o.index = firstEmptyOpenLimitIndex(o.trader, o.pairIndex);
        o.block = block.number;
        openLimitOrders.push(o);
        openLimitOrderIds[o.trader][o.pairIndex][o.index] = openLimitOrders.length-1;
        openLimitOrdersCount[o.trader][o.pairIndex]++;
    }
    function updateOpenLimitOrder(OpenLimitOrder calldata _o) external onlyTrading{
        if(!hasOpenLimitOrder(_o.trader, _o.pairIndex, _o.index)){ return; }
        OpenLimitOrder storage o = openLimitOrders[openLimitOrderIds[_o.trader][_o.pairIndex][_o.index]];
        o.positionSize = _o.positionSize;
        o.buy = _o.buy;
        o.leverage = _o.leverage;
        o.tp = _o.tp;
        o.sl = _o.sl;
        o.minPrice = _o.minPrice;
        o.maxPrice = _o.maxPrice;
        o.block = block.number;
    }
    function unregisterOpenLimitOrder(address _trader, uint _pairIndex, uint _index) external onlyTrading{
        if(!hasOpenLimitOrder(_trader, _pairIndex, _index)){ return; }

        // Copy last order to deleted order => update id of this limit order
        uint id = openLimitOrderIds[_trader][_pairIndex][_index];
        openLimitOrders[id] = openLimitOrders[openLimitOrders.length-1];
        openLimitOrderIds[openLimitOrders[id].trader][openLimitOrders[id].pairIndex][openLimitOrders[id].index] = id;

        // Remove
        delete openLimitOrderIds[_trader][_pairIndex][_index];
        openLimitOrders.pop();

        openLimitOrdersCount[_trader][_pairIndex]--;
    }

    // Manage NFT orders
    function storePendingNftOrder(PendingNftOrder memory _nftOrder, uint _orderId) external onlyTrading{
        reqID_pendingNftOrder[_orderId] = _nftOrder;
    }
    function unregisterPendingNftOrder(uint _order) external onlyTrading{
        delete reqID_pendingNftOrder[_order];
    }
    function increaseNftRewards(uint _nftId, uint _amount) external onlyTrading{
        nftLastSuccess[_nftId] = block.number; 
        nftRewards += _amount; 
    }

    //Manage ADL orders
    function storePendingAdlOrder(PendingAdlOrder memory _adlOrder, uint _orderId) external onlyTrading{
        reqID_pendingAdlOrder[_orderId].push(_adlOrder);
    }
    function unregisterPendingAdlOrder(uint _order) external onlyTrading{
        delete reqID_pendingAdlOrder[_order];
    }

    // Manage open trade
    function updateSl(address _trader, uint _pairIndex, uint _index, uint _newSl) external onlyTrading{
        Trade storage t = openTrades[_trader][_pairIndex][_index];
        TradeInfo storage i = openTradesInfo[_trader][_pairIndex][_index];
        if(t.leverage == 0){ return; }
        t.sl = _newSl;
        i.slLastUpdated = block.number;
    }
    function updateTp(address _trader, uint _pairIndex, uint _index, uint _newTp) external onlyTrading{
        Trade storage t = openTrades[_trader][_pairIndex][_index];
        TradeInfo storage i = openTradesInfo[_trader][_pairIndex][_index];
        if(t.leverage == 0){ return; }
        t.tp = _newTp;
        i.tpLastUpdated = block.number;
    }
    function updateTrade(Trade memory _t) external onlyTrading{ // useful when partial adding/closing
        Trade storage t = openTrades[_t.trader][_t.pairIndex][_t.index];
        if(t.leverage == 0){ return; }
        t.initialPosUSDT = _t.initialPosUSDT;
        t.positionSizeUsdt = _t.positionSizeUsdt;
        t.openPrice = _t.openPrice;
        t.leverage = _t.leverage;
    }

    // Manage referrals
    function storeReferral(address _trader, address _referral) external onlyTrading{
        Trader storage trader = traders[_trader];
        trader.referral = _referral != address(0) && trader.referral == address(0) && _referral != _trader 
                        ? _referral : trader.referral;
    }
    function increaseReferralRewards(address _referral, uint _amount) external onlyTrading{ 
        traders[_referral].referralRewardsTotal += _amount; 
    }

    // Manage platform fees and gov fee
    function approveEcoSystem(address _spender) external onlyGov {
        usdt.safeApprove(_spender, type(uint256).max);
    }

    function CancelApporveEcoSystem(address _spender) public onlyGov{
        uint256 allowanceAmount;
        allowanceAmount = usdt.allowance(address(this), _spender);
        usdt.safeDecreaseAllowance(_spender,allowanceAmount);
    }

    function handleDevGovFees(uint _pairIndex, uint _leveragedPositionSize) external view returns(uint fee){
        fee = _leveragedPositionSize * priceAggregator.openFeeP(_pairIndex) / PRECISION / 100;
    }

    function handlePlatformFee(uint _amount, uint _excutionFee) external onlyTrading{
        platformFee += _amount;
        govFeesUsdt += _excutionFee;
    }

    function handlePlatFormFeeFromNft(address _from, uint _amount) external onlyTrading{
        platformFee += _amount;
        usdt.safeTransferFrom(_from, address(this), _amount);
        emit NftEarned(_from, _amount);
    }

    function distributePlatformFee() external onlyTrading{
        IPToken p = IPToken(vault);
        
        if(platformFee > 0) {
            require(usdt.balanceOf(address(this)) >= platformFee, "UADT_NOT_ENOUGH");

            uint usdtToVault = (platformFee * vaultFeeP) / 100;
            uint usdtToEcosystem = (platformFee * ecosystemFeeP) / 100;
            govFeesUsdt += (platformFee * govFeeP) / 100;

            p.receiveAssets(usdtToVault, msg.sender);
            ecosystemManage.receiveEcosystemFees(usdtToEcosystem);
            usdt.safeTransfer(gov, govFeesUsdt);

            emit DistributePlatformFee(platformFee);
            emit GovFeeReceived(govFeesUsdt);
            delete platformFee;
            delete govFeesUsdt;
            
        }
    }

   // transfer usdt
    function transferUsdt(address _from, address _to, uint _amount) external onlyTrading{ 
        if(_from == address(this)){
            usdt.safeTransfer(_to, _amount);
        }else{
            usdt.safeTransferFrom(_from, _to, _amount);
        }
    }

    function transferLinkToAggregator(address _from, uint _pairIndex, uint _leveragedPosUsdt) external onlyTrading{ 
        linkErc677.transferFrom(_from, address(priceAggregator), priceAggregator.linkFee(_pairIndex, _leveragedPosUsdt)); 
    }

    // Manage upnl lock id
    function increaseUpnlLastId() external onlyTrading{
        upnlLastId += 1;
        emit upnlLastIdUpdated(upnlLastId);
    }

    // View utils functions
    function firstEmptyTradeIndex(address trader, uint pairIndex) public view returns(uint index){
        for(uint i = 0; i < maxTradesPerPair; i++){
            if(openTrades[trader][pairIndex][i].leverage == 0){ index = i; break; }
        }
    }
    function firstEmptyOpenLimitIndex(address trader, uint pairIndex) public view returns(uint index){
        for(uint i = 0; i < maxTradesPerPair; i++){
            if(!hasOpenLimitOrder(trader, pairIndex, i)){ index = i; break; }
        }
    }
    function hasOpenLimitOrder(address trader, uint pairIndex, uint index) public view returns(bool){
        if(openLimitOrders.length == 0){ return false; }
        OpenLimitOrder storage o = openLimitOrders[openLimitOrderIds[trader][pairIndex][index]];
        return o.trader == trader && o.pairIndex == pairIndex && o.index == index;
    }

    // Additional getters
    function pairTradersArray(uint _pairIndex) external view returns(address[] memory){ 
        return pairTraders[_pairIndex]; 
    }
    function getPendingOrderIds(address _trader) external view returns(uint[] memory){ 
        return pendingOrderIds[_trader]; 
    }
    function pendingOrderIdsCount(address _trader) external view returns(uint){ 
        return pendingOrderIds[_trader].length; 
    }
    function getAllOpenTradesByTrader(address _trader) external view returns(AllTrades[] memory){
        uint pairsCount = pairsStorage.pairsCount();
        uint count = 0;
        for(uint i = 0; i < pairsCount; i ++){
            count += openTradesCount[_trader][i];
        }

        uint index = 0;
        AllTrades[] memory result = new AllTrades[](count);
        for(uint i = 0; i < pairsCount; i++){
            uint realCount = 0;
            for(uint j = 0; j < maxTradesPerPair; j++){
                if(realCount == openTradesCount[_trader][i]){
                    break;
                }
                if(openTrades[_trader][i][j].leverage == 0){
                    continue;
                }
                
                Trade memory t = openTrades[_trader][i][j];

                result[index].trade = t;
                result[index].tradeInfo = openTradesInfo[_trader][i][j];
                result[index].liqPrice = pairsInfos.getTradeLiquidationPrice(
                    _trader,
                    i,
                    j,
                    t.openPrice,
                    t.buy,
                    t.positionSizeUsdt,
                    t.leverage
                );
                result[index].rolloverFee = pairsInfos.getTradeRolloverFee(
                    _trader,
                    i,
                    j,
                    t.positionSizeUsdt
                );
                result[index].fundingFee = pairsInfos.getTradeFundingFee(
                    _trader,
                    i,
                    j,
                    t.buy,
                    t.positionSizeUsdt,
                    t.leverage
                );

                realCount ++; 
                index++;
            }
        }
        return result;
    }
    function getOpenLimitOrder(
        address _trader, 
        uint _pairIndex,
        uint _index
    ) external view returns(OpenLimitOrder memory){ 
        require(hasOpenLimitOrder(_trader, _pairIndex, _index));
        return openLimitOrders[openLimitOrderIds[_trader][_pairIndex][_index]]; 
    }
    function getOpenLimitOrders() external view returns(OpenLimitOrder[] memory){ 
        return openLimitOrders; 
    }
    function getUpnlLastId() external view returns(uint256){
        return upnlLastId;
    }
    function pendingAdlOrders(uint _orderId) external view returns(PendingAdlOrder[] memory){ 
        return reqID_pendingAdlOrder[_orderId]; 
    }
    function pendingAdlOrdersCount(uint _orderId) external view returns(uint){ 
        return reqID_pendingAdlOrder[_orderId].length; 
    }
}