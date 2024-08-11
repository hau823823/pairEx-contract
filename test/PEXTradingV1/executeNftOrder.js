const {expect} = require("chai")
const {ethers} = require("ethers")
const BigNumber = require("bignumber.js")
const {getOpenPrice, getOpenPriceByChainLink, sleep, initDeploy} = require("../shared/utilities")
const { GetConfig } = require("../../config/getConfig")

describe("PEXTrading.executeNftOrder", function() {
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

  it("triggered limit order open (ETH long, normal case)", async () => {
    // 添加流動性
    await usdt.approve(ptokenV1.address, MAX_INT)
    await ptokenV1.applyDeposit(BigInt(1e10 * 1e6), deployer.address)
    await ptokenV1.connect(feedPnlAddress).runDeposit(1, 0, 0)

    await usdt.transfer(trader.address, BigInt(1000 * 1e6))
    await usdt.connect(trader).approve(pexTradingStorageV1.address, MAX_INT)

    // 發起限價委託
    const openPrice = await getOpenPrice('ETH')
    const TradeData = [trader.address, 1,0, 0, BigInt(1000 * 1e6), openPrice - BigInt(5 * 1e10), 1, 10, 0, 0]
    const orderType = 1
    const slippage = 1e10
    await pexTradingV1.connect(trader).openTrade(TradeData, orderType, slippage, 0)

    // 模擬價格跌到 wanted price 並且機器人觸發開倉
    const openPriceFake = openPrice - BigInt(5 * 1e10)
    await pexPairsStorageV1.connect(gov).updatePair(1, ["ETH", "USDT", [ethPriceFeed, "0x0000000000000000000000000000000000000000", 0, 1000000000000], 0, 0, 0])

    // 機器人執行 executeNftOrder
    let fulfill_tx
    oracles1.once("OracleRequest", 
    async (specId, requester, requestId, payment, callbackAddr, callbackFunctionId, cancelExpiration, dataVersion, data, event) => {
      fulfill_tx = await oracles1.fulfillOracleRequest(
        requestId, payment, callbackAddr, callbackFunctionId, cancelExpiration, [openPriceFake]
      );
    })
    const executedNftOrder_tx = await pexTradingV1.connect(botAddress).executeNftOrder(3, trader.address, 1, 0, 1)
    await sleep(5000)

    // 檢查是否觸發機器人執行事件
    await expect(executedNftOrder_tx)
      .to.emit(pexTradingV1, "NftOrderInitiated")
      .withArgs(1, botAddress.address, trader.address, 1)

    // 檢查是否觸發喂價事件
    await expect(fulfill_tx)
      .to.emit(pexTradingCallbacksV1, "LimitExecuted")

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
  })

  it("triggered limit order open (over lp limit, should be reverted)", async () => {
    const openPrice = await getOpenPrice('ETH')
    const TradeData_market = [trader.address,1, 0, 0, BigInt(1000 * 1e6), openPrice, 1, 10, 0, 0]
    const TradeData_limit = [trader.address,1, 0, 0, BigInt(1000 * 1e6), openPrice - BigInt(5 * 1e10), 1, 10, 0, 0]
    const slippage = 1e10

    // 添加不足的流動性
    await usdt.approve(ptokenV1.address, MAX_INT)
    await ptokenV1.applyDeposit(BigInt(1500 * 1e6), deployer.address)
    await ptokenV1.connect(feedPnlAddress).runDeposit(1, 0, 0)
  
    await usdt.transfer(trader.address, BigInt(2000 * 1e6))
    await usdt.connect(trader).approve(pexTradingStorageV1.address, MAX_INT)

    // 發起第一筆限價委託
    await pexTradingV1.connect(trader).openTrade(TradeData_limit, 1, slippage, 0)

    // 監聽並喂價
    oracles1.on("OracleRequest", 
      async (specId, requester, requestId, payment, callbackAddr, callbackFunctionId, cancelExpiration, dataVersion, data, event) => {
        fulfill_tx = await oracles1.fulfillOracleRequest(
          requestId, payment, callbackAddr, callbackFunctionId, cancelExpiration, [openPrice]
        );
    })

    // 觸發第二筆市價委託請求事件
    await pexTradingV1.connect(trader).openTrade(TradeData_market, 0, slippage, 0)
    await sleep(4000)

    // 第三筆限價開倉應該 revert
    await expect(pexTradingV1.connect(botAddress).executeNftOrder(3, trader.address, 1, 0, 1)).to.be.revertedWith("OUT_EXPOSURELIMITS")

    // 檢查持倉數量
    expect(await pexTradingStorageV1.openTradesCount(trader.address, 1)).equal(1)

    // 檢查接口獲取的 upnl id 是否正確
    expect(await pexTradingStorageV1.getUpnlLastId()).equal(1)
  })

  it("triggered limit order open (over oi limit, should be reverted)", async () => {
    const openPrice = await getOpenPrice('ETH')
    const TradeData_market = [trader.address,1, 0, 0, BigInt(1000 * 1e6), openPrice, 1, 10, 0, 0]
    const TradeData_limit = [trader.address,1, 0, 0, BigInt(1000 * 1e6), openPrice - BigInt(5 * 1e10), 1, 10, 0, 0]
    const slippage = 1e10

    // 添加流動性
    await usdt.approve(ptokenV1.address, MAX_INT)
    await ptokenV1.applyDeposit(BigInt(1e10 * 1e6), deployer.address)
    await ptokenV1.connect(feedPnlAddress).runDeposit(1, 0, 0)
  
    await usdt.transfer(trader.address, BigInt(2000 * 1e6))
    await usdt.connect(trader).approve(pexTradingStorageV1.address, MAX_INT)

    // 調整 oi 限制，將其調低
    await pexTradingStorageV1.connect(gov).setMaxOpenInterestUsdt(1,BigInt(15000 * 1e6))

    // 發起第一筆限價委託
    await pexTradingV1.connect(trader).openTrade(TradeData_limit, 1, slippage, 0)

    // 監聽並喂價
    oracles1.on("OracleRequest", 
      async (specId, requester, requestId, payment, callbackAddr, callbackFunctionId, cancelExpiration, dataVersion, data, event) => {
        fulfill_tx = await oracles1.fulfillOracleRequest(
          requestId, payment, callbackAddr, callbackFunctionId, cancelExpiration, [openPrice]
        );
    })

    // 觸發第二筆市價委託請求事件
    await pexTradingV1.connect(trader).openTrade(TradeData_market, 0, slippage, 0)
    await sleep(4000)

    // 第三筆限價開倉應該 revert
    await expect(pexTradingV1.connect(botAddress).executeNftOrder(3, trader.address, 1, 0, 1)).to.be.revertedWith("OUT_EXPOSURELIMITS")

    // 檢查持倉數量
    expect(await pexTradingStorageV1.openTradesCount(trader.address, 1)).equal(1)

    // 檢查接口獲取的 upnl id 是否正確
    expect(await pexTradingStorageV1.getUpnlLastId()).equal(1)
  })
})