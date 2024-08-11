// contracts/esPEX.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract PEX is ERC20 {

    uint constant PRECISION = 1e18;

    constructor(
        string memory _name,
        string memory _symbol,

        address _team,
        address _liquidity
    ) ERC20(_name, _symbol) {
        require(
            _team != address(0) &&
            _liquidity != address(0)
        );
        _mint(_team, 25000000 * PRECISION);
        _mint(_liquidity, 25000000 * PRECISION);
    }

    function getPrecision() external pure returns (uint){
        return PRECISION;
    }
}