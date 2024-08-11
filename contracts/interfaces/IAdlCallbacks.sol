// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

interface IAdlCallbacks{
    struct AggregatorBatchAnswer{uint orderId;uint[] pairIndices; uint[] prices; uint[] spreadPs;}
    function executeAdlCloseOrderCallback(AggregatorBatchAnswer memory) external;
}