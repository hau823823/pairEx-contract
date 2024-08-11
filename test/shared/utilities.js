const BN = require('bn.js')
const axios = require("axios")
const BigNumber = require("bignumber.js")
const { GetConfig } = require("../../config/getConfig")

const maxUint256 = ethers.constants.MaxUint256

function newWallet() {
  return ethers.Wallet.createRandom()
}

function bigNumberify(n) {
  return ethers.BigNumber.from(n)
}

function expandDecimals(n, decimals) {
  return bigNumberify(n).mul(bigNumberify(10).pow(decimals))
}

async function send(provider, method, params = []) {
  await provider.send(method, params)
}

async function mineBlock(provider) {
  await send(provider, "evm_mine")
}

async function increaseTime(provider, seconds) {
  await send(provider, "evm_increaseTime", [seconds])
}

async function gasUsed(provider, tx) {
  return (await provider.getTransactionReceipt(tx.hash)).gasUsed
}

async function getNetworkFee(provider, tx) {
  const gas = await gasUsed(provider, tx)
  return gas.mul(tx.gasPrice)
}

async function reportGasUsed(provider, tx, label) {
  const { gasUsed } = await provider.getTransactionReceipt(tx.hash)
  console.info(label, gasUsed.toString())
}

async function getBlockTime(provider) {
  const blockNumber = await provider.getBlockNumber()
  const block = await provider.getBlock(blockNumber)
  return block.timestamp
}

async function getTxnBalances(provider, user, txn, callback) {
    const balance0 = await provider.getBalance(user.address)
    const tx = await txn()
    const fee = await getNetworkFee(provider, tx)
    const balance1 = await provider.getBalance(user.address)
    callback(balance0, balance1, fee)
}

function print(label, value, decimals) {
  if (decimals === 0) {
    console.log(label, value.toString())
    return
  }
  const valueStr = ethers.utils.formatUnits(value, decimals)
  console.log(label, valueStr)
}

function getPriceBitArray(prices) {
  let priceBitArray = []
  let shouldExit = false

  for (let i = 0; i < parseInt((prices.length - 1) / 8) + 1; i++) {
    let priceBits = new BN('0')
    for (let j = 0; j < 8; j++) {
      let index = i * 8 + j
      if (index >= prices.length) {
        shouldExit = true
        break
      }

      const price = new BN(prices[index])
      if (price.gt(new BN("2147483648"))) { // 2^31
        throw new Error(`price exceeds bit limit ${price.toString()}`)
      }
      priceBits = priceBits.or(price.shln(j * 32))
    }

    priceBitArray.push(priceBits.toString())

    if (shouldExit) { break }
  }

  return priceBitArray
}

function getPriceBits(prices) {
  if (prices.length > 8) {
    throw new Error("max prices.length exceeded")
  }

  let priceBits = new BN('0')

  for (let j = 0; j < 8; j++) {
    let index = j
    if (index >= prices.length) {
      break
    }

    const price = new BN(prices[index])
    if (price.gt(new BN("2147483648"))) { // 2^31
      throw new Error(`price exceeds bit limit ${price.toString()}`)
    }

    priceBits = priceBits.or(price.shln(j * 32))
  }

  return priceBits.toString()
}

const limitDecimals = (amount, maxDecimals) => {
  let amountStr = amount.toString();
  if (maxDecimals === undefined) {
    return amountStr;
  }
  if (maxDecimals === 0) {
    return amountStr.split(".")[0];
  }
  const dotIndex = amountStr.indexOf(".");
  if (dotIndex !== -1) {
    let decimals = amountStr.length - dotIndex - 1;
    if (decimals > maxDecimals) {
      amountStr = amountStr.substr(0, amountStr.length - (decimals - maxDecimals));
    }
  }
  return amountStr;
}

const padDecimals = (amount, minDecimals) => {
  let amountStr = amount.toString();
  const dotIndex = amountStr.indexOf(".");
  if (dotIndex !== -1) {
    const decimals = amountStr.length - dotIndex - 1;
    if (decimals < minDecimals) {
      amountStr = amountStr.padEnd(amountStr.length + (minDecimals - decimals), "0");
    }
  } else {
    amountStr = amountStr + ".0000";
  }
  return amountStr;
}

const parseValue = (value, tokenDecimals) => {
  const pValue = parseFloat(value);
  if (isNaN(pValue)) {
    return undefined;
  }
  value = limitDecimals(value, tokenDecimals);
  const amount = ethers.utils.parseUnits(value, tokenDecimals);
  return bigNumberify(amount);
}

function numberWithCommas(x) {
  if (!x) {
    return "...";
  }
  var parts = x.toString().split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return parts.join(".");
}

