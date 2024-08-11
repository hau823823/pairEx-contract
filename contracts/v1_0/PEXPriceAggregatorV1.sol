// SPDX-License-Identifier: MIT
import '@chainlink/contracts/src/v0.8/ChainlinkClient.sol';
import '../interfaces/ICallbacks.sol';
import '../interfaces/IAdlCallbacks.sol';
import '../interfaces/IChainlinkFeed.sol';
import '../interfaces/IStorageT.sol';

pragma solidity 0.8.17;

contract PEXPriceAggregatorV1 is ChainlinkClient{
    using Chainlink for Chainlink.Request;
    
    // Contracts (constant)
    IStorageT public immutable storageT;

    // Contracts (adjustable)
    IPairsStorage public pairsStorage;
    IChainlinkFeed public linkPriceFeed;

    // Params (constant)
    uint constant PRECISION = 1e10;
    uint constant MAX_ORACLE_NODES = 20;
    uint constant MIN_ANSWERS = 1;

    // Params (adjustable)
    uint public minAnswers;

    // Custom data types
    enum OrderType {
        MARKET_OPEN, 
        MARKET_CLOSE, 
        LIMIT_OPEN, 
        LIMIT_CLOSE, 
        UPDATE_SL,
        ADL_CLOSE
    }

    struct Order{
        uint pairIndex;
        OrderType orderType;
        uint linkFeePerNode;
        bool initiated;
    }

    struct BatchOrder{
        uint[] pairIndices;
        OrderType orderType;
        uint linkFeePerNode;
        bool initiated;
    }

    struct PendingSl{
        address trader;
        uint pairIndex;
        uint index;
        uint openPrice;
        bool buy;
        uint newSl;
    }

    struct BatchPirceData{
        uint[] pairIndices;
        uint[] batchPrices;
        uint[] batchFeedPrices;
    }

    struct Value{
        uint feedPrice;
        uint price;
        uint aggregatorLength;
    }

    // State
    address[] public nodes;

    mapping(uint => Order) public orders;
    mapping(uint => BatchOrder) public batchOrders;
    mapping(bytes32 => uint) public orderIdByRequest;
    mapping(uint => uint[]) public ordersAnswers;
    mapping(uint => mapping(uint => uint[])) public batchOrdersAnswers;

    mapping(uint => PendingSl) public pendingSlOrders;

    // Events
    event PairsStorageUpdated(address value);
    event LinkPriceFeedUpdated(address value);
    event MinAnswersUpdated(uint value);

    event NodeAdded(uint index, address value);
    event NodeReplaced(uint index, address oldNode, address newNode);
    event NodeRemoved(uint index, address oldNode);

    event PriceRequested(
        uint indexed orderId,
        bytes32 indexed job,
        uint indexed pairIndex,
        OrderType orderType,
        uint nodesCount,
        uint linkFeePerNode
    );

    event PriceReceived(
        bytes32 request,
        uint indexed orderId,
        address indexed node,
        uint indexed pairIndex,
        uint price,
        uint referencePrice,
        uint linkFee
    );

    event BatchPriceRequested(
        uint indexed orderId,
        bytes32 indexed job,
        uint[] pairIndex,
        OrderType orderType,
        uint nodesCount,
        uint linkFeePerNode
    );

    event BatchPriceReceived(
        bytes32 request,
        uint indexed orderId,
        address indexed node,
        BatchPirceData batchPriceData,
        bool succed
    );

    constructor(
        address _linkToken,
        IStorageT _storageT,
        IPairsStorage _pairsStorage,
        IChainlinkFeed _linkPriceFeed,
        uint _minAnswers,
        address[] memory _nodes
    ){
        require(address(_storageT) != address(0)
            && address(_pairsStorage) != address(0)
            && address(_linkPriceFeed) != address(0)
            && _minAnswers >= MIN_ANSWERS
            && _minAnswers % 2 == 1
            && _nodes.length > 0
            && _linkToken != address(0), "WRONG_PARAMS");

        storageT = _storageT;
        pairsStorage = _pairsStorage;
        linkPriceFeed = _linkPriceFeed;
        minAnswers = _minAnswers;
        nodes = _nodes;

        setChainlinkToken(_linkToken);
    }

    // Modifiers
    modifier onlyGov(){
        require(msg.sender == storageT.gov(), "GOV_ONLY");
        _;
    }
    modifier onlyTrading(){
        require(msg.sender == storageT.trading() || msg.sender == storageT.adlClosing(), "TRADING_ONLY");
        _;
    }
    modifier onlyCallbacks(){
        require(msg.sender == storageT.callbacks(), "CALLBACKS_ONLY");
        _;
    }

    // Manage contracts
    function updatePairsStorage(IPairsStorage value) external onlyGov{
        require(address(value) != address(0), "VALUE_0");

        pairsStorage = value;
        
        emit PairsStorageUpdated(address(value));
    }
    function updateLinkPriceFeed(IChainlinkFeed value) external onlyGov{
        require(address(value) != address(0), "VALUE_0");

        linkPriceFeed = value;
        
        emit LinkPriceFeedUpdated(address(value));
    }

    // Manage params
    function updateMinAnswers(uint value) external onlyGov{
        require(value >= MIN_ANSWERS, "MIN_ANSWERS");
        require(value % 2 == 1, "EVEN");
        
        minAnswers = value;
        
        emit MinAnswersUpdated(value);
    }

    // Manage nodes
    function addNode(address a) external onlyGov{
        require(a != address(0), "VALUE_0");
        require(nodes.length < MAX_ORACLE_NODES, "MAX_ORACLE_NODES");

        for(uint i = 0; i < nodes.length; i++){
            require(nodes[i] != a, "ALREADY_LISTED");
        }

        nodes.push(a);

        emit NodeAdded(nodes.length - 1, a);
    }
    function replaceNode(uint index, address a) external onlyGov{
        require(index < nodes.length, "WRONG_INDEX");
        require(a != address(0), "VALUE_0");

        emit NodeReplaced(index, nodes[index], a);

        nodes[index] = a;
    }
    function removeNode(uint index) external onlyGov{
        require(index < nodes.length, "WRONG_INDEX");

        emit NodeRemoved(index, nodes[index]);

        nodes[index] = nodes[nodes.length - 1];
        nodes.pop();
    }

    // On-demand price request to oracles network
    function getPrice(
        uint pairIndex,
        OrderType orderType,
        uint leveragedPosUsdt
    ) external onlyTrading returns(uint){

        (string memory from, , bytes32 job, uint orderId) =
            pairsStorage.pairJob(pairIndex);
        
        Chainlink.Request memory linkRequest = buildChainlinkRequest(
            job,
            address(this),
            this.fulfill.selector
        );

        linkRequest.addUint(from, pairIndex);

        uint linkFeePerNode = linkFee(pairIndex, leveragedPosUsdt) / nodes.length;
        
        orders[orderId] = Order(
            pairIndex, 
            orderType, 
            linkFeePerNode,
            true
        );

        for(uint i = 0; i < nodes.length; i ++){
            orderIdByRequest[sendChainlinkRequestTo(
                nodes[i],
                linkRequest,
                linkFeePerNode
            )] = orderId;
        }

        emit PriceRequested(
            orderId,
            job,
            pairIndex,
            orderType,
            nodes.length,
            linkFeePerNode
        );

        return orderId;
    }

    function batchGetPrice(
        uint[] calldata pairIndices,
        OrderType orderType,
        uint leveragedPosUsdt
    ) external onlyTrading returns(uint){

        (, , bytes32 job, uint orderId) =
            pairsStorage.pairJob(pairIndices[0]);
        
        Chainlink.Request memory linkRequest = buildChainlinkRequest(
            job,
            address(this),
            this.batchFulfill.selector
        );

        for(uint i = 0; i < pairIndices.length; i++){
            IPairsStorage.Pair memory p = pairsStorage.getPairs(i);
            linkRequest.addUint(p.from, pairIndices[i]);
        }

        uint linkFeePerNode = linkFee(pairIndices[0], leveragedPosUsdt) / nodes.length;
        
        batchOrders[orderId] = BatchOrder(
            pairIndices, 
            orderType, 
            linkFeePerNode,
            true
        );

        for(uint i = 0; i < nodes.length; i ++){
            orderIdByRequest[sendChainlinkRequestTo(
                nodes[i],
                linkRequest,
                linkFeePerNode
            )] = orderId;
        }

        emit BatchPriceRequested(
            orderId,
            job,
            pairIndices,
            orderType,
            nodes.length,
            linkFeePerNode
        );

        return orderId;
    }

    // Fulfill on-demand price requests
    function fulfill(
        bytes32 requestId,
        uint[] calldata prices
    ) external recordChainlinkFulfillment(requestId){
        uint price = prices[0];

        uint orderId = orderIdByRequest[requestId];
        Order memory r = orders[orderId];

        delete orderIdByRequest[requestId];

        if(!r.initiated){
            return;
        }

        uint[] storage answers = ordersAnswers[orderId];
        uint feedPrice;

        IPairsStorage.Feed memory f = pairsStorage.pairFeed(r.pairIndex);
        (, int feedPrice1, , , ) = IChainlinkFeed(f.feed1).latestRoundData();

        if(f.feedCalculation == IPairsStorage.FeedCalculation.DEFAULT){
            feedPrice = uint(feedPrice1 * int(PRECISION) / 1e8);

        }else if(f.feedCalculation == IPairsStorage.FeedCalculation.INVERT){
            feedPrice = uint(int(PRECISION) * 1e8 / feedPrice1);

        }else{
            (, int feedPrice2, , , ) = IChainlinkFeed(f.feed2).latestRoundData();
            feedPrice = uint(feedPrice1 * int(PRECISION) / feedPrice2);
        }

        if(price == 0
        || (price >= feedPrice ?
            price - feedPrice :
            feedPrice - price
        ) * PRECISION * 100 / feedPrice <= f.maxDeviationP){

            answers.push(price);

            if(answers.length == minAnswers){
                ICallbacks.AggregatorAnswer memory a;

                a.orderId = orderId;
                a.price = median(answers);
                a.spreadP = pairsStorage.pairSpreadP(r.pairIndex);

                ICallbacks c = ICallbacks(storageT.callbacks());

                if(r.orderType == OrderType.MARKET_OPEN){
                    c.openTradeMarketCallback(a);

                }else if(r.orderType == OrderType.MARKET_CLOSE){
                    c.closeTradeMarketCallback(a);

                }else if(r.orderType == OrderType.LIMIT_OPEN){
                    c.executeNftOpenOrderCallback(a);

                }else if(r.orderType == OrderType.LIMIT_CLOSE){
                    c.executeNftCloseOrderCallback(a);

                }else{
                    c.updateSlCallback(a);
                }

                delete orders[orderId];
                delete ordersAnswers[orderId];
            }

            emit PriceReceived(
                requestId,
                orderId,
                msg.sender,
                r.pairIndex,
                price,
                feedPrice,
                r.linkFeePerNode
            );
        }
    }

    function batchFulfill(
        bytes32 requestId,
        uint[] calldata prices
    ) external recordChainlinkFulfillment(requestId){

        uint orderId = orderIdByRequest[requestId];
        BatchOrder memory r = batchOrders[orderId];

        delete orderIdByRequest[requestId];

        if(!r.initiated || r.orderType != OrderType.ADL_CLOSE){
            return;
        }

        IAdlCallbacks.AggregatorBatchAnswer memory a;

        Value memory v;

        uint[] storage batchAnswers;

        BatchPirceData memory batchPirceData;
        batchPirceData.batchFeedPrices = new uint[](r.pairIndices.length);
        batchPirceData.batchPrices = new uint[](r.pairIndices.length);

        uint[] memory batchSpeadPs = new uint[](r.pairIndices.length);

        for(uint i = 0; i < r.pairIndices.length; i++){
            batchAnswers = batchOrdersAnswers[orderId][i];

            IPairsStorage.Feed memory f = pairsStorage.pairFeed(r.pairIndices[i]);
            (, int feedPrice1, , , ) = IChainlinkFeed(f.feed1).latestRoundData();

            if(f.feedCalculation == IPairsStorage.FeedCalculation.DEFAULT){
                v.feedPrice = uint(feedPrice1 * int(PRECISION) / 1e8);

            }else if(f.feedCalculation == IPairsStorage.FeedCalculation.INVERT){
                v.feedPrice = uint(int(PRECISION) * 1e8 / feedPrice1);

            }else{
                (, int feedPrice2, , , ) = IChainlinkFeed(f.feed2).latestRoundData();
                v.feedPrice = uint(feedPrice1 * int(PRECISION) / feedPrice2);
            }

            v.price = prices[i];
            batchPirceData.batchFeedPrices[i] = v.feedPrice;
            batchAnswers.push(v.price);

            if(v.price == 0
            || (v.price >= v.feedPrice ?
                v.price - v.feedPrice :
                v.feedPrice - v.price
            ) * PRECISION * 100 / v.feedPrice <= f.maxDeviationP){

                if(batchAnswers.length == minAnswers){
                    batchPirceData.batchPrices[i] = median(batchAnswers);
                    batchSpeadPs[i] = pairsStorage.pairSpreadP(r.pairIndices[i]);
                    v.aggregatorLength ++ ;
                    delete batchOrdersAnswers[orderId][i];
                }
            } else {
                return;
            }
        }

        if((v.aggregatorLength == r.pairIndices.length) 
        && (v.aggregatorLength == prices.length)) {
            a.orderId = orderId;
            a.pairIndices = r.pairIndices;
            a.prices = batchPirceData.batchPrices;
            a.spreadPs = batchSpeadPs;

            bool succed = executeAdlCallbacks(a);

            storageT.unregisterPendingAdlOrder(orderId);

            delete batchOrders[orderId];

            emit BatchPriceReceived(
                requestId,
                orderId,
                msg.sender,
                batchPirceData,
                succed
            );
        }
    }

    function executeAdlCallbacks(IAdlCallbacks.AggregatorBatchAnswer memory a) private returns(bool success) {
        IAdlCallbacks c = IAdlCallbacks(storageT.adlCallbacks());

            try c.executeAdlCloseOrderCallback(a) {
                return true;
            } catch {
                return false;
            }
    }

    // Calculate LINK fee for each request
    function linkFee(uint pairIndex, uint leveragedPosUsdt) public view returns(uint){
        (, int linkPriceUsd, , , ) = linkPriceFeed.latestRoundData();

        leveragedPosUsdt = 1000 * 1e6;
        return pairsStorage.pairOracleFeeP(pairIndex)
            * leveragedPosUsdt * 1e20 / uint(linkPriceUsd) / PRECISION / 100;
    }

    // Manage pending SL orders
    function storePendingSlOrder(uint orderId, PendingSl calldata p) external onlyTrading{
        pendingSlOrders[orderId] = p;
    }
    function unregisterPendingSlOrder(uint orderId) external{
        require(msg.sender == storageT.callbacks(), "CALLBACKS_ONLY");

        delete pendingSlOrders[orderId];
    }

    // Claim back LINK tokens (if contract will be replaced for example)
    function claimBackLink() external onlyGov{
        ITokenV1 link = storageT.linkErc677();

        link.transfer(storageT.gov(), link.balanceOf(address(this)));
    }

    // Median function
    function swap(uint[] memory array, uint i, uint j) private pure{
        (array[i], array[j]) = (array[j], array[i]);
    }
    function sort(uint[] memory array, uint begin, uint end) private pure{
        if (begin >= end) { return; }

        uint j = begin;
        uint pivot = array[j];

        for (uint i = begin + 1; i < end; ++i) {
            if (array[i] < pivot) {
                swap(array, i, ++j);
            }
        }

        swap(array, begin, j);
        sort(array, begin, j);
        sort(array, j + 1, end);
    }
    function median(uint[] memory array) private pure returns(uint){
        sort(array, 0, array.length);

        return array.length % 2 == 0 ?
            (array[array.length / 2 - 1] + array[array.length / 2]) / 2 :
            array[array.length / 2];
    }

    // Storage v1 compatibility
    function openFeeP(uint pairIndex) external view returns(uint){
        return pairsStorage.pairOpenFeeP(pairIndex);
    }
}