const {expect} = require("chai")
const {ethers} = require("ethers")
const BigNumber = require("bignumber.js")
const {getOpenPrice, getOpenPriceByChainLink, sleep, initDeploy, reportGasUsed} = require("../shared/utilities")
const { GetConfig } = require("../../config/getConfig")

describe("PEXTrading.openTrade", function() {
  const provider = waffle.provider
  const [deployer, gov, manager, feedPnlAddress, botAddress, trader] = provider.getWallets()

  const MAX_INT = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
  const openFeeP = new BigNumber(800000000)

  let config = GetConfig()
  const ethPriceFeed = config.address.eth_price_feed
  const usdtPriceFeed = config.address.usdt_price_feed

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
  })

  it("market long normal case (ETH)", async () => {
    const openPrice = await getOpenPrice('ETH')
    const TradeData = [
      trader.address,
      1, //pairIndex(BTC 0, ETH 1)
      0, //index
      0, //initialPosUSDT
      BigInt(1000 * 1e6), //positionSizeUsdt
      openPrice,
      1, //buy
      10, //leverage
      0, //tp
      0  //sl
    ]
    const orderType = 0
    const slippage = 1e10

    // 添加流動性
    await usdt.approve(ptokenV1.address, MAX_INT)
    await ptokenV1.applyDeposit(BigInt(1e10 * 1e6), deployer.address)
    await ptokenV1.connect(feedPnlAddress).runDeposit(1, 0, 0)
  
    await usdt.transfer(trader.address, BigInt(1e5 * 1e6))
    await usdt.connect(trader).approve(pexTradingStorageV1.address, MAX_INT)

    // 監聽並喂價
    let fulfill_tx
    oracles1.once("OracleRequest", 
      async (specId, requester, requestId, payment, callbackAddr, callbackFunctionId, cancelExpiration, dataVersion, data, event) => {
        fulfill_tx = await oracles1.fulfillOracleRequest(
          requestId, payment, callbackAddr, callbackFunctionId, cancelExpiration, [openPrice]
        );
    })

    // 觸發市價委託請求事件
    const openTrade_tx = await pexTradingV1.connect(trader).openTrade(TradeData, orderType, slippage, 0)
    await sleep(4000)

    await expect(openTrade_tx)
      .to.emit(pexTradingV1, "MarketOrderInitiated")
      .withArgs(1, trader.address, 1, true)

    // 觸發喂價請求
    await expect(openTrade_tx)
      .to.emit(oracles1, "OracleRequest")

    // 檢查喂價成功
    await expect(fulfill_tx)
      .to.emit(pexTradingCallbacksV1, "MarketExecuted")
    
    // 檢查持倉數量
    expect(await pexTradingStorageV1.openTradesCount(trader.address, 1)).equal(1)

    // 檢查開倉手續費
    const openFee = openFeeP.div(1e10).div(100).times(10).times(1000 * 1e6)
    const positionSizeUsdt = new BigNumber(1000 * 1e6)
    const openCollateral = positionSizeUsdt.minus(openFee)
    const openTrade = await pexTradingStorageV1.getAllOpenTradesByTrader(trader.address)

    expect(openTrade[0][0].positionSizeUsdt.toString()).equal(openCollateral.toString())

    // 將保證金轉至 storage 合約並且扣除開倉手續費
    expect(await usdt.balanceOf(pexTradingStorageV1.address)).equal(BigInt(positionSizeUsdt))
    //expect(await usdt.balanceOf(gov.address)).equal(BigInt(openFee))
    expect(await pexTradingStorageV1.platformFee()).equal(BigInt(openFee))
    test = await pexTradingStorageV1.platformFee()
    console.log("platform fee:", test)

    // 檢查是否觸發 upnl id 事件
    await expect(fulfill_tx)
      .to.emit(pexTradingStorageV1, "upnlLastIdUpdated")
      .withArgs(1)

    // 檢查接口獲取的 upnl id 是否正確
    expect(await pexTradingStorageV1.getUpnlLastId()).equal(1)

    // 紀錄喂價 gas fee
    await reportGasUsed(provider, fulfill_tx, "market long normal case")
  })

  it("market short normal case (ETH)", async () => {
    const openPrice = await getOpenPrice('ETH')
    const TradeData = [
      trader.address,
      1, //pairIndex(BTC 0, ETH 1)
      0, //index
      0, //initialPosUSDT
      BigInt(1000 * 1e6), //positionSizeUsdt
      openPrice,
      0, //buy
      10, //leverage
      0, //tp
      0  //sl
    ]
    const orderType = 0
    const slippage = 1e10

    // 添加流動性
    await usdt.approve(ptokenV1.address, MAX_INT)
    await ptokenV1.applyDeposit(BigInt(1e10 * 1e6), deployer.address)
    await ptokenV1.connect(feedPnlAddress).runDeposit(1, 0, 0)
  
    await usdt.transfer(trader.address, BigInt(1e5 * 1e6))
    await usdt.connect(trader).approve(pexTradingStorageV1.address, MAX_INT)

    // 監聽並喂價
    let fulfill_tx
    oracles1.once("OracleRequest", 
      async (specId, requester, requestId, payment, callbackAddr, callbackFunctionId, cancelExpiration, dataVersion, data, event) => {
        fulfill_tx = await oracles1.fulfillOracleRequest(
          requestId, payment, callbackAddr, callbackFunctionId, cancelExpiration, [openPrice]
        );
    })

    // 觸發市價委託請求事件
    const openTrade_tx = await pexTradingV1.connect(trader).openTrade(TradeData, orderType, slippage, 0)
    await sleep(4000)

    await expect(openTrade_tx)
      .to.emit(pexTradingV1, "MarketOrderInitiated")
      .withArgs(1, trader.address, 1, true)

    // 觸發喂價請求
    await expect(openTrade_tx)
      .to.emit(oracles1, "OracleRequest")

    // 檢查喂價成功
    await expect(fulfill_tx)
      .to.emit(pexTradingCallbacksV1, "MarketExecuted")
    
    // 檢查持倉數量
    expect(await pexTradingStorageV1.openTradesCount(trader.address, 1)).equal(1)

    // 檢查開倉手續費
    const openFee = openFeeP.div(1e10).div(100).times(10).times(1000 * 1e6)
    const positionSizeUsdt = new BigNumber(1000 * 1e6)
    const openCollateral = positionSizeUsdt.minus(openFee)
    const openTrade = await pexTradingStorageV1.getAllOpenTradesByTrader(trader.address)

    expect(openTrade[0][0].positionSizeUsdt.toString()).equal(openCollateral.toString())

    // 將保證金轉至 storage 合約並且扣除開倉手續費
    expect(await usdt.balanceOf(pexTradingStorageV1.address)).equal(BigInt(positionSizeUsdt))
    //expect(await usdt.balanceOf(gov.address)).equal(BigInt(openFee))
    expect(await pexTradingStorageV1.platformFee()).equal(BigInt(openFee))

    // 檢查是否觸發 upnl id 事件
    await expect(fulfill_tx)
      .to.emit(pexTradingStorageV1, "upnlLastIdUpdated")
      .withArgs(1)

    // 檢查接口獲取的 upnl id 是否正確
    expect(await pexTradingStorageV1.getUpnlLastId()).equal(1)

    // 紀錄喂價 gas fee
    await reportGasUsed(provider, fulfill_tx, "market short normal case")
  })

  it("limit long normal case (ETH)", async () => {
    const openPrice = await getOpenPrice('ETH')
    const wantedPrice = openPrice - BigInt(5 * 1e6)
    const TradeData = [
      trader.address,
      1, //pairIndex(BTC 0, ETH 1)
      0, //index
      0, //initialPosUSDT
      BigInt(1000 * 1e6), //positionSizeUsdt
      openPrice - BigInt(5 * 1e10),
      1, //buy
      10, //leverage
      0, //tp
      0  //sl
    ]
    const orderType = 1
    const slippage = 1e10

    // 添加流動性
    await usdt.approve(ptokenV1.address, MAX_INT)
    await ptokenV1.applyDeposit(BigInt(1e10 * 1e6), deployer.address)
    await ptokenV1.connect(feedPnlAddress).runDeposit(1, 0, 0)
  
    await usdt.transfer(trader.address, BigInt(1e5 * 1e6))
    await usdt.connect(trader).approve(pexTradingStorageV1.address, MAX_INT)

    // 觸發限價委託請求事件
    openTrade_tx = await pexTradingV1.connect(trader).openTrade(TradeData, orderType, slippage, 0)

    await expect(openTrade_tx)
      .to.emit(pexTradingV1, "OpenLimitPlaced")
      .withArgs(trader.address, 1, 0)

    // 先將保證金轉至 storage 合約
    expect(await usdt.balanceOf(pexTradingStorageV1.address)).equal(BigInt(1000 * 1e6))

    // 檢查 openLimit orders 數量
    expect(await pexTradingStorageV1.openLimitOrdersCount(trader.address, 1)).equal(1)
  })

  it("market long (max SL & TP dist)", async () => {
    const openPrice = await getOpenPriceByChainLink('ETH')
    const openPriceBigNumber = new BigNumber(openPrice)
    const sl_dist = openPriceBigNumber.times(75).div(100).div(10)
    const tp_dist = openPriceBigNumber.times(900).div(100).div(10)
    const sl = openPriceBigNumber.minus(sl_dist)
    const tp = openPriceBigNumber.plus(tp_dist)
    
    
    const TradeData = [
      trader.address,
      1, //pairIndex(BTC 0, ETH 1)
      0, //index
      0, //initialPosUSDT
      BigInt(1000 * 1e6), //positionSizeUsdt
      openPrice,
      1, //buy
      10, //leverage
      BigInt(tp), //tp
      BigInt(sl)  //sl
    ]
    const orderType = 0
    const slippage = 1e10

    // 添加流動性
    await usdt.approve(ptokenV1.address, MAX_INT)
    await ptokenV1.applyDeposit(BigInt(1e10 * 1e6), deployer.address)
    await ptokenV1.connect(feedPnlAddress).runDeposit(1, 0, 0)
  
    await usdt.transfer(trader.address, BigInt(1e5 * 1e6))
    await usdt.connect(trader).approve(pexTradingStorageV1.address, MAX_INT)

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
      .withArgs(1, trader.address, 1, true)

    // 觸發喂價請求
    await expect(openTrade_tx)
      .to.emit(oracles1, "OracleRequest")

    // 檢查喂價成功
    await expect(fulfill_tx)
      .to.emit(pexTradingCallbacksV1, "MarketExecuted")
    
    // 檢查持倉數量
    expect(await pexTradingStorageV1.openTradesCount(trader.address, 1)).equal(1)

    // 檢查開倉手續費
    const openFee = openFeeP.div(1e10).div(100).times(10).times(1000 * 1e6)
    const positionSizeUsdt = new BigNumber(1000 * 1e6)
    const openCollateral = positionSizeUsdt.minus(openFee)
    const openTrade = await pexTradingStorageV1.getAllOpenTradesByTrader(trader.address)

    expect(openTrade[0][0].positionSizeUsdt.toString()).equal(openCollateral.toString())

    // 將保證金轉至 storage 合約並且扣除開倉手續費
    expect(await usdt.balanceOf(pexTradingStorageV1.address)).equal(BigInt(positionSizeUsdt))
    //expect(await usdt.balanceOf(gov.address)).equal(BigInt(openFee))
    expect(await pexTradingStorageV1.platformFee()).equal(BigInt(openFee))

    // 檢查實際開倉的 tp sl 參數是否相等
    const openTrades = await pexTradingStorageV1.getAllOpenTradesByTrader(trader.address)
    expect(openTrades[0][0].tp.toString()).equal(tp.toString())
    expect(openTrades[0][0].sl.toString()).equal(sl.toString())

    // 檢查是否觸發 upnl id 事件
    await expect(fulfill_tx)
      .to.emit(pexTradingStorageV1, "upnlLastIdUpdated")
      .withArgs(1)

    // 檢查接口獲取的 upnl id 是否正確
    expect(await pexTradingStorageV1.getUpnlLastId()).equal(1)

    // 紀錄喂價 gas fee
    await reportGasUsed(provider, fulfill_tx, "market long (max SL & TP dist)")
  })

  it("market long (over max TP dist, should be reverted)", async () => {
    const openPrice = await getOpenPriceByChainLink('ETH')
    const openPriceBigNumber = new BigNumber(openPrice)
    const tp_dist = openPriceBigNumber.times(900).div(100).div(10)
    const tp = openPriceBigNumber.plus(tp_dist).plus(1)
    
    
    const TradeData = [
      trader.address,
      1, //pairIndex(BTC 0, ETH 1)
      0, //index
      0, //initialPosUSDT
      BigInt(1000 * 1e6), //positionSizeUsdt
      openPrice,
      1, //buy
      10, //leverage
      BigInt(tp), //tp
      0  //sl
    ]
    const orderType = 0
    const slippage = 1e10

    // 添加流動性
    await usdt.approve(ptokenV1.address, MAX_INT)
    await ptokenV1.applyDeposit(BigInt(1e10 * 1e6), deployer.address)
    await ptokenV1.connect(feedPnlAddress).runDeposit(1, 0, 0)
  
    await usdt.transfer(trader.address, BigInt(1e5 * 1e6))
    await usdt.connect(trader).approve(pexTradingStorageV1.address, MAX_INT)

    // 檢查開倉請求是否 revert
    await expect(pexTradingV1.connect(trader).openTrade(TradeData, orderType, slippage, 0)).to.be.revertedWith("TP_TOO_BIG")
  })

  it("market long (over max sl dist, should be reverted)", async () => {
    const openPrice = await getOpenPriceByChainLink('ETH')
    const openPriceBigNumber = new BigNumber(openPrice)
    const sl_dist = openPriceBigNumber.times(75).div(100).div(10)
    const sl = openPriceBigNumber.minus(sl_dist).minus(1)
    
    
    const TradeData = [
      trader.address,
      1, //pairIndex(BTC 0, ETH 1)
      0, //index
      0, //initialPosUSDT
      BigInt(1000 * 1e6), //positionSizeUsdt
      openPrice,
      1, //buy
      10, //leverage
      0, //tp
      BigInt(sl)  //sl
    ]
    const orderType = 0
    const slippage = 1e10

    // 添加流動性
    await usdt.approve(ptokenV1.address, MAX_INT)
    await ptokenV1.applyDeposit(BigInt(1e10 * 1e6), deployer.address)
    await ptokenV1.connect(feedPnlAddress).runDeposit(1 ,0, 0)
  
    await usdt.transfer(trader.address, BigInt(1e5 * 1e6))
    await usdt.connect(trader).approve(pexTradingStorageV1.address, MAX_INT)

    // 檢查開倉請求是否 revert
    await expect(pexTradingV1.connect(trader).openTrade(TradeData, orderType, slippage, 0)).to.be.revertedWith("SL_TOO_BIG")
  })

  it("market long (over lp limit, should be reverted)", async () => {
    const openPrice = await getOpenPrice('ETH')
    const TradeData = [trader.address,1, 0, 0, BigInt(2000 * 1e6), openPrice, 1, 10, 0, 0]
    const orderType = 0
    const slippage = 1e10

    // 添加不足的流動性
    await usdt.approve(ptokenV1.address, MAX_INT)
    await ptokenV1.applyDeposit(BigInt(1000 * 1e6), deployer.address)
    await ptokenV1.connect(feedPnlAddress).runDeposit(1, 0, 0)
  
    await usdt.transfer(trader.address, BigInt(1e5 * 1e6))
    await usdt.connect(trader).approve(pexTradingStorageV1.address, MAX_INT)

    // 檢查開倉請求是否 revert
    await expect(pexTradingV1.connect(trader).openTrade(TradeData, orderType, slippage, 0)).to.be.revertedWith("OUT_EXPOSURELIMITS")

    // storage 合約不應該有錢轉入
    expect(await usdt.balanceOf(pexTradingStorageV1.address)).equal(BigInt(0))
    
    // 檢查持倉數量
    expect(await pexTradingStorageV1.openTradesCount(trader.address, 1)).equal(0)

    // trader 地址應該要有全數的金額
    expect(await usdt.balanceOf(trader.address)).equal(BigInt(1e5 * 1e6))

    // 檢查接口獲取的 upnl id 是否正確
    expect(await pexTradingStorageV1.getUpnlLastId()).equal(0)
  })

  it("market long (already have open trade and over lp limit, should be reverted)", async () => {
    const openPrice = await getOpenPrice('ETH')
    const TradeData = [trader.address,1, 0, 0, BigInt(1000 * 1e6), openPrice, 1, 10, 0, 0]
    const orderType = 0
    const slippage = 1e10

    // 添加不足的流動性
    await usdt.approve(ptokenV1.address, MAX_INT)
    await ptokenV1.applyDeposit(BigInt(1500 * 1e6), deployer.address)
    await ptokenV1.connect(feedPnlAddress).runDeposit(1, 0, 0)
  
    await usdt.transfer(trader.address, BigInt(2000 * 1e6))
    await usdt.connect(trader).approve(pexTradingStorageV1.address, MAX_INT)

    // 監聽並喂價
    oracles1.on("OracleRequest", 
      async (specId, requester, requestId, payment, callbackAddr, callbackFunctionId, cancelExpiration, dataVersion, data, event) => {
        fulfill_tx = await oracles1.fulfillOracleRequest(
          requestId, payment, callbackAddr, callbackFunctionId, cancelExpiration, [openPrice]
        );
    })

    // 觸發第一筆市價委託請求事件
    await pexTradingV1.connect(trader).openTrade(TradeData, orderType, slippage, 0)
    await sleep(4000)

    // 檢查第二筆開倉檢查開倉請求是否 revert
    await expect(pexTradingV1.connect(trader).openTrade(TradeData, orderType, slippage, 0)).to.be.revertedWith("OUT_EXPOSURELIMITS")

    // storage 合約不應該有第二筆錢轉入
    expect(await usdt.balanceOf(pexTradingStorageV1.address)).equal(BigInt(1000 * 1e6))
    
    // 檢查持倉數量
    expect(await pexTradingStorageV1.openTradesCount(trader.address, 1)).equal(1)

    // trader 地址應該要有第二筆的金額
    expect(await usdt.balanceOf(trader.address)).equal(BigInt(1000 * 1e6))

    // 檢查接口獲取的 upnl id 是否正確
    expect(await pexTradingStorageV1.getUpnlLastId()).equal(1)
  })

  it("market long (over oi limit, should be reverted)", async () => {
    const openPrice = await getOpenPrice('ETH')
    const TradeData = [trader.address,1, 0, 0, BigInt(2000 * 1e6), openPrice, 1, 10, 0, 0]
    const orderType = 0
    const slippage = 1e10

    // 添加流動性
    await usdt.approve(ptokenV1.address, MAX_INT)
    await ptokenV1.applyDeposit(BigInt(1e10 * 1e6), deployer.address)
    await ptokenV1.connect(feedPnlAddress).runDeposit(1, 0, 0)
  
    await usdt.transfer(trader.address, BigInt(1e5 * 1e6))
    await usdt.connect(trader).approve(pexTradingStorageV1.address, MAX_INT)

    // 調整 oi 限制，將其調低
    await pexTradingStorageV1.connect(gov).setMaxOpenInterestUsdt(1,BigInt(10000 * 1e6))

    // 檢查開倉請求是否 revert
    await expect(pexTradingV1.connect(trader).openTrade(TradeData, orderType, slippage, 0)).to.be.revertedWith("OUT_EXPOSURELIMITS")

    // storage 合約不應該有錢轉入
    expect(await usdt.balanceOf(pexTradingStorageV1.address)).equal(BigInt(0))
    
    // 檢查持倉數量
    expect(await pexTradingStorageV1.openTradesCount(trader.address, 1)).equal(0)

    // trader 地址應該要有全數的金額
    expect(await usdt.balanceOf(trader.address)).equal(BigInt(1e5 * 1e6))

    // 檢查接口獲取的 upnl id 是否正確
    expect(await pexTradingStorageV1.getUpnlLastId()).equal(0)
  })

  it("market long (already have open trade and over oi limit, should be reverted)", async () => {
    const openPrice = await getOpenPrice('ETH')
    const TradeData = [trader.address,1, 0, 0, BigInt(1000 * 1e6), openPrice, 1, 10, 0, 0]
    const orderType = 0
    const slippage = 1e10

    // 添加流動性
    await usdt.approve(ptokenV1.address, MAX_INT)
    await ptokenV1.applyDeposit(BigInt(1e10 * 1e6), deployer.address)
    await ptokenV1.connect(feedPnlAddress).runDeposit(1, 0, 0)
  
    await usdt.transfer(trader.address, BigInt(2000 * 1e6))
    await usdt.connect(trader).approve(pexTradingStorageV1.address, MAX_INT)

    // 調整 oi 限制，將其調低
    await pexTradingStorageV1.connect(gov).setMaxOpenInterestUsdt(1,BigInt(15000 * 1e6))

    // 監聽並喂價
    oracles1.on("OracleRequest", 
      async (specId, requester, requestId, payment, callbackAddr, callbackFunctionId, cancelExpiration, dataVersion, data, event) => {
        fulfill_tx = await oracles1.fulfillOracleRequest(
          requestId, payment, callbackAddr, callbackFunctionId, cancelExpiration, [openPrice]
        );
    })

    // 觸發第一筆市價委託請求事件
    await pexTradingV1.connect(trader).openTrade(TradeData, orderType, slippage, 0)
    await sleep(4000)

    // 檢查第二筆開倉檢查開倉請求是否 revert
    await expect(pexTradingV1.connect(trader).openTrade(TradeData, orderType, slippage, 0)).to.be.revertedWith("OUT_EXPOSURELIMITS")

    // storage 合約不應該有第二筆錢轉入
    expect(await usdt.balanceOf(pexTradingStorageV1.address)).equal(BigInt(1000 * 1e6))
    
    // 檢查持倉數量
    expect(await pexTradingStorageV1.openTradesCount(trader.address, 1)).equal(1)

    // trader 地址應該要有第二筆的金額
    expect(await usdt.balanceOf(trader.address)).equal(BigInt(1000 * 1e6))

    // 檢查接口獲取的 upnl id 是否正確
    expect(await pexTradingStorageV1.getUpnlLastId()).equal(1)
  })

  it("market long (use combine method to get ETH/USDT)", async () => {
    const openPrice = await getOpenPrice('ETH')
    const TradeData = [trader.address,1,0,0,BigInt(1000 * 1e6),openPrice,1,10,0,0]
    const orderType = 0
    const slippage = 1e10

    // 添加流動性
    await usdt.approve(ptokenV1.address, MAX_INT)
    await ptokenV1.applyDeposit(BigInt(1e10 * 1e6), deployer.address)
    await ptokenV1.connect(feedPnlAddress).runDeposit(1, 0, 0)
  
    await usdt.transfer(trader.address, BigInt(1e5 * 1e6))
    await usdt.connect(trader).approve(pexTradingStorageV1.address, MAX_INT)

    // 更新喂價計算方式
    await pexPairsStorageV1.connect(gov).updatePair(1, ["ETH", "USDT", [ethPriceFeed, usdtPriceFeed, 2, 15000000000], 0, 0, 0])

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
      .withArgs(1, trader.address, 1, true)

    // 觸發喂價請求
    await expect(openTrade_tx)
      .to.emit(oracles1, "OracleRequest")

    // 檢查喂價成功
    await expect(fulfill_tx)
      .to.emit(pexTradingCallbacksV1, "MarketExecuted")
    
    // 檢查持倉數量
    expect(await pexTradingStorageV1.openTradesCount(trader.address, 1)).equal(1)

    // 檢查開倉手續費
    const openFee = openFeeP.div(1e10).div(100).times(10).times(1000 * 1e6)
    const positionSizeUsdt = new BigNumber(1000 * 1e6)
    const openCollateral = positionSizeUsdt.minus(openFee)
    const openTrade = await pexTradingStorageV1.getAllOpenTradesByTrader(trader.address)

    expect(openTrade[0][0].positionSizeUsdt.toString()).equal(openCollateral.toString())

    // 將保證金轉至 storage 合約並且扣除開倉手續費
    expect(await usdt.balanceOf(pexTradingStorageV1.address)).equal(BigInt(positionSizeUsdt))
    //expect(await usdt.balanceOf(gov.address)).equal(BigInt(openFee))
    expect(await pexTradingStorageV1.platformFee()).equal(BigInt(openFee))

    // 檢查是否觸發 upnl id 事件
    await expect(fulfill_tx)
      .to.emit(pexTradingStorageV1, "upnlLastIdUpdated")
      .withArgs(1)

    // 檢查接口獲取的 upnl id 是否正確
    expect(await pexTradingStorageV1.getUpnlLastId()).equal(1)

    // 紀錄喂價 gas fee
    await reportGasUsed(provider, fulfill_tx, "market long (use combine method to get ETH/USDT)")
  })
})