const formatAmount = (amount, tokenDecimals, displayDecimals, useCommas, defaultValue) => {
  if (!defaultValue) {
    defaultValue = "...";
  }
  if (amount === undefined || amount.toString().length === 0) {
    return defaultValue;
  }
  if (displayDecimals === undefined) {
    displayDecimals = 4;
  }
  let amountStr = ethers.utils.formatUnits(amount, tokenDecimals);
  amountStr = limitDecimals(amountStr, displayDecimals);
  if (displayDecimals !== 0) {
    amountStr = padDecimals(amountStr, displayDecimals);
  }
  if (useCommas) {
    return numberWithCommas(amountStr);
  }
  return amountStr;
};

function sleep(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  })
}

async function deployContract(name, args) {
  const contractFactory = await ethers.getContractFactory(name)
  return await contractFactory.deploy(...args)
}

async function contractAt(name, address) {
  const contractFactory = await ethers.getContractFactory(name)
  return await contractFactory.attach(address)
}

async function getOpenPriceByChainLink(coin){
  let config = GetConfig();
  const btcPriceFeed = config.address.btc_price_feed;
  const ethPriceFeed = config.address.eth_price_feed;

  const [user] = await ethers.getSigners();

  if (coin.toUpperCase() == "BTC") {
    contractAddress = btcPriceFeed;
  } else {
    contractAddress = ethPriceFeed;
  }
  const priceFeed = await ethers.getContractAt("contracts/interfaces/IChainlinkFeed.sol:IChainlinkFeed", contractAddress);
  const price = await priceFeed.latestRoundData();

  return BigInt(price[1]*100)
}

async function getOpenPrice(coin){
  let url = `https://min-api.cryptocompare.com/data/price?fsym=${coin.toUpperCase()}&tsyms=USD`
  let openPrice, openPriceExpand

  try {
    const response = await axios.get(url);
    openPrice = new BigNumber(JSON.parse(JSON.stringify(response.data)).USD)
    openPriceExpand = BigInt(openPrice.times(Math.pow(10, 10)))
  } catch (error) {
    console.log(error);
  }

  return openPriceExpand
}

async function getTopics(contract, eventName){
  const eventInterface = contract.interface.getEvent(eventName);
  const fragment = ethers.utils.EventFragment.from(eventInterface.format());
  const emptyIface = new ethers.utils.Interface([]);
  const topicHash = emptyIface.getEventTopic(fragment);
  return topicHash
}

/**
 * 初始化合約部署以及配置
 */
