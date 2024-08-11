// contracts/Vester.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "../libraries/StakingLib.sol";

contract PLPStaking is Initializable {
    using StakingLib for StakingLib.stakingVar;

    StakingLib.stakingVar public PLPStakingVar;

    event StakerEvent(address indexed addr, string str, uint amount);

    function initialize(
        address _esPEX,
        address _storageT,
        address _ecosystemManage,
        address _PToken
    ) external initializer {
        require(
            _esPEX != address(0) &&
            _storageT != address(0) &&
            _ecosystemManage != address(0) &&
            _PToken != address(0)
        );

        PLPStakingVar.rewardERC20 = IERC20(_esPEX);
        PLPStakingVar.storageT = IStorageT(_storageT);
        PLPStakingVar.ecosystemManage = IEcosystemManage(_ecosystemManage);
        PLPStakingVar.stakeERC20 = IERC20(_PToken);

        PLPStakingVar.minStakeAmount = 1 * 1e6;
        PLPStakingVar.minNewRewardAmount = 1e18;
        PLPStakingVar.unStakingLockDuration = 60 * 60 * 24 * 14;
    }

    modifier notContract(){
        require(tx.origin == msg.sender);
        _;
    }

    function userStaking(address _address) external view returns (StakingLib.stakingData memory){
        return PLPStakingVar.userStaking[_address];
    }

    function rewardSettlement(uint _newRewardAmount) external {
        PLPStakingVar.rewardSettlement(_newRewardAmount, 0, true);
    }

    function updateMinNewRewardAmount(uint _minNewRewardAmount) external{
        PLPStakingVar.updateMinNewRewardAmount(_minNewRewardAmount);
    }

    function updateUnStakingLockDuration(uint _unStakingLockDuration) external{
        PLPStakingVar.updateUnStakingLockDuration(_unStakingLockDuration);
    }

    function updateMinStakeAmount(uint _minStakeAmount) external{
        PLPStakingVar.updateMinStakeAmount(_minStakeAmount);
    }

    function stake(uint _amount) external notContract {
        PLPStakingVar.stake(_amount);
        emit StakerEvent(msg.sender, "stakePLP", _amount);
    }

    function unStake(uint _amount) external notContract {
        PLPStakingVar.unStake(_amount);
        emit StakerEvent(msg.sender, "unStakePLP", _amount);
    }

    function withdraw() external notContract {
        uint unStakingAmount = PLPStakingVar.userStaking[msg.sender].unStakingAmount;
        PLPStakingVar.withdraw();
        emit StakerEvent(msg.sender, "withdraw", unStakingAmount);
    }

    function claim() external notContract {
        uint rewardAmount = PLPStakingVar.userStaking[msg.sender].rewardAmount;
        PLPStakingVar.claim();
        emit StakerEvent(msg.sender, "claim", rewardAmount);
    }

    function withdrawAndClaim() external notContract {
        uint unStakingAmount = PLPStakingVar.userStaking[msg.sender].unStakingAmount;
        uint rewardAmount = PLPStakingVar.userStaking[msg.sender].rewardAmount;

        if (unStakingAmount > 0) {
            PLPStakingVar.withdraw();
            emit StakerEvent(msg.sender, "withdrawEsPEX", unStakingAmount);
        }

        if (rewardAmount > 0) {
            PLPStakingVar.claim();
            emit StakerEvent(msg.sender, "claimEsPEX", rewardAmount);
        }
    }

}