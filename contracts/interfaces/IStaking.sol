// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./IStorageT.sol";
import "./IEcosystemManage.sol";


interface IStaking{
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
    }

    function rewardSettlement(uint) external;
    function pexStakingVar() external view returns(stakingVar memory);
    function esPEXStakingVar() external view returns(stakingVar memory);
    function PLPStakingVar() external view returns(stakingVar memory);
}