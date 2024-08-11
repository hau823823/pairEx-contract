const helps = require("./shared/helpers")
const {ethers, network} = require("hardhat");
const BigNumber = require("bignumber.js")
const { GetConfig } = require("../../config/getConfig")

const ZERO_ADDR = "0x0000000000000000000000000000000000000000"

let addrMap = helps.createAddrRecorder("./contract_address.json");
let actionHandler = helps.createSettingRecorder("./forex_params_actions.json");

async function sendAction(func, params, label) {
    return await helps.sendActionWithPath(actionHandler, func, params, label)
  }

async function main() {

  const [deployer] = await ethers.getSigners();
  console.log("deployer is:", deployer.address, "network is:", network.name)

  let config = GetConfig();
  
  let eurPriceFeed
  let jpyPriceFeed
  let gbpPriceFeed
  let maxDeviationP

  if (network.name === helps.ARBI_GOERLI_NETWORK) {
    eurPriceFeed = config.address.btc_price_feed;
    jpyPriceFeed = config.address.btc_price_feed;
    gbpPriceFeed = config.address.btc_price_feed;
    //const audPriceFeed = config.address.aud_price_feed;
    //const chfPriceFeed = config.address.chf_price_feed;
    //const cadPriceFeed = config.address.cad_price_feed;

    maxDeviationP = BigInt(1e20)
  } else {
    eurPriceFeed = config.address.eur_price_feed;
    jpyPriceFeed = config.address.jpy_price_feed;
    gbpPriceFeed = config.address.gbp_price_feed;
    //const audPriceFeed = config.address.aud_price_feed;
    //const chfPriceFeed = config.address.chf_price_feed;
    //const cadPriceFeed = config.address.cad_price_feed;

    maxDeviationP = 10000000000
  }


  // 獲取合約
  const storageT = await helps.contractAt("PairexTradingStorageV1", addrMap.getAddr("PairexTradingStorageV1"))
  console.log("PairexTradingStorageV1 Addr: ", storageT.address)

  const pexPairsStorageV1 = await helps.contractAt("PEXPairsStorageV1", addrMap.getAddr("PEXPairsStorageV1"))
  console.log("PEXPairsStorageV1 Addr: ", pexPairsStorageV1.address)

  const pexPairInfosV1 = await helps.contractAt("PEXPairInfosV1", addrMap.getAddr("PEXPairInfosV1"))
  console.log("PEXPairInfosV1 Addr: ", pexPairInfosV1.address)
  
  // 配置相關參數
  // 1. 新增 group (forex)
  await sendAction(pexPairsStorageV1.addGroup, [
    [
      "forex",
      "0x9d89943ea8ea48928b26ed4d8b321fc2d59da0988979344399fe00c777a51b8e",
      10,   //minLeverage
      1000, //maxLeverage
      100    //maxColleteralP
    ]
  ], "pexPairsStorageV1.addGroup(Forex)")

  // 2. 新增 fee
  await sendAction(pexPairsStorageV1.addFee, [
    [
      "forex",
      120000000, // openFeeP
      120000000, // closeFeeP
      40000000,  // oracleFeep
      0,         // nftLimitOrderFeeP
      0,         // referralfeeP
      BigInt(10000 * 1e6) // minLevPosUsdt
    ]
  ], "pexPairsStorageV1.addFee(Forex)")

  // 3. 新增 pair
  await sendAction(pexPairsStorageV1.addPair, [
    [
      "EUR",
      "USD",
      [
        eurPriceFeed,
        ZERO_ADDR,
        0,
        maxDeviationP
      ],
      0, // spreadP
      1, // groupIndex
      1  // feeIndex
    ]
  ], "pexPairsStorageV1.addPair(EUR/USD)")

  await sendAction(pexPairsStorageV1.addPair, [
    [
      "USD",
      "JPY",
      [
        jpyPriceFeed,
        ZERO_ADDR,
        1,
        maxDeviationP
      ],
      0, // spreadP
      1, // groupIndex
      1  // feeIndex
    ]
  ], "pexPairsStorageV1.addPair(USD/JPY)")

  await sendAction(pexPairsStorageV1.addPair, [
    [
      "GBP",
      "USD",
      [
        gbpPriceFeed,
        ZERO_ADDR,
        0,
        maxDeviationP
      ],
      0, // spreadP
      1, // groupIndex
      1  // feeIndex
    ]
  ], "pexPairsStorageV1.addPair(GBP/USD)")

  /*
  await sendAction(pexPairsStorageV1.addPair, [
    [
      "AUD",
      "USD",
      [
        audPriceFeed,
        ZERO_ADDR,
        0,
        10000000000
      ],
      0, // spreadP
      1, // groupIndex
      1  // feeIndex
    ]
  ], "pexPairsStorageV1.addPair(AUD/USD)")

  await sendAction(pexPairsStorageV1.addPair, [
    [
      "USD",
      "CHF",
      [
        chfPriceFeed,
        ZERO_ADDR,
        1,
        10000000000
      ],
      0, // spreadP
      1, // groupIndex
      1  // feeIndex
    ]
  ], "pexPairsStorageV1.addPair(USD/CHF)")

  await sendAction(pexPairsStorageV1.addPair, [
    [
      "USD",
      "CAD",
      [
        cadPriceFeed,
        ZERO_ADDR,
        1,
        10000000000
      ],
      0, // spreadP
      1, // groupIndex
      1  // feeIndex
    ]
  ], "pexPairsStorageV1.addPair(USD/CAD)")
  */

  // 4. 配置 pair 參數
  await sendAction(pexPairInfosV1.setPairParams, [
    2,
    [
      0, // onePercentDepthAbove
      0, // onePercentDepthBelow
      107945, // rolloverFeePerBlockP
      2246 // fundingFeePerBlockP
    ]
  ], "pexPairInfosV1.setPairParams(EUR/USD)")

  await sendAction(pexPairInfosV1.setPairParams, [
    3,
    [
      0, // onePercentDepthAbove
      0, // onePercentDepthBelow
      190665, // rolloverFeePerBlockP
      4493 // fundingFeePerBlockP
    ]
  ], "pexPairInfosV1.setPairParams(USD/JPY)")

  await sendAction(pexPairInfosV1.setPairParams, [
    4,
    [
      0, // onePercentDepthAbove
      0, // onePercentDepthBelow
      128214, // rolloverFeePerBlockP
      2661 // fundingFeePerBlockP
    ]
  ], "pexPairInfosV1.setPairParams(GBP/USD)")

  /*
  await sendAction(pexPairInfosV1.setPairParams, [
    5,
    [
      0, // onePercentDepthAbove
      0, // onePercentDepthBelow
      148404, // rolloverFeePerBlockP
      3781 // fundingFeePerBlockP
    ]
  ], "pexPairInfosV1.setPairParams(AUD/USD)")

  await sendAction(pexPairInfosV1.setPairParams, [
    6,
    [
      0, // onePercentDepthAbove
      0, // onePercentDepthBelow
      161551, // rolloverFeePerBlockP
      2507 // fundingFeePerBlockP
    ]
  ], "pexPairInfosV1.setPairParams(USD/CHF)")

  await sendAction(pexPairInfosV1.setPairParams, [
    7,
    [
      0, // onePercentDepthAbove
      0, // onePercentDepthBelow
      88727, // rolloverFeePerBlockP
      1754 // fundingFeePerBlockP
    ]
  ], "pexPairInfosV1.setPairParams(USD/CAD)")
  */

  // 5. 配置 pair max open interest
  await sendAction(storageT.setMaxOpenInterestUsdt, [2, BigInt(100000000 * 1e6)], "storageT.setMaxOpenInterestUsdt(EUR/USD)")
  await sendAction(storageT.setMaxOpenInterestUsdt, [3, BigInt(100000000 * 1e6)], "storageT.setMaxOpenInterestUsdt(USD/JPY)")
  await sendAction(storageT.setMaxOpenInterestUsdt, [4, BigInt(100000000 * 1e6)], "storageT.setMaxOpenInterestUsdt(GBP/USD)")
  //await sendAction(storageT.setMaxOpenInterestUsdt, [5, BigInt(100000000 * 1e6)], "storageT.setMaxOpenInterestUsdt(AUD/USD)")
  //await sendAction(storageT.setMaxOpenInterestUsdt, [6, BigInt(100000000 * 1e6)], "storageT.setMaxOpenInterestUsdt(USD/CHF)")
  //await sendAction(storageT.setMaxOpenInterestUsdt, [7, BigInt(100000000 * 1e6)], "storageT.setMaxOpenInterestUsdt(USD/CAD)")

}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
