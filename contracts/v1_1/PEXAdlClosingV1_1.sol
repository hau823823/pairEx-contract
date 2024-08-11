// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import '../interfaces/IStorageT.sol';

contract PEXAdlClosingV1_1 is Initializable {

    // Contracts (constant)
    IStorageT public storageT;

    // State
    bool public isPaused;

    // Events
    event Paused(bool isPaused);

    function initialize(
        address _storageT
    ) external initializer{
        require(address(_storageT) != address(0), "WRONG_PARAMS");

        storageT = IStorageT(_storageT);
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
    modifier notPaused(){
        require(!isPaused, "PAUSED");
        _;
    }

    // Manage state
    function paused() external onlyGov{
        isPaused = !isPaused;
        emit Paused(isPaused); 
    }
    
    // Execute adl order
    function executeAdlOrder(
        IStorageT.AdlOrder[] calldata adlTypes, 
        address[] calldata traders, 
        uint[] calldata pairIndices, 
        uint[] calldata indices,
        uint[] calldata priceFeedIndices
    ) external notContract notPaused {

        address sender = msg.sender;

        IStorageT.Trade memory t;
        IStorageT.PendingAdlOrder memory p;

        require(storageT.isBotListed(sender), "NOT_IN_BOTLISTS");

        require(adlTypes.length == traders.length
            && adlTypes.length == pairIndices.length
            && adlTypes.length == indices.length, "WRONG_LENGTH");

        require(priceFeedIndices.length > 0, "NO_FEED_INDICES");

        for(uint i = 0; i < adlTypes.length; i++){
            t = storageT.openTrades(traders[i], pairIndices[i], indices[i]);
            require(t.leverage > 0, "NO_TRADE");
        }

        uint orderId = storageT.priceAggregator().batchGetPrice(priceFeedIndices, IAggregator.OrderType.ADL_CLOSE,1);

        for(uint i = 0; i < adlTypes.length; i++){
            // store pending adl order
            p.nftHolder = sender;
            p.trader = traders[i];
            p.pairIndex = pairIndices[i];
            p.index = indices[i];
            p.adlType = adlTypes[i];   
            storageT.storePendingAdlOrder(p, orderId); 
        }
    }
}