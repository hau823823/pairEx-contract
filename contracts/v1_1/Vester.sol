// contracts/Vester.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import '@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol';
import "../interfaces/IStorageT.sol";
import "../interfaces/IesPEX.sol";


contract Vester is Initializable {
    using MathUpgradeable for uint;

    IERC20 public pex;
    IesPEX public esPEX;
    IStorageT public storageT;

    uint minVestAmount;
    uint public govPexCount;
    uint secondPerDay;
    uint8 public maxVestCount;
    uint8[4] vestType;

    struct VestInfo {
        uint8 vestType;
        uint amount;
        uint beginTimestamp;
        uint alreadyClaim;
    }

    mapping(address => mapping( uint8 => VestInfo)) public addressVestInfos;

    event NumberUpdated(string name,uint value);
    event Vest(address _sender, uint8 vestType, uint amount, uint blockTimestamp, uint govPexCount);
    event Claim(address _sender, uint[] _amount);

    function initialize(
        address _PEX,
        address _esPEX,
        address _storageT
    ) external initializer {
        require(
            _PEX != address(0) &&
            _esPEX != address(0) &&
            _storageT != address(0)
        );

        pex = IERC20(_PEX);
        esPEX = IesPEX(_esPEX);
        storageT = IStorageT(_storageT);

        minVestAmount = 1e18;
        govPexCount = 0;
        secondPerDay = 60 * 60 * 24;
        maxVestCount = 3;
        vestType = [60, 70, 80, 100];
    }

    modifier onlyGov(){
        require(msg.sender == storageT.gov(), "GOV_ONLY");
        _;
    }

    modifier notContract(){
        require(tx.origin == msg.sender);
        _;
    }

    function updateSecondPerDay(uint _secondPerDay) public onlyGov {
        secondPerDay = _secondPerDay;
        emit NumberUpdated("secondPerDay", secondPerDay);
    }

    function updateMinVestAmount(uint _minVestAmount) public onlyGov {
        minVestAmount = _minVestAmount;
        emit NumberUpdated("minVestAmount", minVestAmount);
    }

    function updateMaxVestCount(uint8 _MaxVestCount) public onlyGov {
        maxVestCount = _MaxVestCount;
        emit NumberUpdated("MaxVestCount", maxVestCount);
    }

    function vest(uint8 _vestType, uint amount) external notContract {
        require(_vestType < vestType.length, "Invalid vestType");
        require(amount >= minVestAmount, "amount too small");
        require(esPEX.balanceOf(msg.sender) >= amount, "Insufficient amount");

        for (uint8 i = 0; i < maxVestCount; i++) {
            if (addressVestInfos[msg.sender][i].beginTimestamp == 0) {
                addressVestInfos[msg.sender][i] = VestInfo(_vestType, amount, block.timestamp, 0);
                esPEX.convert2PEX(msg.sender, amount);
                govPexCount += amount - amount.mulDiv(vestType[_vestType], 100);
                emit Vest(msg.sender, _vestType, amount, block.timestamp, govPexCount);
                return;
            }
        }
        revert("Insufficient vest count");
    }

    function getVesting(address _vester) view public returns (uint[] memory){
        uint[] memory sum = new uint[](maxVestCount);
        uint blockTimestamp = block.timestamp;
        for (uint8 i = 0; i < maxVestCount; i++) {
            if (addressVestInfos[_vester][i].beginTimestamp == 0) {
                continue;
            }
            VestInfo memory vestInfos = addressVestInfos[_vester][i];
            uint actualDay = (blockTimestamp - vestInfos.beginTimestamp) / secondPerDay;
            uint expectDay = (vestInfos.vestType + 1) * 30;
            if (actualDay > expectDay) {
                expectDay = actualDay;
            }

            uint vestTypeP = vestType[vestInfos.vestType];
            uint256 amount = (vestInfos.amount).mulDiv(vestTypeP, 100).mulDiv(actualDay, expectDay);
            sum[i] = amount - vestInfos.alreadyClaim;
        }
        return sum;
    }

    function claim() external notContract {
        uint[] memory vests = getVesting(msg.sender);
        uint8 emptyCount = 0;
        uint sum = 0;
        for (uint8 i = 0; i < maxVestCount; i++) {
            if (addressVestInfos[msg.sender][i].beginTimestamp == 0) {
                emptyCount++;
                continue;
            }

            if (vests[i] == 0) {
                continue;
            }

            addressVestInfos[msg.sender][i].alreadyClaim += vests[i];

            VestInfo memory vestInfos = addressVestInfos[msg.sender][i];
            uint vestTypeP = vestType[vestInfos.vestType];
            if (vestInfos.alreadyClaim == vestInfos.amount.mulDiv(vestTypeP, 100)) {
                delete addressVestInfos[msg.sender][i];
            }
            sum += vests[i];
        }

        require(emptyCount != maxVestCount, "vest not found");

        require(pex.transfer(msg.sender, sum));
        emit Claim(msg.sender, vests);
    }

    function claimGov() external onlyGov {
        require(govPexCount > 0, "GovPexCount is 0");
        pex.transfer(storageT.gov(), govPexCount);
        govPexCount = 0;
    }
}