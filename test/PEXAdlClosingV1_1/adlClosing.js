const {expect} = require("chai")
const {ethers} = require("ethers")
const BigNumber = require("bignumber.js")
const {getOpenPrice, getOpenPriceByChainLink, sleep, initDeploy, reportGasUsed, getVaultFlowOffChain} = require("../shared/utilities")
const { GetConfig } = require("../../config/getConfig")

describe("PEXAdlClosingV1_1.closingTrades", function() {
  const provider = waffle.provider
  const [deployer, gov, manager, feedPnlAddress, botAddress, trader1, trader2, trader3, trader4] = provider.getWallets()
  const traders = [trader1, trader2, trader3, trader4]

  const MAX_INT = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"

  let config = GetConfig()
  const btcPriceFeed = config.address.btc_price_feed
  const ethPriceFeed = config.address.eth_price_feed
  const usdtPriceFeed = config.address.usdt_price_feed

  const openFeeP = new BigNumber(800000000)

  // 資金池最大限制
  const vaultUsdtBalance = new BigNumber(5000 * 1e6)
  
  // btc 漲幅
  const btcRiseP = 10
  

  let usdt
  let pexTradingStorageV1
  let pexPairInfosV1
  let pexPairsStorageV1
  let pexNftRewardsV1
  let pexTradingV1
  let pexPriceAggregatorV1
  let pexTradingCallbacksV1
  let ptokenV1
  let pexAdlClosingV1_1
  let pexAdlCallbacksV1_1
  let oracles1
  let oracles2

  beforeEach(async () => {

    // 部署初始合約
    deployAddress = await initDeploy(deployer, gov, manager, feedPnlAddress, botAddress)
    usdt = deployAddress['usdt']
    pexTradingStorageV1 = deployAddress['pexTradingStorageV1']
    pexPairInfosV1 = deployAddress['pexPairInfosV1']
    pexPairsStorageV1 = deployAddress['pexPairsStorageV1']
    pexNftRewardsV1 = deployAddress['pexNftRewardsV1']
    pexTradingV1 = deployAddress['pexTradingV1']
    pexPriceAggregatorV1 = deployAddress['pexPriceAggregatorV1']
    pexTradingCallbacksV1 = deployAddress['pexTradingCallbacksV1']
    pexAdlClosingV1_1 = deployAddress['pexAdlClosingV1_1']
    pexAdlCallbacksV1_1 = deployAddress['pexAdlCallbacksV1_1']
    ptokenV1 = deployAddress['ptokenV1']
    oracles1 = deployAddress['oracles1']
    oracles2 = deployAddress['oracles2']

    // 添加流動性
    await usdt.approve(ptokenV1.address, MAX_INT)
    await ptokenV1.applyDeposit(BigInt(vaultUsdtBalance), deployer.address)
    await ptokenV1.connect(feedPnlAddress).runDeposit(1, 0, 0)

    // 解除 aggregator 比價閥值
    await pexPairsStorageV1.connect(gov).updatePair(0, ["BTC", "USDT", [btcPriceFeed, usdtPriceFeed, 2, 1000000000000], 0, 0, 0])
    await pexPairsStorageV1.connect(gov).updatePair(1, ["ETH", "USDT", [ethPriceFeed, usdtPriceFeed, 2, 1000000000000], 0, 0, 0])

  })

  it("adl closing, normal case (BTC long profit, BTC short loss, case 1)", async () => {

    // 初始條件
    // btc 漲幅 10%
    const openPriceBTC = await getOpenPrice('BTC')
    const openPriceBTCBig = new BigNumber(openPriceBTC)
    const openPriceBTCFake = openPriceBTCBig.times(1.1)
    const maxProfitUsdtBalance = vaultUsdtBalance.times(50).div(100)

    //console.log(openPriceBTC)
    //console.log(openPriceBTCFake)

    // 最大盈利倉位
    // 保證金 500
    // 槓桿 53
    // 做多
    // 資金池淨流出 2537640000
    const TradeData1 = [trader1.address, 0, 0, 0, BigInt(500 * 1e6), openPriceBTC, 1, 53, 0, 0]

    // 虧損倉位 1
    // 保證金 2500
    // 槓桿 7
    // 做空
    // 資金池淨流 1740200000
    const TradeData2 = [trader2.address, 0, 0, 0, BigInt(2500 * 1e6), openPriceBTC, 0, 7, 0, 0]

    // 虧損倉位 2
    // 保證金 1500
    // 槓桿 7
    // 做空
    // 資金池淨流入 1044120000
    const TradeData3 = [trader3.address, 0, 0, 0, BigInt(1500 * 1e6), openPriceBTC, 0, 7, 0, 0]

    /*
    const leverage = new BigNumber(7)
    const collateral = new BigNumber(1500 * 1e6)
    const currentPosUsdt = collateral.minus(collateral.times(leverage).times(0.0008))
    console.log(currentPosUsdt)
    const percentProfitP = leverage.times(-btcRiseP).times(1e10)
    const closingFeeUsdt = currentPosUsdt.times(leverage).times(0.0008)
    console.log(closingFeeUsdt)
    const test = getVaultFlowOffChain(percentProfitP, currentPosUsdt, closingFeeUsdt, 0, 0)
    console.log(test.toString())
    */
  

    // 設定初始市價開倉 三個倉位
    
    const TradeDatas = [TradeData1, TradeData2, TradeData3]
    const orderType = 0
    const slippage = 5e10

    for (let i = 0; i < TradeDatas.length; i++) {

      await usdt.transfer(traders[i].address, BigInt(3000 * 1e6))
      await usdt.connect(traders[i]).approve(pexTradingStorageV1.address, MAX_INT)

      oracles1.once("OracleRequest", 
      async (specId, requester, requestId, payment, callbackAddr, callbackFunctionId, cancelExpiration, dataVersion, data, event) => {
        await oracles1.fulfillOracleRequest(
          requestId, payment, callbackAddr, callbackFunctionId, cancelExpiration, [openPriceBTC]
        );
      })

      await pexTradingV1.connect(traders[i]).openTrade(TradeDatas[i], orderType, slippage, 0)
      await sleep(4500)
    }

    // 檢查是否有倉位
    for(let i = 0; i < TradeDatas.length; i++) {
      allTrades = await pexTradingStorageV1.openTradesCount(traders[i].address, 0)
      //console.log(allTrades)
      expect(allTrades).equal(1)
    }

    // 開時執行 adl

    // 機器人執行 executeNftOrder
    // 監聽喂價並執行
    let fulfill_tx
    oracles1.once("OracleRequest", 
    async (specId, requester, requestId, payment, callbackAddr, callbackFunctionId, cancelExpiration, dataVersion, data, event) => {
      fulfill_tx = await oracles1.fulfillOracleRequest(
        requestId, payment, callbackAddr, callbackFunctionId, cancelExpiration, [BigInt(openPriceBTCFake)]
      );
    })

    const executedAdlOrder_tx = await pexAdlClosingV1_1.connect(botAddress).executeAdlOrder(
      [0, 1, 1], //adlTypes
      [trader1.address, trader2.address, trader3.address], // traders
      [0, 0, 0], // pairIndices
      [0, 0, 0], // indices
      [0] // priceFeedIndices
    )
    await sleep(8500)

    // 檢查是否觸發 batchGetPrice 事件
    await expect(executedAdlOrder_tx)
      .to.emit(pexPriceAggregatorV1, "BatchPriceRequested")

    // 檢查是否觸發 batchFullfill 事件
    await expect(fulfill_tx)
      .to.emit(pexPriceAggregatorV1, "BatchPriceReceived")

    await expect(fulfill_tx)
      .to.emit(pexAdlCallbacksV1_1, "AdlClosingExecuted")

    await expect(fulfill_tx)
      .to.emit(pexAdlCallbacksV1_1, "AdlUsdtFlow")

    const reqID_pendingAdlOrder = await pexTradingStorageV1.pendingAdlOrders(4)
    //console.log(reqID_pendingAdlOrder)

    // 紀錄 adl gas fee
    await reportGasUsed(provider, executedAdlOrder_tx, "adl request")
    await reportGasUsed(provider, fulfill_tx, "adl fulfill")
  })

})