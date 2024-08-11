// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

interface IEcosystemManage{
    function receiveEcosystemFees(uint) external;
    function isAddrListed(address) external view returns (bool);
}