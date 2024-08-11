// SPDX-License-Identifier: MIT
import './IPairsStorage.sol';
pragma solidity 0.8.17;

interface IAggregator{
    enum OrderType { MARKET_OPEN, MARKET_CLOSE, LIMIT_OPEN, LIMIT_CLOSE, UPDATE_SL, ADL_CLOSE }
    function pairsStorage() external view returns(IPairsStorage);
    function getPrice(uint,OrderType,uint) external returns(uint);
    function batchGetPrice(uint[] calldata,OrderType,uint) external returns(uint);
    function linkFee(uint,uint) external view returns(uint);
    function openFeeP(uint) external view returns(uint);
    function pendingSlOrders(uint) external view returns(PendingSl memory);
    function storePendingSlOrder(uint orderId, PendingSl calldata p) external;
    function unregisterPendingSlOrder(uint orderId) external;
    struct PendingSl{address trader; uint pairIndex; uint index; uint openPrice; bool buy; uint newSl; }
}
