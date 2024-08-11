// contracts/esPEX.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import '@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol';
import '@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol';
import "../interfaces/IStorageT.sol";
import "../interfaces/IesPEX.sol";


contract esPEX is ERC20Upgradeable, IesPEX {
    IERC20 public pex;
    IStorageT public storageT;

    mapping(address => bool) public  convert2PEXAddress;
    mapping(address => bool) public convert2EsPEXAddress;

    event Convert2PEX(address _address, uint256 _amount);
    event Convert2EsPEX(address _address, uint256 _amount);
    event UpdateAddress(string name, address _address, bool _allow);

    function initialize(
        string memory _name,
        string memory _symbol,
        address _PEX,
        address _storageT
    ) external initializer {
        require(
            _PEX != address(0) &&
            _storageT != address(0)
        );

        __ERC20_init(_name, _symbol);

        pex = IERC20(_PEX);
        storageT = IStorageT(_storageT);
    }

    modifier onlyConvert2PEXAddress() {
        require(convert2PEXAddress[msg.sender], "Not an allow address");
        _;
    }
    modifier onlyConvert2EsPEXAddress() {
        require(convert2EsPEXAddress[msg.sender], "Not an allow address");
        _;
    }

    modifier onlyGov(){
        require(msg.sender == storageT.gov(), "GOV_ONLY");
        _;
    }

    function setConvert2PEXAddress(address _address, bool _allow) public onlyGov {
        require(_address != address(0), "address not 0");
        convert2PEXAddress[_address] = _allow;
        emit UpdateAddress("setConvert2PEXAddress", _address, _allow);
    }

    function setConvert2EsPEXAddress(address _address, bool _allow) public onlyGov {
        require(_address != address(0), "address not 0");
        convert2EsPEXAddress[_address] = _allow;
        emit UpdateAddress("setConvert2EsPEXAddress", _address, _allow);
    }

    function convert2PEX(address _address, uint256 _amount) external onlyConvert2PEXAddress {
        require(balanceOf(_address) >= _amount, "Insufficient exPex amount");
        require(pex.balanceOf(address(this)) >= _amount, "Insufficient pex amount");

        _burn(_address, _amount);
        require(pex.transfer(msg.sender, _amount));
        emit Convert2PEX(_address, _amount);
    }

    function convert2EsPEX(address _address, uint256 _amount) external onlyConvert2EsPEXAddress {
        require(pex.allowance(msg.sender, address(this)) >= _amount, "please approve");
        require(pex.balanceOf(msg.sender) >= _amount, "Insufficient pex amount");

        _mint(_address, _amount);
        require(pex.transferFrom(msg.sender, address(this), _amount));
        emit Convert2EsPEX(_address, _amount);
    }
}