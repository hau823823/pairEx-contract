// contracts/StakingLib.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import '@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol';
import "../interfaces/IStorageT.sol";
import "../interfaces/IEcosystemManage.sol";

library StakingLib {
    using MathUpgradeable for uint;

    struct stakingData {
        uint stakingAmount;
        uint unStakingAmount;
        uint unStakingTimestamp;
        uint rewardAmount;
        bool isNew;
    }

    struct stakingVar {
        IERC20 rewardERC20;
        IStorageT storageT;
        IEcosystemManage ecosystemManage;
        IERC20 stakeERC20;

        uint allStaking;
        uint minNewRewardAmount;
        uint minStakeAmount;
        uint unStakingLockDuration;

        mapping(address => stakingData) userStaking;
        address[] addressStaking;
    }

    function requireGov(stakingVar storage self) internal view {
        require(msg.sender == self.storageT.gov(), "GOV_ONLY");
    }

    function requireWhiteList(stakingVar storage self) internal view {
        require(self.ecosystemManage.isAddrListed(msg.sender), "WHITE_LIST_ONLY");
    }

    function updateMinNewRewardAmount(stakingVar storage self, uint _minNewRewardAmount) internal {
        requireGov(self);
        self.minNewRewardAmount = _minNewRewardAmount;
    }

    function updateUnStakingLockDuration(stakingVar storage self, uint _unStakingLockDuration) internal {
        requireGov(self);
        self.unStakingLockDuration = _unStakingLockDuration;
    }

    function updateMinStakeAmount(stakingVar storage self, uint _minStakeAmount) internal {
        requireGov(self);
        require(_minStakeAmount > 0, "minStakeAmount too small");
        self.minStakeAmount = _minStakeAmount;
    }

    function rewardSettlement(stakingVar storage self, uint _newRewardAmount, uint _other_stake,bool is_transfer) internal {
        requireWhiteList(self);

        require(_newRewardAmount >= self.minNewRewardAmount, "_newRewardAmount too small");
        require(self.rewardERC20.balanceOf(msg.sender) >= _newRewardAmount, "Insufficient amount");
        require(self.rewardERC20.allowance(msg.sender, address(this)) >= _newRewardAmount, "please approve");
        require(self.allStaking != 0, "allStaking equal 0");

        uint i = 0;
        while (i < self.addressStaking.length) {

            // delete no staking and empty rewards address records
            if(self.userStaking[self.addressStaking[i]].stakingAmount == 0) {
                delete self.userStaking[self.addressStaking[i]].isNew;
                self.addressStaking[i] = self.addressStaking[self.addressStaking.length - 1];
                self.addressStaking.pop();
                continue;
            }

            self.userStaking[self.addressStaking[i]].rewardAmount += _newRewardAmount.mulDiv(
                self.userStaking[self.addressStaking[i]].stakingAmount,
                self.allStaking + _other_stake
            );

            i += 1;
        }

        if(is_transfer){
            // if is_transfer != 0 ,indicating that the stake income is shared. At this time,
            // only one transfer is required!
            require(self.rewardERC20.transferFrom(msg.sender, address(this), _newRewardAmount));
        }
    }

    function stake(stakingVar storage self, uint _amount) internal {
        require(_amount >= self.minStakeAmount, "_amount too small");
        require(self.stakeERC20.balanceOf(msg.sender) >= _amount, "Insufficient amount");
        require(self.stakeERC20.allowance(msg.sender, address(this)) >= _amount, "please approve");

        self.userStaking[msg.sender].stakingAmount += _amount;
        self.allStaking += _amount;
        if (self.userStaking[msg.sender].isNew == false) {
            self.userStaking[msg.sender].isNew = true;
            self.addressStaking.push(msg.sender);
        }

        require(self.stakeERC20.transferFrom(msg.sender, address(this), _amount));
    }

    function unStake(stakingVar storage self, uint _amount) internal {
        require(_amount > 0, "_amount is zero");
        require(self.userStaking[msg.sender].stakingAmount >= _amount, "Insufficient staking amount");
        require(self.userStaking[msg.sender].unStakingAmount == 0, "only one unStaking allow");

        self.allStaking -= _amount;
        self.userStaking[msg.sender].stakingAmount -= _amount;
        self.userStaking[msg.sender].unStakingAmount += _amount;
        self.userStaking[msg.sender].unStakingTimestamp = block.timestamp;
    }

    function withdraw(stakingVar storage self) internal {
        require(self.userStaking[msg.sender].unStakingAmount > 0, "Insufficient unStaking amount");
        require(block.timestamp > self.userStaking[msg.sender].unStakingTimestamp + self.unStakingLockDuration, "unStaking locking");

        uint unStakingAmount = self.userStaking[msg.sender].unStakingAmount;
        delete self.userStaking[msg.sender].unStakingTimestamp;
        delete self.userStaking[msg.sender].unStakingAmount;

        require(self.stakeERC20.transfer(msg.sender, unStakingAmount));
    }

    function claim(stakingVar storage self) internal {
        require(self.userStaking[msg.sender].rewardAmount > 0, "Insufficient rewardAmount");

        uint rewardAmount = self.userStaking[msg.sender].rewardAmount;
        delete self.userStaking[msg.sender].rewardAmount;

        require(self.rewardERC20.transfer(msg.sender, rewardAmount));
    }
}