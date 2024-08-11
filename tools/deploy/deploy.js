const helps = require("./shared/helpers")
const {expandDecimals} = require("./shared/utilities")
const {ethers, network} = require("hardhat");
const axios = require("axios")
const BigNumber = require("bignumber.js")
const { GetConfig } = require("../../config/getConfig")

const MAX_INT = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"

let addrMap = helps.createAddrRecorder("./contract_address.json");
let actionHandler = helps.createSettingRecorder("./contract_actions.json");

async function getOrDeployContract(key, contract, params, label, options) {
  return await helps.getOrDeployContractWithPath(addrMap, key, contract, params, label, options)
}

async function getOrDeployTransparentProxyContractWithPath(key, contract, params, label, options) {
  return await helps.getOrDeployTransparentProxyContractWithPath(addrMap, key, contract, params, label, options)
}

async function sendAction(func, params, label) {
  return await helps.sendActionWithPath(actionHandler, func, params, label)
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("deployer is:", deployer.address, "network is:", network.name)

  let config = GetConfig();
  //依赖的地址全部置顶
  const linkToken = config.address.link_token;
  const oracleServerAddr = config.address.oracle_server_addr //keeper.go喂价程序的EOA地址；
  const linkPriceFeed = config.address.link_price_feed // arbitrum goerli link/usd price feed
  const usdtPriceFeed = config.address.usdt_price_feed
  const btcPriceFeed = config.address.btc_price_feed;
  const ethPriceFeed = config.address.eth_price_feed;
  const lpFeed = config.address.lp_feed;
  const botAddr = config.address.bot_triggered;
  const usdtFaucetAddr = config.address.usdt_faucet_addr;
  const usdtArbOneAddr = config.address.usdt_arbOne_address;
  
  let govAddr = deployer.address

  let usdt
  if (network.name === helps.HARDHAT_NETWORK || network.name === helps.LOCALHOST_NETWORK || network.name === helps.ARBI_GOERLI_NETWORK || network.name === helps.ARBI_SEPOLIA_NETWORK) {
    usdt = await getOrDeployContract("USDT", "TestToken", ["PEXUSDT", "PEXUSDT", 6, BigInt(5000 * 1e6)])
  } else {
    usdt = await helps.contractAt("TestToken", usdtArbOneAddr)
  }

  const storageV1 = await getOrDeployTransparentProxyContractWithPath("PairexTradingStorageV1", "PairexTradingStorageV1", [govAddr, usdt.address, linkToken])
  const pexPairsStorageV1 = await getOrDeployTransparentProxyContractWithPath("PEXPairsStorageV1", "PEXPairsStorageV1", [1, storageV1.address])
  const pexPairInfosV1 = await getOrDeployTransparentProxyContractWithPath("PEXPairInfosV1", "PEXPairInfosV1", [storageV1.address])
  const pexNftRewardsV1 = await getOrDeployTransparentProxyContractWithPath("PEXNftRewardsV1", "PEXNftRewardsV1", [storageV1.address])
  const referralV1_1 = await getOrDeployTransparentProxyContractWithPath("PEXReferralStorageV1_1", "PEXReferralStorageV1_1", [storageV1.address]);
  await sendAction(referralV1_1.setTier, [0, 1000, 1000], "PEXReferralStorageV1_1.setTier")

  let oracles = [], oracleAddresses = []
  for (let i = 0; i < 2; i++) {
    const oracle_node = await getOrDeployContract("Oracle_node_" + i, "Oracle", [linkToken])
    await sendAction(oracle_node.setFulfillmentPermission, [oracleServerAddr[i], 1], "oracle_node.setFullfillmentPermission." + i)
    oracles.push(oracle_node)
    oracleAddresses.push(oracle_node.address)
  }

  const pexPriceAggregatorV1 = await getOrDeployContract("PEXPriceAggregatorV1", "PEXPriceAggregatorV1",
    [linkToken, storageV1.address, pexPairsStorageV1.address, linkPriceFeed, 1/*minAnswers*/, oracleAddresses])

  // deploy trading callback v1.3

  let PTokenV1 = await LP(usdt, lpFeed,storageV1,lpFeed)

  const pexTradingCallbacksV1 = await getOrDeployTransparentProxyContractWithPath("PEXTradingCallbacksV1", "PEXTradingCallbacksV1",
    [storageV1.address, pexNftRewardsV1.address, pexPairInfosV1.address,PTokenV1.address,100,0,0,75,1,900,1])
  await sendAction(PTokenV1.updatePnlHandler,[pexTradingCallbacksV1.address],"PTokenV1.updatePnlHandler")
  await sendAction(PTokenV1.updateFeednPnlAddress, [lpFeed], "PTokenV1.updateFeednPnlAddress.lpFeed")
  await sendAction(pexTradingCallbacksV1.setReferralStorage, [referralV1_1.address], "callback.setReferralStorage")

  const pexTradingV1 = await getOrDeployContract("PEXTradingV1", "PEXTradingV1",
    [storageV1.address, pexNftRewardsV1.address, pexPairInfosV1.address, pexTradingCallbacksV1.address,
      BigInt(500000 * 1e6)/*maxPosUsdt*/,
      3/*limitOrdersTimelock*/, 3/*marketOrdersTimeout*/])

  // adl contract
  const adlClosingV1_1 = await getOrDeployTransparentProxyContractWithPath("PEXAdlClosingV1_1", "PEXAdlClosingV1_1", [storageV1.address])
  const adlCallbacksV1_1 = await getOrDeployTransparentProxyContractWithPath("PEXAdlCallbacksV1_1", "PEXAdlCallbacksV1_1", [storageV1.address, pexPairInfosV1.address, pexTradingCallbacksV1.address])

  const monthPassNft = await getOrDeployContract("PairExPassNftV1_1", "PairExPassNftV1_1", [usdt.address, storageV1.address])
  const pexTradeRegisterV1_1 = await getOrDeployTransparentProxyContractWithPath("PEXTradeRegisterV1_1", "PEXTradeRegisterV1_1", [storageV1.address, pexPairInfosV1.address, pexNftRewardsV1.address, pexTradingCallbacksV1.address])

  await sendAction(monthPassNft.setMonthTimeStampsArray, [
    [2303, 2304,2305,2306,2307,2308],
    [1677628800, 1680307200,1682899200,1685577600,1688169600,1690848000]
  ], "nft.setTimestamps")

  await sendAction(monthPassNft.setMonthAmountsArrary, [
    [2303, 2304,2305,2306,2307,2308],
    [10, 10,10,10,10,10]
  ], "nft.setMothAmojnt")

  await sendAction(monthPassNft.setMonthPricesArray, [
    [2303,2304,2305,2306,2307,2308],
    [10000000,10000000,10000000,10000000,10000000,10000000]
  ], "nft.setMonthPricesArray")

  // v1 storage contract
  await sendAction(pexTradingV1.pause, [], "pexTradingV1.pause.1")
  await sendAction(pexTradingCallbacksV1.pause, [], "pexTradingCallbacksV1.pause.1")
  await sendAction(storageV1.setGov, [govAddr], "storageV1.setGov")
  await sendAction(storageV1.setVault, [PTokenV1.address], "storageV1.setValut")
  await sendAction(storageV1.setPriceAggregator, [pexPriceAggregatorV1.address], "storageV1.setPriceAggregator")
  await sendAction(storageV1.setTrading, [pexTradingV1.address], "storageV1.setTrading")
  await sendAction(storageV1.setCallbacks, [pexTradingCallbacksV1.address], "storageV1.setCallbacks")
  await sendAction(storageV1.setAdlClosing, [adlClosingV1_1.address], "storageV1.setAdlClosing.adlClosingV1_1")
  await sendAction(storageV1.setAdlCallbacks, [adlCallbacksV1_1.address], "storageV1.setAdlCallbacks")
  await sendAction(storageV1.setPairsStorage, [pexPairsStorageV1.address], "storageV1.setPairsStorage")
  await sendAction(storageV1.setPairsInfos, [pexPairInfosV1.address], "storageV1.setPairsInfos")
  //await sendAction(storageV1.setTradeRegister, [pexTradeRegisterV1_1.address], "storageV1.setTradeRegister")
  //await sendAction(storageV1.setMonthPassNft, [monthPassNft.address], "storageV1.setMonthPassNft")
  await sendAction(storageV1.updateSupportedCollateral, [usdt.address], "storageV1.addSupportedToken")
  await sendAction(storageV1.addTradingContract, [pexTradingV1.address], "storageV1.addTradingContract.pexTradingV1")
  await sendAction(storageV1.addTradingContract, [pexTradingCallbacksV1.address], "storageV1.addTradingContract.pexTradingCallbacksV1")
  await sendAction(storageV1.addTradingContract, [adlClosingV1_1.address], "storageV1.addTradingContract.adlClosingV1_1")
  await sendAction(storageV1.addTradingContract, [adlCallbacksV1_1.address], "storageV1.addTradingContract.adlCallbacksV1_1")
  await sendAction(storageV1.addTradingContract, [pexPriceAggregatorV1.address], "storageV1.addTradingContract.pexPriceAggregatorV1")
  await sendAction(storageV1.addTradingContract, [referralV1_1.address], "storageV1.addTradingContract.referralV1_1")
  //await sendAction(storageV1.addTradingContract, [pexTradeRegisterV1_1.address], "storageV1.addTradingContract.pexTradeRegisterV1_1")
  await sendAction(storageV1.addBotWhiteList, [botAddr], "storageV1.botAddr.addBotWhiteList")
  await sendAction(storageV1.setMaxOpenInterestUsdt, [0, BigInt(100000000 * 1e6)], "storageV1.setMaxOpenInterestUsdt.BTC")
  await sendAction(storageV1.setMaxOpenInterestUsdt, [1, BigInt(100000000 * 1e6)], "storageV1.setMaxOpenInterestUsdt.ETH")
  await sendAction(storageV1.setNftSuccessTimelock, [0],"storageV1.setNftSuccessTimelock.0")
  await sendAction(pexTradingV1.pause, [], "pexTradingV1.open.1")
  await sendAction(pexTradingCallbacksV1.pause, [], "pexTradingCallbacksV1.open.1")

  // v1 pairs storage
  await sendAction(pexPairsStorageV1.addGroup, [
    [
      "crypto", // name
      "0x6239336336373639316264343437346239613031653861646130383832356637", // job
      2, //minLeverage
      100, //maxLeverage
      100 //maxColleteralP
    ]
  ], "pexPairsStorageV1.addGroup")
  await sendAction(pexPairsStorageV1.addFee, [
    [
      "crypto", // name
      800000000, // openFeeP
      800000000, // closeFeeP
      40000000, // oracleFeep
      0, //nftLimitOrderFeeP
      0, // referralfeeP
      BigInt(500 * 1e6) // minLevPosUsdt，1e18 (collateral x leverage, useful for min fee)
    ]
  ], "pexPairsStorageV1.addFee")
  await sendAction(pexPairsStorageV1.addPair, [
    [
      "BTC", // from
      "USDT", // to
      [
        btcPriceFeed, // feed1
        usdtPriceFeed, // feed2
        2, // feedCalculation
        15000000000 // maxDeviationP
      ],  // feed
      0,     // spreadP
      0,     // groupIndex
      0      // feeIndex
    ]
  ], "pexPairsStorageV1.addPiar(BTC/USD)")
  await sendAction(pexPairsStorageV1.addPair, [
    [
      "ETH", // from
      "USDT", // to
      [
        ethPriceFeed, // feed1
        usdtPriceFeed, // feed2
        2, // feedCalculation
        15000000000 // maxDeviationP
      ],  // feed
      0,     // spreadP
      0,     // groupIndex
      0      // feeIndex
    ]
  ], "pexPairsStorageV1.addPiar(ETH/USD)")

  //v1.1 pairInfos
  await sendAction(pexPairInfosV1.setManager, [govAddr], "pexPairInfosV1.setManager")
  await sendAction(pexPairInfosV1.setMaxNegativePnlOnOpenP, [400000000000], "pexPairInfosV1.setMaxNegativePnlOnOpenP")
  await sendAction(pexPairInfosV1.setPairParams, [
    0,
    [
      0, // onePercentDepthAbove
      0, // onePercentDepthBelow
      12987, // rolloverFeePerBlockP
      789 // fundingFeePerBlockP
    ]
  ], "pexPairInfosV1.setPairParams(BTC)")
  await sendAction(pexPairInfosV1.setPairParams, [
    1,
    [
      0, // onePercentDepthAbove
      0, // onePercentDepthBelow
      31040, // rolloverFeePerBlockP
      1718 // fundingFeePerBlockP
    ]
  ], "pexPairInfosV1.setPairParams(ETH)")

  const link = await helps.contractAt("TestToken", linkToken)
  await sendAction(link.approve, [storageV1.address, MAX_INT], "link.approve.storageT")
  await sendAction(link.transfer, [pexPriceAggregatorV1.address, BigInt(0.1 * 1e18)], "deployer link.transfer.pexPriceAggregatorV1")

  //本地测试；
  if (network.name === helps.HARDHAT_NETWORK || network.name === helps.LOCALHOST_NETWORK) {
    listenOraclesOracleRequestEventAndFulfill(oracles)
    listenCallbacksMarketOpenCanceled(pexTradingCallbacksV1)
    listenCallbacksMarketExecuted(pexTradingCallbacksV1)
    listenLimitExecuted(pexTradingCallbacksV1)
    listenOpenLimitPlaced(pexTradingV1)
    listenNftOrderInitiated(pexTradingV1)
    listeinPTokenV1ApplyDepositAndRunDeposit(PTokenV1)

    //await sendAction(storageV1.setMaxPendingMarketOrders, [1000], "storageV1.setMaxPendingMarketOrders")
    //await sendAction(storageV1.setMaxTradesPerPair, [10000], "storageV1.setMaxTradesPerPair")
    console.log("link.balanceOf(storageV1.address):", (await link.balanceOf(storageV1.address)))
    console.log("link.balanceOf(deployer.address):", (await link.balanceOf(deployer.address)))
    await sendAction(usdt.mint, [deployer.address, BigInt(1e30 * 1e6)], "mint usdt to deployer")
    await sendAction(usdt.approve, [storageV1.address, MAX_INT], "deployer usdt.approve.storageT")

    // 往 LP 添加流动性，临时将feed upnl权限设置为deployer
    await sendAction(PTokenV1.updateFeednPnlAddress, [deployer.address], "PTokenV1.updateFeednPnlAddress.deployer")
    await sendAction(PTokenV1.applyDeposit,[BigInt(1e5 * 1e6),deployer.address],"PTokenV1.applyDeposit")
    await helps.sleep(1000 * 10)

    await doOpenTrade(pexTradingV1, deployer.address)
    //await doCloseTrade(pexTradingV1)
    await helps.sleep(1000 * 10)

    //await doNftBotExecute(pexTradingV1, storageV1, deployer.address)
    //await helps.sleep(1000 * 10)

    //await getPendingLimitOrder(storageV1, deployer.address)
    const allTrades = await storageV1.openTradesCount(deployer.address, 1)
    console.log("openTrades count: ", allTrades)

    //将feed upnl权限还给配置的地址；
    await sendAction(PTokenV1.updateFeednPnlAddress, [lpFeed], "PTokenV1.updateFeednPnlAddress.setback")
    //给水龙头地址设置usdt gov权限；
    await sendAction(usdt.updateGov, [usdtFaucetAddr], "usdt.updateGov.setToUsdtFaucetAddr")

    await helps.sleep(1000 * 10)  //事件监听有延迟，所以，需要等待一会；
  }
}


