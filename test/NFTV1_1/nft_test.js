const {expect} = require("chai")
const {ethers} = require("ethers")
const BigNumber = require("bignumber.js")
const {getOpenPrice, getOpenPriceByChainLink, sleep, initDeploy, reportGasUsed, deployContract} = require("../shared/utilities")
const { GetConfig } = require("../../config/getConfig")

describe("NFTV1_1.NFT", function() {
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
  
  let nft
  let usdt

  beforeEach(async () => {

    // 部署初始合約
    let config = GetConfig()
    const linkToken = config.address.eth_price_feed

    usdt = await deployContract("TestToken", ["USDT", "USDT", 6, BigInt(5000 * 1e6)])
    await usdt.mint(deployer.address, BigInt(1e30 * 1e6))

    pexTradingStorageV1 = await deployContract("PairexTradingStorageV1", [])
    await pexTradingStorageV1.initialize(gov.address, usdt.address, linkToken)

    nft = await deployContract("PairExPassNftV1_1", [usdt.address, pexTradingStorageV1.address])

  })

  it("nft set params", async () => {

    // 初始 timestamp 設定檢查
    await nft.connect(deployer).setMonthTimeStamp(2301, 100)
    expect(await nft.monthTimeStamps(2301)).equal(BigInt(100))

    await expect(nft.connect(deployer).setMonthTimeStamp(1, 100)).to.be.revertedWith("INVALID_TOKENID")
    await expect(nft.connect(trader1).setMonthTimeStamp(2301, 100)).to.be.revertedWith("Ownable: caller is not the owner")

    const tokenId = [2301, 2302]
    const timeStamp = [1 , 2]
    await nft.connect(deployer).setMonthTimeStampsArray([2301, 2302], [1 , 2])
    for(i = 0; i < 2; i ++){
        expect(await nft.monthTimeStamps(tokenId[i])).equal(BigInt(timeStamp[i]))
    }

    await expect(nft.connect(deployer).setMonthTimeStampsArray([2301, 2302], [1])).to.be.revertedWith("WRONG_PARAMS")
  })

  it("nft isMintable", async () => {

    // 初始化參數
    await nft.connect(deployer).setMonthTimeStampsArray(
      [2303, 2304,2305,2306,2307,2308],
      [1677628800, 1680307200,1682899200,1685577600,1688169600,1690848000]
    )
    await nft.connect(deployer).setMonthAmountsArrary(
      [2303, 2304,2305,2306,2307,2308],
      [10, 10,10,10,10,10]
    )

    expect(await nft.isMintable(2303)).equal(false);
    expect(await nft.isMintable(2304)).equal(false);
    expect(await nft.isMintable(2305)).equal(false);
    expect(await nft.isMintable(2306)).equal(false);

    expect(await nft.isUsable(2303)).equal(false);
    expect(await nft.isUsable(2304)).equal(false);
    expect(await nft.isUsable(2305)).equal(false);
    expect(await nft.isUsable(2306)).equal(false);

  })

  /*
  it("nft isExpired", async () => {

  })
  */

  /**
  it("nft getEndTimeTokenId", async () => {

    startTime = await nft.getStartTimeTokenId(2305,1)
    console.log(startTime)

    endTime = await nft.getEndTimeTokenId(2305,1)
    console.log(endTime)

  })
  */

})