// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

interface IPEXPairInfos{
    function maxNegativePnlOnOpenP() external view returns(uint); // PRECISION (%)
    function LIQ_THRESHOLD_P() external view returns(uint);

    function storeTradeInitialAccFees(
        address trader,
        uint pairIndex,
        uint index,
        bool long
    ) external;

    function getTradePriceImpact(
        uint openPrice,   // PRECISION
        uint pairIndex,
        bool long,
        uint openInterest // USDT
    ) external view returns(
        uint priceImpactP,      // PRECISION (%)
        uint priceAfterImpact   // PRECISION
    );

   function getTradeLiquidationPrice(
        address trader,
        uint pairIndex,
        uint index,
        uint openPrice,  // PRECISION
        bool long,
        uint collateral, // USDT
        uint leverage
    ) external view returns(uint); // PRECISION

    function getTradeRolloverFee(
        address trader,
        uint pairIndex,
        uint index,
        uint collateral // USDT
    ) external view returns(uint);

    function getTradeFundingFee(
        address trader,
        uint pairIndex,
        uint index,
        bool long,
        uint collateral, // USDT
        uint leverage
    ) external view returns(int);

    function getTradeValue(
        address trader,
        uint pairIndex,
        uint index,
        bool long,
        uint collateral,   // USDT
        uint leverage,
        int percentProfit, // PRECISION (%)
        uint closingFee    // USDT
    ) external returns(uint amount, uint rolloverFee); // USDT

    function adlStoreAccFundingFees(uint pairIndex) external;
}