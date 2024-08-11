const {expect} = require("chai")
const {ethers} = require("ethers")
const BigNumber = require("bignumber.js")
const {getOpenPrice, getOpenPriceByChainLink, initDeploy, sleep, increaseTime, mineBlock} = require("../shared/utilities")
const { GetConfig } = require("../../config/getConfig")

describe("PEXTrading.updateTpSl", function() {
  const provider = waffle.provider
  const [deployer, gov, manager, feedPnlAddress, botAddress, trader] = provider.getWallets()
  const MAX_INT = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
  const openFeeP = new BigNumber(800000000)
  let config = GetConfig()
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

    await usdt.transfer(trader.address, BigInt(1e5 * 1e6))
    await usdt.connect(trader).approve(pexTradingStorageV1.address, MAX_INT)

    // 設定初始市價開倉
    oracles1.once("OracleRequest", 
    async (specId, requester, requestId, payment, callbackAddr, callbackFunctionId, cancelExpiration, dataVersion, data, event) => {
      await oracles1.fulfillOracleRequest(
        requestId, payment, callbackAddr, callbackFunctionId, cancelExpiration, [openPrice]
      );
    })

    let TradeData = [trader.address, 1,0, 0, BigInt(1000 * 1e6), openPrice, 1, 10, 0, 0]
    let orderType = 0
    let slippage = 1e10
    await pexTradingV1.connect(trader).openTrade(TradeData, orderType, slippage, 0)
    await sleep(3500)

    // 設定限價委託
    TradeData = [trader.address, 1,0, 0, BigInt(1000 * 1e6), openPrice - BigInt(5 * 1e10), 1, 10, 0, 0]
    orderType = 1
    slippage = 1e10
    await pexTradingV1.connect(trader).openTrade(TradeData, orderType, slippage, 0)
  })

  it("market trades updateTp (normal case)", async () => {
    // 檢查是否有倉位
    expect(await pexTradingStorageV1.openTradesCount(trader.address, 1)).equal(1)
    const openTrades = await pexTradingStorageV1.getAllOpenTradesByTrader(trader.address)

    // 拿取開倉價格計算並更新
    const openPrice = BigInt(openTrades[0][0].openPrice)
    const openPriceBigNumber = new BigNumber(openPrice)
    const tp_dist = openPriceBigNumber.times(900).div(100).div(10)
    const tp = openPriceBigNumber.plus(tp_dist)

    // update Tp
    const updateTp_tx = await pexTradingV1.connect(trader).updateTp(1,0,BigInt(tp))

    // 檢查是否觸發更新止盈事件
    await expect(updateTp_tx)
      .to.emit(pexTradingV1, "TpUpdated")
      .withArgs(trader.address, 1, 0, tp.toString())

    // 檢查倉位資訊是否更新
    const openTrades_afterUpdate = await pexTradingStorageV1.getAllOpenTradesByTrader(trader.address)
    expect(openTrades_afterUpdate[0][0].tp.toString()).equal(tp.toString())
  })

  it("market trades updateSl (normal sl = 0, no need to feed price)", async () => {
    // 檢查是否有倉位
    expect(await pexTradingStorageV1.openTradesCount(trader.address, 1)).equal(1)

    // update Sl
    const sl = 0
    const updateSl_tx = await pexTradingV1.connect(trader).updateSl(1,0,BigInt(sl))

    // 檢查是否觸發更新止盈事件
    await expect(updateSl_tx)
      .to.emit(pexTradingV1, "SlUpdated")
      .withArgs(trader.address, 1, 0, sl.toString())

    // 檢查倉位資訊是否更新
    const openTrades_afterUpdate = await pexTradingStorageV1.getAllOpenTradesByTrader(trader.address)
    expect(openTrades_afterUpdate[0][0].sl.toString()).equal(sl.toString())
  })

  it("market trades updateSl (normal new sl, need to feed price)", async () => {
    // 檢查是否有倉位
    expect(await pexTradingStorageV1.openTradesCount(trader.address, 1)).equal(1)
    const openTrades = await pexTradingStorageV1.getAllOpenTradesByTrader(trader.address)

    // 拿取開倉價格計算並更新
    const openPrice = BigInt(openTrades[0][0].openPrice)
    const openPriceBigNumber = new BigNumber(openPrice)
    const sl_dist = openPriceBigNumber.times(75).div(100).div(10)
    const sl = openPriceBigNumber.minus(sl_dist)

    // update Sl
    const openPriceLink = await getOpenPriceByChainLink("ETH")
    let fulfill_tx
    oracles1.once("OracleRequest", 
      async (specId, requester, requestId, payment, callbackAddr, callbackFunctionId, cancelExpiration, dataVersion, data, event) => {
        fulfill_tx = await oracles1.fulfillOracleRequest(
          requestId, payment, callbackAddr, callbackFunctionId, cancelExpiration, [openPriceLink]
        );
    })
    const updateSl_tx = await pexTradingV1.connect(trader).updateSl(1,0,BigInt(sl))
    await sleep(4500)

    // 檢查是否觸發更新止盈委託事件
    await expect(updateSl_tx)
      .to.emit(pexTradingV1, "SlUpdateInitiated")
      .withArgs(2, trader.address, 1, 0, sl.toString())
    
    // 檢查是復處發更新止盈喂價事件
    await expect(fulfill_tx)
      .to.emit(pexTradingCallbacksV1, "SlUpdated")
      .withArgs(2, trader.address, 1, 0, sl.toString())

    // 檢查倉位資訊是否更新
    const openTrades_afterUpdate = await pexTradingStorageV1.getAllOpenTradesByTrader(trader.address)
    expect(openTrades_afterUpdate[0][0].sl.toString()).equal(sl.toString())
  })

  it("limit orders update tp sl (normal case)", async () => {
    // 檢查是否有限價訂單
    expect(await pexTradingStorageV1.openLimitOrdersCount(trader.address, 1)).equal(1)

    // 獲取 wanted price 並且計算 tp sl
    const openPrice = await getOpenPriceByChainLink('ETH')
    const openPriceBigNumber = new BigNumber(openPrice).minus(10 * 1e10)
    const sl_dist = openPriceBigNumber.times(75).div(100).div(10)
    const tp_dist = openPriceBigNumber.times(900).div(100).div(10)
    const sl = openPriceBigNumber.minus(sl_dist)
    const tp = openPriceBigNumber.plus(tp_dist)

    // 更新 limitOrder 的 tp sl
    for (let i = 0; i < 4; i++) {
      await mineBlock(provider)
    }
    const updateLimitOrder_tx = await pexTradingV1.connect(trader).updateOpenLimitOrder(1, 0, BigInt(openPriceBigNumber), BigInt(tp), BigInt(sl))
    
    // 檢查更新 limit order 事件是否觸發
    expect(updateLimitOrder_tx)
      .to.emit(pexTradingV1, "OpenLimitUpdated")
      .withArgs(trader.address, 1, 0, openPriceBigNumber.toString(), tp.toString(), sl.toString())

    // 檢查 limit order 是否更新
    const openLimitOrder_afterUpdate = await pexTradingStorageV1.openLimitOrders(0)
    expect(openLimitOrder_afterUpdate.tp.toString()).equal(tp.toString())
    expect(openLimitOrder_afterUpdate.sl.toString()).equal(sl.toString())

  })

  it("market trades updateTp (over maxTp case, should be reverted)", async () => {
    // 檢查是否有倉位
    expect(await pexTradingStorageV1.openTradesCount(trader.address, 1)).equal(1)
    const openTrades = await pexTradingStorageV1.getAllOpenTradesByTrader(trader.address)

    // 拿取開倉價格計算並更新
    const openPrice = BigInt(openTrades[0][0].openPrice)
    const openPriceBigNumber = new BigNumber(openPrice)
    const tp_dist = openPriceBigNumber.times(900).div(100).div(10)
    const tp = openPriceBigNumber.plus(tp_dist).plus(1)

    // update Tp
    await expect(pexTradingV1.connect(trader).updateTp(1,0,BigInt(tp))).to.be.revertedWith("TP_TOO_BIG")
  })

  it("market trades updateSl (over maxSl case, should be reverted)", async () => {
    // 檢查是否有倉位
    expect(await pexTradingStorageV1.openTradesCount(trader.address, 1)).equal(1)
    const openTrades = await pexTradingStorageV1.getAllOpenTradesByTrader(trader.address)

    // 拿取開倉價格計算並更新
    const openPrice = BigInt(openTrades[0][0].openPrice)
    const openPriceBigNumber = new BigNumber(openPrice)
    const sl_dist = openPriceBigNumber.times(75).div(100).div(10)
    const sl = openPriceBigNumber.minus(sl_dist).minus(1)

    // update Tp
    await expect(pexTradingV1.connect(trader).updateSl(1,0,BigInt(sl))).to.be.revertedWith("SL_TOO_BIG")
  })

  it("limit orders updateTp (over maxTp case, should be reverted)", async () => {
    // 檢查是否有限價訂單
    expect(await pexTradingStorageV1.openLimitOrdersCount(trader.address, 1)).equal(1)

    // 獲取 wanted price 並且計算 tp
    const openPrice = await getOpenPriceByChainLink('ETH')
    const openPriceBigNumber = new BigNumber(openPrice).minus(10 * 1e10)
    const tp_dist = openPriceBigNumber.times(900).div(100).div(10)
    const tp = openPriceBigNumber.plus(tp_dist).plus(1)

    // update Tp
    for (let i = 0; i < 4; i++) {
      await mineBlock(provider)
    }
    await expect(pexTradingV1.connect(trader).updateOpenLimitOrder(1, 0, BigInt(openPriceBigNumber), BigInt(tp), 0)).to.be.revertedWith("TP_TOO_BIG")
  })

  it("limit orders updateSl (over maxSl case, should be reverted)", async () => {
    // 檢查是否有限價訂單
    expect(await pexTradingStorageV1.openLimitOrdersCount(trader.address, 1)).equal(1)

    // 獲取 wanted price 並且計算 sl
    const openPrice = await getOpenPriceByChainLink('ETH')
    const openPriceBigNumber = new BigNumber(openPrice).minus(10 * 1e10)
    const sl_dist = openPriceBigNumber.times(75).div(100).div(10)
    const sl = openPriceBigNumber.minus(sl_dist).minus(1)

    // update sl
    for (let i = 0; i < 4; i++) {
      await mineBlock(provider)
    }
    await expect(pexTradingV1.connect(trader).updateOpenLimitOrder(1, 0, BigInt(openPriceBigNumber), 0, BigInt(sl))).to.be.revertedWith("SL_TOO_BIG")
  })

  it("market trades updateSl (normal sl, feed price and newSl > aggregator price, sl should be canceled)", async () => {
    // 檢查是否有倉位
    expect(await pexTradingStorageV1.openTradesCount(trader.address, 1)).equal(1)
    const openTrades = await pexTradingStorageV1.getAllOpenTradesByTrader(trader.address)

    // 拿取開倉價格計算並更新
    const openPrice = BigInt(openTrades[0][0].openPrice)
    const openPriceBigNumber = new BigNumber(openPrice)
    const sl_dist = openPriceBigNumber.times(5).div(100).div(10)
    const sl = openPriceBigNumber.minus(sl_dist)

    // 夠造假的開倉為價價格，模擬 newSl 大於 aggregator price
    // 暫時將 aggregator 可接受的為價價格改成 100％，滿足構造條件
    await pexPairsStorageV1.connect(gov).updatePair(1, ["ETH", "USDT", [ethPriceFeed, "0x0000000000000000000000000000000000000000", 0, 1000000000000], 0, 0, 0])
    const openPriceFake = sl.minus(10 * 1e10)

    // update Sl
    let fulfill_tx
    oracles1.once("OracleRequest", 
      async (specId, requester, requestId, payment, callbackAddr, callbackFunctionId, cancelExpiration, dataVersion, data, event) => {
        fulfill_tx = await oracles1.fulfillOracleRequest(
          requestId, payment, callbackAddr, callbackFunctionId, cancelExpiration, [BigInt(openPriceFake)]
        );
    })
    const updateSl_tx = await pexTradingV1.connect(trader).updateSl(1,0,BigInt(sl))
    await sleep(4500)

    // 檢查是否觸發更新止盈委託事件
    await expect(updateSl_tx)
      .to.emit(pexTradingV1, "SlUpdateInitiated")
      .withArgs(2, trader.address, 1, 0, sl.toString())
    
    // 檢查是復處發更新止盈喂價事件
    await expect(fulfill_tx)
      .to.emit(pexTradingCallbacksV1, "SlCanceled")
      .withArgs(2, trader.address, 1, 0)

    // 檢查倉位資訊是否與更新前相同
    const openTrades_afterUpdate = await pexTradingStorageV1.getAllOpenTradesByTrader(trader.address)
    expect(openTrades_afterUpdate[0][0].sl.toString()).equal(openTrades[0][0].sl.toString())
  })

  it("update Tp SL params in callbacks.sol (and test openTrade)", async () => {
    // 更新 callback 合約中的最大最小 tp sl 趴數
    const setSLTP_tx = await pexTradingCallbacksV1.connect(gov).setSLTP(80, 5, 950, 5)

    // 檢查更新參數事件是否觸發
    await expect(setSLTP_tx)
      .to.emit(pexTradingCallbacksV1, "SLTPParamsUpdaated")
      .withArgs(80, 5, 950, 5)

    // 檢查參數是否真的更新
    expect(await pexTradingCallbacksV1.MAX_SL_P()).equal(80)
    expect(await pexTradingCallbacksV1.MIN_SL_P()).equal(5)
    expect(await pexTradingCallbacksV1.MAX_GAIN_P()).equal(950)
    expect(await pexTradingCallbacksV1.MIN_GAIN_P()).equal(5)
    
    const openPrice = await getOpenPriceByChainLink('ETH')
    const openPriceBigNumber = new BigNumber(openPrice)
    const sl_dist = openPriceBigNumber.times(80).div(100).div(10)
    const tp_dist = openPriceBigNumber.times(950).div(100).div(10)
    const sl = openPriceBigNumber.minus(sl_dist)
    const tp = openPriceBigNumber.plus(tp_dist)
    const TradeData = [trader.address,1,0,0,BigInt(1000 * 1e6),openPrice,1,10,BigInt(tp),BigInt(sl)
    ]
    const orderType = 0
    const slippage = 1e10
  
    await usdt.transfer(trader.address, BigInt(1000 * 1e6))

    // 監聽並喂價
    let fulfill_tx
    oracles1.once("OracleRequest", 
      async (specId, requester, requestId, payment, callbackAddr, callbackFunctionId, cancelExpiration, dataVersion, data, event) => {
        fulfill_tx = await oracles1.fulfillOracleRequest(
          requestId, payment, callbackAddr, callbackFunctionId, cancelExpiration, [openPrice]
        );
    })

    // 觸發限價委託請求事件
    const openTrade_tx = await pexTradingV1.connect(trader).openTrade(TradeData, orderType, slippage, 0)
    await sleep(4000)

    await expect(openTrade_tx)
      .to.emit(pexTradingV1, "MarketOrderInitiated")
      .withArgs(2, trader.address, 1, true)

    // 觸發喂價請求
    await expect(openTrade_tx)
      .to.emit(oracles1, "OracleRequest")

    // 檢查開倉手續費
    const openFee = openFeeP.div(1e10).div(100).times(10).times(1000 * 1e6)
    const positionSizeUsdt = new BigNumber(3000 * 1e6)
    const openCollateral = positionSizeUsdt.minus(openFee * 2)

    // 先將保證金轉至 storage 合約
    expect(await usdt.balanceOf(pexTradingStorageV1.address)).equal(BigInt(positionSizeUsdt))

    // 檢查喂價成功
    await expect(fulfill_tx)
      .to.emit(pexTradingCallbacksV1, "MarketExecuted")
    
    // 檢查持倉數量
    expect(await pexTradingStorageV1.openTradesCount(trader.address, 1)).equal(2)

    // 檢查實際開倉的 tp sl 參數是否相等
    const openTrades = await pexTradingStorageV1.getAllOpenTradesByTrader(trader.address)
    expect(openTrades[1][0].tp.toString()).equal(tp.toString())
    expect(openTrades[1][0].sl.toString()).equal(sl.toString())

    // 檢查是否觸發 upnl id 事件
    await expect(fulfill_tx)
      .to.emit(pexTradingStorageV1, "upnlLastIdUpdated")
      .withArgs(2)

    // 檢查接口獲取的 upnl id 是否正確
    expect(await pexTradingStorageV1.getUpnlLastId()).equal(2)
  })

  it("update Tp SL params in callbacks.sol (and test market trades update new Tp Sl)", async () => {
    // 更新 callback 合約中的最大最小 tp sl 趴數
    const setSLTP_tx = await pexTradingCallbacksV1.connect(gov).setSLTP(80, 5, 950, 5)

    // 檢查更新參數事件是否觸發
    await expect(setSLTP_tx)
      .to.emit(pexTradingCallbacksV1, "SLTPParamsUpdaated")
      .withArgs(80, 5, 950, 5)

    // 檢查參數是否真的更新
    expect(await pexTradingCallbacksV1.MAX_SL_P()).equal(80)
    expect(await pexTradingCallbacksV1.MIN_SL_P()).equal(5)
    expect(await pexTradingCallbacksV1.MAX_GAIN_P()).equal(950)
    expect(await pexTradingCallbacksV1.MIN_GAIN_P()).equal(5)
    
    // 檢查是否有倉位
    expect(await pexTradingStorageV1.openTradesCount(trader.address, 1)).equal(1)
    const openTrades = await pexTradingStorageV1.getAllOpenTradesByTrader(trader.address)

    // 拿取開倉價格計算並更新
    const openPrice = BigInt(openTrades[0][0].openPrice)
    const openPriceBigNumber = new BigNumber(openPrice)
    const tp_dist = openPriceBigNumber.times(950).div(100).div(10)
    const tp = openPriceBigNumber.plus(tp_dist)
    const sl_dist = openPriceBigNumber.times(80).div(100).div(10)
    const sl = openPriceBigNumber.minus(sl_dist)

    // update Tp
    const updateTp_tx = await pexTradingV1.connect(trader).updateTp(1,0,BigInt(tp))

    // 檢查是否觸發更新止盈事件
    await expect(updateTp_tx)
      .to.emit(pexTradingV1, "TpUpdated")
      .withArgs(trader.address, 1, 0, tp.toString())

    // update Sl
    const openPriceLink = await getOpenPriceByChainLink("ETH")
    let fulfill_tx
    oracles1.once("OracleRequest", 
      async (specId, requester, requestId, payment, callbackAddr, callbackFunctionId, cancelExpiration, dataVersion, data, event) => {
        fulfill_tx = await oracles1.fulfillOracleRequest(
          requestId, payment, callbackAddr, callbackFunctionId, cancelExpiration, [openPriceLink]
        );
    })
    const updateSl_tx = await pexTradingV1.connect(trader).updateSl(1,0,BigInt(sl))
    await sleep(4500)

    // 檢查是否觸發更新止盈委託事件
    await expect(updateSl_tx)
      .to.emit(pexTradingV1, "SlUpdateInitiated")
      .withArgs(2, trader.address, 1, 0, sl.toString())
    
    // 檢查是復處發更新止盈喂價事件
    await expect(fulfill_tx)
      .to.emit(pexTradingCallbacksV1, "SlUpdated")
      .withArgs(2, trader.address, 1, 0, sl.toString())

    // 檢查倉位資訊是否更新
    const openTrades_afterUpdate = await pexTradingStorageV1.getAllOpenTradesByTrader(trader.address)
    expect(openTrades_afterUpdate[0][0].tp.toString()).equal(tp.toString())
    expect(openTrades_afterUpdate[0][0].sl.toString()).equal(sl.toString())
  })

  it("update Tp SL params in callbacks.sol (and test market trades update new Tp over dist, should be revert)", async () => {
    // 更新 callback 合約中的最大最小 tp sl 趴數
    const setSLTP_tx = await pexTradingCallbacksV1.connect(gov).setSLTP(80, 5, 950, 5)

    // 檢查更新參數事件是否觸發
    await expect(setSLTP_tx)
      .to.emit(pexTradingCallbacksV1, "SLTPParamsUpdaated")
      .withArgs(80, 5, 950, 5)

    // 檢查參數是否真的更新
    expect(await pexTradingCallbacksV1.MAX_SL_P()).equal(80)
    expect(await pexTradingCallbacksV1.MIN_SL_P()).equal(5)
    expect(await pexTradingCallbacksV1.MAX_GAIN_P()).equal(950)
    expect(await pexTradingCallbacksV1.MIN_GAIN_P()).equal(5)
    
    // 檢查是否有倉位
    expect(await pexTradingStorageV1.openTradesCount(trader.address, 1)).equal(1)
    const openTrades = await pexTradingStorageV1.getAllOpenTradesByTrader(trader.address)

    // 拿取開倉價格計算並更新
    const openPrice = BigInt(openTrades[0][0].openPrice)
    const openPriceBigNumber = new BigNumber(openPrice)
    const tp_dist = openPriceBigNumber.times(950).div(100).div(10)
    const tp = openPriceBigNumber.plus(tp_dist).plus(1)

    // update Tp
    await expect(pexTradingV1.connect(trader).updateTp(1,0,BigInt(tp))).to.be.revertedWith("TP_TOO_BIG")
  })

  it("update Tp SL params in callbacks.sol (and test market trades update new Sl over dist, should be revert)", async () => {
    // 更新 callback 合約中的最大最小 tp sl 趴數
    const setSLTP_tx = await pexTradingCallbacksV1.connect(gov).setSLTP(80, 5, 950, 5)

    // 檢查更新參數事件是否觸發
    await expect(setSLTP_tx)
      .to.emit(pexTradingCallbacksV1, "SLTPParamsUpdaated")
      .withArgs(80, 5, 950, 5)

    // 檢查參數是否真的更新
    expect(await pexTradingCallbacksV1.MAX_SL_P()).equal(80)
    expect(await pexTradingCallbacksV1.MIN_SL_P()).equal(5)
    expect(await pexTradingCallbacksV1.MAX_GAIN_P()).equal(950)
    expect(await pexTradingCallbacksV1.MIN_GAIN_P()).equal(5)
    
    // 檢查是否有倉位
    expect(await pexTradingStorageV1.openTradesCount(trader.address, 1)).equal(1)
    const openTrades = await pexTradingStorageV1.getAllOpenTradesByTrader(trader.address)

    // 拿取開倉價格計算並更新
    const openPrice = BigInt(openTrades[0][0].openPrice)
    const openPriceBigNumber = new BigNumber(openPrice)
    const sl_dist = openPriceBigNumber.times(80).div(100).div(10)
    const sl = openPriceBigNumber.minus(sl_dist).minus(1)

    // update Tp
    await expect(pexTradingV1.connect(trader).updateSl(1,0,BigInt(sl))).to.be.revertedWith("SL_TOO_BIG")
  })

})