// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import './IStorageT.sol';

interface ITradeRegister{
    struct Fees{ uint rolloverFee; int fundingFee; uint closingFee; }
    function registerTrade(IStorageT.Trade memory, uint, uint) external returns (IStorageT.Trade memory);
    function unregisterTrade(IStorageT.Trade memory, int, uint, uint, uint) external returns (uint, Fees memory);
}