async function LP(usdt,callback,storageV1,lpFeed){
  const [deployer] = await ethers.getSigners();
  var PTokenV1 = await getOrDeployTransparentProxyContractWithPath("PTokenV1", "PTokenV1", [
    "PLP","PLP",6,
    usdt.address,
    storageV1.address,
    storageV1.address,
    lpFeed,
  ])

  await sendAction(usdt.approve,[PTokenV1.address,MAX_INT],"usdt.approve_PTokenV1")
  // await sendAction(PTokenV1.applyDeposit,[120000000,deployer.address],"PTokenV1.applyDeposit")
  // await sendAction(PTokenV1.runDeposit,[
  //     "0x4CE90ADC7E168DFE0676835FB50CAFBBB41E212A2396F1E370858876BE6A4776"
  //     // "0x37e1a569c774568cffc1623442b8a53d49747d99f8f81ef56adcd79b966e79d8"
  //   ,1200000],"PTokenV1.runDeposit")
  // await sendAction(PTokenV1.applyWithdraw,[110000000,deployer.address],"PTokenV1.applyWithdraw")
  // await sendAction(PTokenV1.runWithdraw,[
  //     "0x0CABC36942F376CBE2D5A38830B925DF0CF28284DA28B19FD67CA6AE17093D8D"
  //     // "0x8bee9c2129ba552493d7c13c86184ffc4f2064ac778351c2c6fb250c4f42d883"
  //   ,1200000],"PTokenV1.runWithdraw")
  return PTokenV1
}

