// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

interface IReferralStorage {
    function getTraderReferralInfo(
        address _account
    ) external returns (bytes32, address);

    function distributeReferralAndSaveFee(
        address trader,
        uint256 tradeVolume,
        uint256 fee
    ) external returns (uint256 fessSave);

    function claimRebate() external;

    function claimSave() external;
}
