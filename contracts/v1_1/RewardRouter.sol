// contracts/Vester.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "../libraries/StakingLib.sol";

contract RewardRouter is Initializable {
    using MathUpgradeable for uint;
    using StakingLib for StakingLib.stakingVar;

    StakingLib.stakingVar public pexStakingVar;
    StakingLib.stakingVar public esPEXStakingVar;

    event StakerEvent(address indexed addr, string str, uint amount);

    function initialize(
        address _PEX,
        address _esPEX,
        address _storageT,
        address _ecosystemManage,
        address _usdt
    ) external initializer {
        require(
            _PEX != address(0) &&
            _esPEX != address(0) &&
            _storageT != address(0) &&
            _ecosystemManage != address(0) &&
            _usdt != address(0)
        );

        pexStakingVar.rewardERC20 = IERC20(_usdt);
        pexStakingVar.storageT = IStorageT(_storageT);
        pexStakingVar.ecosystemManage = IEcosystemManage(_ecosystemManage);
        pexStakingVar.stakeERC20 = IERC20(_PEX);
        pexStakingVar.minNewRewardAmount = 1e6;
        pexStakingVar.minStakeAmount = 1e18;
        pexStakingVar.unStakingLockDuration = 60 * 60 * 24 * 7;

        esPEXStakingVar.rewardERC20 = IERC20(_usdt);
        esPEXStakingVar.storageT = IStorageT(_storageT);
        esPEXStakingVar.ecosystemManage = IEcosystemManage(_ecosystemManage);
        esPEXStakingVar.stakeERC20 = IERC20(_esPEX);
        esPEXStakingVar.minNewRewardAmount = 1e6;
        esPEXStakingVar.minStakeAmount = 1e18;
        esPEXStakingVar.unStakingLockDuration = 60 * 60 * 24 * 7;
    }

    modifier notContract(){
        require(tx.origin == msg.sender);
        _;
    }

    function userStakingPEX(address _address) external view returns (StakingLib.stakingData memory){
        return pexStakingVar.userStaking[_address];
    }

    function updatePexMinNewRewardAmount(uint _minNewRewardAmount) external{
        pexStakingVar.updateMinNewRewardAmount(_minNewRewardAmount);
    }

    function updatePexUnStakingLockDuration(uint _unStakingLockDuration) external{
        pexStakingVar.updateUnStakingLockDuration(_unStakingLockDuration);
    }
    
    function updatePexMinStakeAmount(uint _minStakeAmount) external{
        pexStakingVar.updateMinStakeAmount(_minStakeAmount);
    }

    function stakePEX(uint _amount) external notContract {
        pexStakingVar.stake(_amount);
        emit StakerEvent(msg.sender, "stakePEX", _amount);
    }

    function unStakePEX(uint _amount) external notContract {
        pexStakingVar.unStake(_amount);
        emit StakerEvent(msg.sender, "unStakePEX", _amount);
    }

    function withdrawPEX() external notContract {
        uint unStakingAmount = pexStakingVar.userStaking[msg.sender].unStakingAmount;
        pexStakingVar.withdraw();
        emit StakerEvent(msg.sender, "withdrawPEX", unStakingAmount);
    }

    function claimPEX() external notContract {
        uint rewardAmount = pexStakingVar.userStaking[msg.sender].rewardAmount;
        pexStakingVar.claim();
        emit StakerEvent(msg.sender, "claimPEX", rewardAmount);
    }

    function withdrawAndClaimPex() external notContract {
        uint unStakingAmount = pexStakingVar.userStaking[msg.sender].unStakingAmount;
        uint rewardAmount = pexStakingVar.userStaking[msg.sender].rewardAmount;

        if (unStakingAmount > 0) {
            pexStakingVar.withdraw();
            emit StakerEvent(msg.sender, "withdrawEsPEX", unStakingAmount);
        }

        if (rewardAmount > 0) {
            pexStakingVar.claim();
            emit StakerEvent(msg.sender, "claimEsPEX", rewardAmount);
        }
    }

    function userStakingEsPEX(address _address) external view returns (StakingLib.stakingData memory){
        return esPEXStakingVar.userStaking[_address];
    }

    function updateEsPexMinNewRewardAmount(uint _minNewRewardAmount) external{
        esPEXStakingVar.updateMinNewRewardAmount(_minNewRewardAmount);
    }

    function updateEsPexUnStakingLockDuration(uint _unStakingLockDuration) external{
        esPEXStakingVar.updateUnStakingLockDuration(_unStakingLockDuration);
    }

    function updateEsPexMinStakeAmount(uint _minStakeAmount) external{
        esPEXStakingVar.updateMinStakeAmount(_minStakeAmount);
    }

    function stakeEsPEX(uint _amount) external notContract {
        esPEXStakingVar.stake(_amount);
        emit StakerEvent(msg.sender, "stakeEsPEX", _amount);
    }

    function unStakeEsPEX(uint _amount) external notContract {
        esPEXStakingVar.unStake(_amount);
        emit StakerEvent(msg.sender, "unStakeEsPEX", _amount);
    }

    function withdrawEsPEX() external notContract {
        uint unStakingAmount = esPEXStakingVar.userStaking[msg.sender].unStakingAmount;
        esPEXStakingVar.withdraw();
        emit StakerEvent(msg.sender, "withdrawEsPEX", unStakingAmount);
    }

    function claimEsPEX() external notContract {
        uint rewardAmount = esPEXStakingVar.userStaking[msg.sender].rewardAmount;
        esPEXStakingVar.claim();
        emit StakerEvent(msg.sender, "claimEsPEX", rewardAmount);
    }

    function withdrawAndClaimEsPex() external notContract {
        uint unStakingAmount = esPEXStakingVar.userStaking[msg.sender].unStakingAmount;
        uint rewardAmount = esPEXStakingVar.userStaking[msg.sender].rewardAmount;

        if (unStakingAmount > 0) {
            esPEXStakingVar.withdraw();
            emit StakerEvent(msg.sender, "withdrawEsPEX", unStakingAmount);
        }

        if (rewardAmount > 0) {
            esPEXStakingVar.claim();
            emit StakerEvent(msg.sender, "claimEsPEX", rewardAmount);
        }
    }

    function rewardSettlement(uint _newRewardAmount) external {
        pexStakingVar.rewardSettlement(_newRewardAmount, esPEXStakingVar.allStaking, false);
        esPEXStakingVar.rewardSettlement(_newRewardAmount, pexStakingVar.allStaking, true);
    }
}