// get openPrice
let openPrice, openPriceExpand
const url = "https://min-api.cryptocompare.com/data/price?fsym=ETH&tsyms=USD";
const getOpenPrice = async url => {
try {
  const response = await axios.get(url);
  openPrice = new BigNumber(JSON.parse(JSON.stringify(response.data)).USD)
  openPriceExpand = BigInt(openPrice.times(Math.pow(10, 10)))
  } catch (error) {
    console.log(error);
  }
};

async function doOpenTrade(pexTradingV1, traderAddr) {
  await getOpenPrice(url);
  let tx = await helps.sendTxn(pexTradingV1.openTrade(
    [traderAddr, 1/*pairIndex(BTC 0, ETH 1)*/, 0, 0, BigInt(1000 * 1e6), openPriceExpand, 1, 10, 0, 0, 0],
    0, // orderType(market 0, market 1)
    1e10// nft id
  ), "pexTradingV1.openTrade")
  if (tx) {
    console.log("openTrade ok tx:", tx)
    console.log(openPriceExpand)
  } else {
    console.log("openTrade failed")
  }
}

async function doCloseTrade(pexTradingV1) {
  await helps.sendTxn(pexTradingV1.closeTradeMarket(1,0), "pexTradingV1.closeTrade")
}

async function doNftBotExecute(pexTradingV1, storageV1, traderAddr) {
  await helps.sendTxn(pexTradingV1.executeNftOrder(
    3/*orderType LimitOrder (TP, SL, LIQ, OPEN) */, traderAddr, 1/*pair index*/, 0/*index*/, 1/*nftId*/
  ), "pexTradingV1.executeNftOrder")
}