async function initDeploy(deployer, gov, manager, feedPnlAddress, botAddress){
  const MAX_INT = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"

  let config = GetConfig()
  const linkToken = config.address.link_token
  const linkPriceFeed = config.address.link_price_feed
  const btcPriceFeed = config.address.btc_price_feed;
  const ethPriceFeed = config.address.eth_price_feed;

  let usdt
  let pexTradingStorageV1
  let pexPairInfosV1
  let pexPairsStorageV1
  let pexNftRewardsV1
  let pexTradingV1
  let pexPriceAggregatorV1
  let pexTradingCallbacksV1
  let pexTradeRegisterV1_1
  let pexAdlClosingV1_1
  let pexAdlCallbacksV1_1
  let referal
  let ptokenV1
  let pexMonthPassNftV1_1
  let oracles1
  let oracles2
  let oracles = []

  usdt = await deployContract("TestToken", ["USDT", "USDT", 6, BigInt(5000 * 1e6)])
  await usdt.mint(deployer.address, BigInt(1e30 * 1e6))

  pexTradingStorageV1 = await deployContract("PairexTradingStorageV1", [])
  await pexTradingStorageV1.initialize(gov.address, usdt.address, linkToken)
  pexPairsStorageV1 = await deployContract("PEXPairsStorageV1", [])
  await pexPairsStorageV1.initialize(1, pexTradingStorageV1.address)
  pexPairInfosV1 = await deployContract("PEXPairInfosV1", [])
  await pexPairInfosV1.initialize(pexTradingStorageV1.address)
  pexNftRewardsV1 = await deployContract("PEXNftRewardsV1", [])
  await pexNftRewardsV1.initialize(pexTradingStorageV1.address)

  referal = await deployContract("PEXReferralStorageV1_1", [])
  await referal.initialize(pexTradingStorageV1.address)

  oracles1 = await deployContract("Oracle", [linkToken])
  oracles2 = await deployContract("Oracle", [linkToken])
  oracles.push(oracles1)
  oracles.push(oracles2)

  pexPriceAggregatorV1 = await deployContract("PEXPriceAggregatorV1", [linkToken, pexTradingStorageV1.address, pexPairsStorageV1.address, linkPriceFeed, 1, [oracles1.address, oracles2.address]])
  ptokenV1 = await deployContract("PTokenV1", []) 
  await ptokenV1.initialize("PLP", "PLP", 6, usdt.address, pexTradingStorageV1.address, pexTradingStorageV1.address, feedPnlAddress.address)

  pexTradingCallbacksV1 = await deployContract("PEXTradingCallbacksV1" ,[])
  await pexTradingCallbacksV1.initialize(pexTradingStorageV1.address, pexNftRewardsV1.address, pexPairInfosV1.address, ptokenV1.address, 100, 0, 0, 75, 1, 900, 1)
  await pexTradingCallbacksV1.connect(gov).setReferralStorage(referal.address);
  await ptokenV1.connect(gov).updatePnlHandler(pexTradingCallbacksV1.address)

  pexTradingV1 = await deployContract("PEXTradingV1", [pexTradingStorageV1.address, pexNftRewardsV1.address, pexPairInfosV1.address, pexTradingCallbacksV1.address, BigInt(1e5 * 1e6), 3, 3])
  
  pexAdlClosingV1_1 = await deployContract("PEXAdlClosingV1_1", [])
  await pexAdlClosingV1_1.initialize(pexTradingStorageV1.address)

  pexAdlCallbacksV1_1 = await deployContract("PEXAdlCallbacksV1_1", [])
  await pexAdlCallbacksV1_1.initialize(pexTradingStorageV1.address, pexPairInfosV1.address, pexTradingCallbacksV1.address)

  pexTradeRegisterV1_1 = await deployContract("PEXTradeRegisterV1_1", [])
  await pexTradeRegisterV1_1.initialize(pexTradingStorageV1.address, pexPairInfosV1.address, pexNftRewardsV1.address, pexTradingCallbacksV1.address)

  pexMonthPassNftV1_1 = await deployContract("PairExPassNftV1_1", [usdt.address, pexTradingStorageV1.address])

  await pexTradingV1.connect(gov).pause()
  await pexTradingCallbacksV1.connect(gov).pause()
  await pexTradingStorageV1.connect(gov).setVault(ptokenV1.address)
  await pexTradingStorageV1.connect(gov).setPriceAggregator(pexPriceAggregatorV1.address)
  await pexTradingStorageV1.connect(gov).setTrading(pexTradingV1.address)
  await pexTradingStorageV1.connect(gov).setCallbacks(pexTradingCallbacksV1.address)
  await pexTradingStorageV1.connect(gov).setTradeRegister(pexTradeRegisterV1_1.address)
  await pexTradingStorageV1.connect(gov).setAdlClosing(pexAdlClosingV1_1.address)
  await pexTradingStorageV1.connect(gov).setAdlCallbacks(pexAdlCallbacksV1_1.address)
  await pexTradingStorageV1.connect(gov).setPairsStorage(pexPairsStorageV1.address)
  await pexTradingStorageV1.connect(gov).setPairsInfos(pexPairInfosV1.address)
  await pexTradingStorageV1.connect(gov).setMonthPassNft(pexMonthPassNftV1_1.address)
  await pexTradingStorageV1.connect(gov).updateSupportedCollateral(usdt.address)
  await pexTradingStorageV1.connect(gov).addTradingContract(pexTradingV1.address)
  await pexTradingStorageV1.connect(gov).addTradingContract(pexTradingCallbacksV1.address)
  await pexTradingStorageV1.connect(gov).addTradingContract(pexAdlClosingV1_1.address)
  await pexTradingStorageV1.connect(gov).addTradingContract(pexAdlCallbacksV1_1.address)
  await pexTradingStorageV1.connect(gov).addTradingContract(pexPriceAggregatorV1.address)
  await pexTradingStorageV1.connect(gov).addTradingContract(pexTradeRegisterV1_1.address)
  await pexTradingStorageV1.connect(gov).addBotWhiteList(botAddress.address)
  await pexTradingStorageV1.connect(gov).setMaxOpenInterestUsdt(0, BigInt(100000000 * 1e6))
  await pexTradingStorageV1.connect(gov).setMaxOpenInterestUsdt(1, BigInt(100000000 * 1e6))
  await pexTradingStorageV1.connect(gov).setNftSuccessTimelock(0)
  await pexTradingV1.connect(gov).pause()
  await pexTradingCallbacksV1.connect(gov).pause()


  await pexPairsStorageV1.connect(gov).addGroup(["crypto", "0x6239336336373639316264343437346239613031653861646130383832356637", 2 ,100, 100])
  await pexPairsStorageV1.connect(gov).addFee(["crypto", 800000000, 800000000, 40000000, 0, 0, BigInt(500 * 1e6)])
  await pexPairsStorageV1.connect(gov).addPair(["BTC", "USDT", [btcPriceFeed, "0x0000000000000000000000000000000000000000", 0, 15000000000], 0, 0, 0])
  await pexPairsStorageV1.connect(gov).addPair(["ETH", "USDT", [ethPriceFeed, "0x0000000000000000000000000000000000000000", 0, 15000000000], 0, 0, 0])

  await pexPairInfosV1.connect(gov).setManager(manager.address)
  await pexPairInfosV1.connect(manager).setMaxNegativePnlOnOpenP(400000000000)
  await pexPairInfosV1.connect(manager).setPairParams(0, [0, 0, 12987, 789])
  await pexPairInfosV1.connect(manager).setPairParams(1, [0, 0, 31040, 1718])

  const link = await contractAt("TestToken", linkToken)
  await link.transfer(pexPriceAggregatorV1.address, BigInt(0.1 * 1e18))
  await link.transfer(botAddress.address, BigInt(0.1 * 1e18))
  await link.connect(botAddress).approve(pexTradingStorageV1.address, MAX_INT)

  return {
    'usdt': usdt,
    'pexTradingStorageV1': pexTradingStorageV1,
    'pexPairInfosV1': pexPairInfosV1,
    'pexPairsStorageV1': pexPairsStorageV1,
    'pexNftRewardsV1': pexNftRewardsV1,
    'pexTradingV1': pexTradingV1,
    'pexPriceAggregatorV1': pexPriceAggregatorV1,
    'pexTradingCallbacksV1': pexTradingCallbacksV1,
    'pexReferralStorage': referal,
    'ptokenV1': ptokenV1,
    'oracles1': oracles1,
    'oracles2': oracles2,
    'pexAdlClosingV1_1': pexAdlClosingV1_1,
    'pexAdlCallbacksV1_1': pexAdlCallbacksV1_1,
    'pexTradeRegisterV1_1': pexTradeRegisterV1_1,
    'pexMonthPassNftV1_1': pexMonthPassNftV1_1
  }
}

