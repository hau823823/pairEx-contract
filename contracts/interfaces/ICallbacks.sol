// SPDX-License-Identifier: MIT
import './IReferralStorage.sol';

pragma solidity 0.8.17;

interface ICallbacks{
    struct Values{
        uint posUsdt; 
        uint levPosUsdt; 
        int profitP; 
        uint price;
        uint liqPrice;
        uint usdtSentToTrader;
        uint reward1;
        uint reward2;
        uint reward3;
        uint referralSaveFee;
    }

    struct Fees{
        uint rolloverFee;
        int fundingFee;
        uint closingFee;
    }

    struct AggregatorAnswer{ 
        uint orderId; 
        uint price; 
        uint spreadP; 
    }

    function usdtVaultFeeP() external view returns(uint);
    function nftPassSaveFeeP() external view returns(uint);
    function lpFeeP() external view returns(uint);
    function sssFeeP() external view returns(uint);
    function MAX_SL_P() external view returns(uint);
    function MIN_SL_P() external view returns(uint);
    function MAX_GAIN_P() external view returns(uint);
    function MIN_GAIN_P() external view returns(uint);
    function openTradeMarketCallback(AggregatorAnswer memory) external;
    function closeTradeMarketCallback(AggregatorAnswer memory) external;
    function executeNftOpenOrderCallback(AggregatorAnswer memory) external;
    function executeNftCloseOrderCallback(AggregatorAnswer memory) external;
    function updateSlCallback(AggregatorAnswer memory) external;
    function withinExposureLimits(uint, bool, uint, uint) external view returns(bool);
    function callSendToVault(uint, address) external;
    function callVaultSendToTrader     (uint, address ) external;
    function referralStorage() external view returns(IReferralStorage);
    function executionFee() external view returns(uint);
}