async function getPendingLimitOrder(storageV1, traderAddr){
  let ids = await storageV1.getPendingOrderIds(traderAddr)
  console.log("storageV1.pendingOrderIds(deployer.address):", ids)
  for (let i = 0; i < ids.length; i++) {
    let order = await storageV1.reqID_pendingMarketOrder(ids[i])
    console.log("order", ids[i], "info:", order)
  }
}

// 監聽事件並喂價執行 callback
function listenOraclesOracleRequestEventAndFulfill(oracles) {
  for (let i = 0; i < oracles.length; i++) {
    oracles[i].on("OracleRequest",
      async (specId, requester, requestId, payment, callbackAddr, callbackFunctionId, cancelExpiration, dataVersion, data, event) => {
        console.log(`oracle[${i}] EVENT: requestId ${requestId} callbackAddr ${callbackAddr} callbackFunctionId ${callbackFunctionId}`);
        console.log(`oracle[${i}] EVENT txHash`, event.transactionHash);

        // fulfillOracleRequest
        await getOpenPrice(url);
        let fulfill =  await helps.sendTxn(oracles[i].fulfillOracleRequest(
          requestId, payment, callbackAddr, callbackFunctionId, cancelExpiration, [openPriceExpand]
        ), "oracle"+ i + ".fulfillOracleRequest")
        if(fulfill) {
          console.log("oracle fulfill request success")
        }

      });
  }
}

