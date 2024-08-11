// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import '@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol';

interface IesPEX is IERC20Upgradeable{
    function convert2PEX(address _address,uint256 _amount) external;
    function convert2EsPEX(address _address,uint256 _amount) external;
}