function currentPercentProfit(openPrice, currentPrice, buy, leverage){
  const maxPnlP = new BigNumber(900 * 1e10)
  const openPriceBig = new BigNumber(openPrice)
  const currentPriceBig = new BigNumber(currentPrice)
  let profit_dist

  if(buy){
    profit_dist = currentPriceBig.minus(openPriceBig)
  } else {
    profit_dist = openPriceBig.minus(currentPriceBig)
  }

  const p = profit_dist.times(100).times(1e10).times(leverage).div(openPriceBig)
  if(p > maxPnlP){
    return maxPnlP
  } else {
    return p
  }
}

function getNetPnlOffChain(percentProfit, currentUsdtPos, closingFeeUsdt, rolloverFee, fundingFee){
  const currentUsdtPosBig = new BigNumber(currentUsdtPos)
  value = currentUsdtPosBig.plus(currentUsdtPosBig.times(percentProfit).div(1e10).div(100)).minus(rolloverFee).minus(fundingFee)
  
  thershold = currentUsdtPosBig.times(10).div(100)

  if (value.isLessThan(thershold)){
    return 0
  }

  value = value.minus(closingFeeUsdt)

  if (value.isGreaterThan(0)) {
    return value
  } else {
    return 0
  }

}

function getVaultFlowOffChain(percentProfit, currentUsdtPos, closingFeeUsdt, rolloverFee, fundingFee) {
  const currentUsdtPosBig = new BigNumber(currentUsdtPos)

  const usdtSentToTrader = getNetPnlOffChain(percentProfit, currentUsdtPos, closingFeeUsdt, rolloverFee, fundingFee)

  const usdtLeftInStorage = currentUsdtPosBig.minus(closingFeeUsdt).minus(rolloverFee)

  if (usdtSentToTrader.isGreaterThan(usdtLeftInStorage)) {
    return usdtSentToTrader.minus(usdtLeftInStorage)
  } else {
    return usdtLeftInStorage.minus(usdtSentToTrader)
  }
}
 
module.exports = {
  deployContract,
  contractAt,
  newWallet,
  maxUint256,
  bigNumberify,
  expandDecimals,
  mineBlock,
  increaseTime,
  gasUsed,
  getNetworkFee,
  reportGasUsed,
  getBlockTime,
  getTxnBalances,
  print,
  getPriceBitArray,
  getPriceBits,
  formatAmount,
  parseValue,
  sleep,
  getOpenPrice,
  getOpenPriceByChainLink,
  getTopics,
  initDeploy,
  currentPercentProfit,
  getNetPnlOffChain,
  getVaultFlowOffChain
}
