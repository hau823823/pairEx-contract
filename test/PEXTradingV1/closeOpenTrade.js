const {expect} = require("chai")
const {ethers} = require("ethers")
const BigNumber = require("bignumber.js")
const {getOpenPrice, getOpenPriceByChainLink, sleep, initDeploy, currentPercentProfit, bigNumberify} = require("../shared/utilities")
const { GetConfig } = require("../../config/getConfig")

describe("PEXTrading.closeTradeMarket", function() {
  const provider = waffle.provider
  const [deployer, gov, manager, feedPnlAddress, botAddress, trader] = provider.getWallets()
  const MAX_INT = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
  let config = GetConfig()
  const openFeeP = new BigNumber(800000000)
  const ethPriceFeed = config.address.eth_price_feed

  let usdt
  let pexTradingStorageV1
  let pexPairInfosV1
  let pexPairsStorageV1
  let pexNftRewardsV1
  let pexTradingV1
  let pexPriceAggregatorV1
  let pexTradingCallbacksV1
  let ptokenV1
  let oracles1
  let oracles2

  beforeEach(async () => {
    const openPrice = await getOpenPrice('ETH')

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
    ptokenV1 = deployAddress['ptokenV1']
    oracles1 = deployAddress['oracles1']
    oracles2 = deployAddress['oracles2']

    // 添加流動性
    await usdt.approve(ptokenV1.address, MAX_INT)
    await ptokenV1.applyDeposit(BigInt(1e10 * 1e6), deployer.address)
    await ptokenV1.connect(feedPnlAddress).runDeposit(1, 0, 0)

    await usdt.transfer(trader.address, BigInt(1000 * 1e6))
    await usdt.connect(trader).approve(pexTradingStorageV1.address, MAX_INT)

    // 設定初始市價開倉
    oracles1.once("OracleRequest", 
    async (specId, requester, requestId, payment, callbackAddr, callbackFunctionId, cancelExpiration, dataVersion, data, event) => {
      await oracles1.fulfillOracleRequest(
        requestId, payment, callbackAddr, callbackFunctionId, cancelExpiration, [openPrice]
      );
    })

    const TradeData = [trader.address, 1,0, 0, BigInt(1000 * 1e6), openPrice, 1, 10, 0, 0]
    const orderType = 0
    const slippage = 1e10
    await pexTradingV1.connect(trader).openTrade(TradeData, orderType, slippage, 0)
    await sleep(3500)
  })

  it("market trades close (normal case, open and then immediately close, without any profit, and only closing fee will be charged)", async () => {
    // 檢查是否有倉位
    expect(await pexTradingStorageV1.openTradesCount(trader.address, 1)).equal(1)
    expect(await usdt.balanceOf(trader.address)).equal(0)
    expect(await usdt.balanceOf(pexTradingStorageV1.address)).equal(1000000000)
    const openTrade = await pexTradingStorageV1.getAllOpenTradesByTrader(trader.address)

    // 構造平倉時的價格
    await pexPairsStorageV1.connect(gov).updatePair(1, ["ETH", "USDT", [ethPriceFeed, "0x0000000000000000000000000000000000000000", 0, 10000000000000], 0, 0, 0])
    const o = new BigNumber(BigInt(openTrade[0][0].openPrice))
    const openPriceFake = o.times(1)

    // 平倉監聽並執行
    let fulfill_tx
    oracles1.once("OracleRequest", 
    async (specId, requester, requestId, payment, callbackAddr, callbackFunctionId, cancelExpiration, dataVersion, data, event) => {
      fulfill_tx = await oracles1.fulfillOracleRequest(
        requestId, payment, callbackAddr, callbackFunctionId, cancelExpiration, [BigInt(openPriceFake)]
      );
    })

    // 監聽平倉事件
    let event_usdtSentToTrader
    let event_rolloverFee
    let event_fundingFee
    let event_closingFee
    pexTradingCallbacksV1.once("MarketExecuted", (orderId, trader, trade, open, price, priceImpactP, positionSizeUsdt, percentProfit, usdtSentToTrader, rolloverFee, fundingFee, closingFee)=> {
      event_usdtSentToTrader = usdtSentToTrader;
      event_rolloverFee = rolloverFee;
      event_fundingFee = fundingFee;
      event_closingFee = closingFee;
    })

    // 實際平倉請求
    const closeMarketTrade_tx = await pexTradingV1.connect(trader).closeTradeMarket(1, 0)
    await sleep(8000)

    // 檢查是否觸發平倉委託事件
    await expect(closeMarketTrade_tx)
      .to.emit(pexTradingV1, "MarketOrderInitiated")
      .withArgs(2, trader.address, 1, false)

    // 檢查是否觸發平倉喂價事件
    await expect(fulfill_tx)
      .to.emit(pexTradingCallbacksV1, "MarketExecuted")

    // 檢查倉位數量是否歸零
    // 並且檢查開平倉手續費
    const openFee = openFeeP.div(1e10).div(100).times(10).times(1000 * 1e6)
    const positionSizeUsdt = new BigNumber(1000 * 1e6)
    const postionSizeReal = positionSizeUsdt.minus(openFee)
    const closeFee = openFeeP.div(1e10).div(100).times(postionSizeReal)

    expect(await pexTradingStorageV1.openTradesCount(trader.address, 1)).equal(0)
    expect(await pexTradingStorageV1.platformFee()).equal(15936000)

    // 計算平倉時手續費以及轉回給用戶的金額
    const est_openFee = openFeeP.div(1e10).div(100).times(10).times(1000 * 1e6)

    const openCollateral = new BigNumber(BigInt(openTrade[0][0].positionSizeUsdt))
    const est_closingFee = openCollateral.times(10).times(800000000).div(1e10).div(100)
    const est_sendToUser = openCollateral.minus(est_closingFee)
    const est_fee = est_closingFee.plus(est_openFee)

    // 檢查平倉事件中的費率與預估費率是否相等
    expect(event_closingFee.toString()).equal(est_closingFee.toString())

    // 檢查平倉事件中的 sent to user 是否與預估相等
    expect(event_usdtSentToTrader.toString()).equal(est_sendToUser.toString())

    // 檢查用戶平倉後收到的金額是否正確
    const trader_balance = await usdt.balanceOf(trader.address)
    expect(trader_balance.toString()).equal(est_sendToUser.toString())

    // 檢查是否觸發 upnl id 事件
    await expect(fulfill_tx)
      .to.emit(pexTradingStorageV1, "upnlLastIdUpdated")
      .withArgs(2)

    // 檢查接口獲取的 upnl id 是否正確
    expect(await pexTradingStorageV1.getUpnlLastId()).equal(2)
  })

  it("market trades close (normal case, open and then close with profit 50%, and only closing fee will be charged)", async () => {
    // 檢查是否有倉位
    expect(await pexTradingStorageV1.openTradesCount(trader.address, 1)).equal(1)
    expect(await usdt.balanceOf(trader.address)).equal(0)
    expect(await usdt.balanceOf(pexTradingStorageV1.address)).equal(1000000000)
    const openTrade = await pexTradingStorageV1.getAllOpenTradesByTrader(trader.address)

    // 構造平倉時的價格
    await pexPairsStorageV1.connect(gov).updatePair(1, ["ETH", "USDT", [ethPriceFeed, "0x0000000000000000000000000000000000000000", 0, 10000000000000], 0, 0, 0])
    const o = new BigNumber(BigInt(openTrade[0][0].openPrice))
    const openPriceFake = o.times(1.05)

    // 平倉監聽並執行
    let fulfill_tx
    oracles1.once("OracleRequest", 
    async (specId, requester, requestId, payment, callbackAddr, callbackFunctionId, cancelExpiration, dataVersion, data, event) => {
      fulfill_tx = await oracles1.fulfillOracleRequest(
        requestId, payment, callbackAddr, callbackFunctionId, cancelExpiration, [BigInt(openPriceFake)]
      );
    })

    // 監聽平倉事件
    let event_usdtSentToTrader
    let event_rolloverFee
    let event_fundingFee
    let event_closingFee
    pexTradingCallbacksV1.once("MarketExecuted", (orderId, trader, trade, open, price, priceImpactP, positionSizeUsdt, percentProfit, usdtSentToTrader, rolloverFee, fundingFee, closingFee)=> {
      event_usdtSentToTrader = usdtSentToTrader;
      event_rolloverFee = rolloverFee;
      event_fundingFee = fundingFee;
      event_closingFee = closingFee;
      console.log(`MarketExecuted: orderId ${orderId},trader ${trader}, trade ${trade}, open ${open}, price ${price}, priceImpactP ${priceImpactP}, positionSizeUsdt ${positionSizeUsdt}, percentProfit ${percentProfit}, usdtSentToTrader ${usdtSentToTrader}, RolloverFee ${rolloverFee}, FundingFee ${fundingFee}, ClosingFee ${closingFee}`)
    })

    // 實際平倉請求
    const closeMarketTrade_tx = await pexTradingV1.connect(trader).closeTradeMarket(1, 0)
    await sleep(8000)

    // 檢查是否觸發平倉委託事件
    await expect(closeMarketTrade_tx)
      .to.emit(pexTradingV1, "MarketOrderInitiated")
      .withArgs(2, trader.address, 1, false)

    // 檢查是否觸發平倉喂價事件
    await expect(fulfill_tx)
      .to.emit(pexTradingCallbacksV1, "MarketExecuted")

    // 檢查倉位數量是否歸零
    expect(await pexTradingStorageV1.openTradesCount(trader.address, 1)).equal(0)

    // 計算平倉時手續費以及轉回給用戶的金額
    const openCollateral = new BigNumber(BigInt(openTrade[0][0].positionSizeUsdt))
    const est_closingFee = openCollateral.times(10).times(800000000).div(1e10).div(100)
    const est_sendToUser = openCollateral.times(1.5).minus(est_closingFee)

    // 檢查平倉事件中的費率與預估費率是否相等
    expect(event_closingFee.toString()).equal(est_closingFee.toString())

    // 檢查平倉事件中的 sent to user 是否與預估相等
    expect(event_usdtSentToTrader.toString()).equal(est_sendToUser.toString())

    // 檢查用戶平倉後收到的金額是否正確
    const trader_balance = await usdt.balanceOf(trader.address)
    expect(trader_balance.toString()).equal(est_sendToUser.toString())
    //console.log(trader_balance.toString())

    // 檢查是否觸發 upnl id 事件
    await expect(fulfill_tx)
      .to.emit(pexTradingStorageV1, "upnlLastIdUpdated")
      .withArgs(2)

    // 檢查接口獲取的 upnl id 是否正確
    expect(await pexTradingStorageV1.getUpnlLastId()).equal(2)
  })

})