// 喂價成功但取消開倉事件監聽
function listenCallbacksMarketOpenCanceled(callbacks) {
  callbacks.on("MarketOpenCanceled", (orderId, trader, pairIndex)=> {
    console.log(`MarketOpenCanceled: orderId ${orderId}, trader ${trader}, pairIndex ${pairIndex}`)
  })
}

// 開倉成功事件監聽
function listenCallbacksMarketExecuted(callbacks) {
  callbacks.on("MarketExecuted", (orderId, trader, trade, open, price, priceImpactP, positionSizeUsdt, percentProfit, usdtSentToTrader, rolloverFee, fundingFee, closingFee)=> {
    console.log(`MarketExecuted: orderId ${orderId},trader ${trader}, trade ${trade}, open ${open}, price ${price}, priceImpactP ${priceImpactP}, positionSizeUsdt ${positionSizeUsdt}, percentProfit ${percentProfit}, usdtSentToTrader ${usdtSentToTrader}, RolloverFee ${rolloverFee}, FundingFee ${fundingFee}, ClosingFee ${closingFee}`)
  })
}

function listenLimitExecuted(callbacks) {
  callbacks.on("LimitExecuted", (orderId, trader, index, finalTrade, nftHolder, LimitOrder, openPrice, priceImpactP, positionSizeUsdt, percentProfit, usdtSentToTrader, rolloverFee, fundingFee, closingFee)=> {
    console.log(`LimitExecuted: orderId ${orderId},trader ${trader}, index ${index},trade ${finalTrade}, nftHolder ${nftHolder}, LimitOrder ${LimitOrder}, openPrice ${openPrice}, priceImpactP ${priceImpactP}, positionSizeUsdt ${positionSizeUsdt}, percentProfit ${percentProfit}, usdtSentToTrader ${usdtSentToTrader}, RolloverFee ${rolloverFee}, FundingFee ${fundingFee}, closingFee ${closingFee}`)
  })
}

// 限價單委託成功監聽
function listenOpenLimitPlaced(pexTradingV1) {
  pexTradingV1.on("OpenLimitPlaced", (sender, pairIndex, index)=> {
    console.log(`OpenLimitPlaced: sender ${sender}, pairIndex ${pairIndex}, index ${index}`)
  })
}

// 限價單觸發為價成功監聽
function listenNftOrderInitiated(pexTradingV1) {
  pexTradingV1.on("NftOrderInitiated", (orderId, sender, trader, pairIndex)=> {
    console.log(`NftOrderInitiated: orderId ${orderId}, sender ${sender}, trader ${trader}, pairIndex ${pairIndex}`)
  })
}

// 添加流動性事件監聽以及觸發
function listeinPTokenV1ApplyDepositAndRunDeposit(PTokenV1) {
  PTokenV1.on("ApplyDeposit", async(requestId)=> {
    console.log("requestId:"+requestId)
    // 暫時用這種方式添加流動性
    helps.sendTxn(PTokenV1.runDeposit(requestId, 0, 0), "PTokenV1.runDeposit")
  })
}

main()
  .then(() => {
    process.exit(0)
  })
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
