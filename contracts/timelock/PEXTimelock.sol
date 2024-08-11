// SPDX-License-Identifier: MIT
import '@openzeppelin/contracts/governance/TimelockController.sol';

pragma solidity 0.8.17;

contract PEXTimelock is TimelockController {
    constructor(
        uint256 minDelay,
        address[] memory proposers,
        address[] memory executors,
        address admin
    ) TimelockController(minDelay, proposers, executors, admin) {}
}