const { ethers } = require('ethers')
const axios = require('axios')
const BigNumber = require("bignumber.js")
const { GetConfig } = require('./config/getConfig')
const cron = require('node-cron')
const readline = require('readline').createInterface({
  input: process.stdin,
  output: process.stdout
});

// abi 
//const usdt_abi = require('./abi/Usdt.json')
const usdt_abi = require('./abi/TestToken.json')
const pexTrading_abi = require('./abi/PEXTradingV1.json')
const pexStorageT_abi = require('./abi/PairexTradingStorageV1.json')

const config = GetConfig();
const node_url = config.url.node_rpc
const provider = new ethers.providers.JsonRpcProvider(node_url)

const traders = config.address_private.traders_private
const usdt_addr = config.address_contract.usdt_address
const pexTrading_addr = config.address_contract.pexTradingV1_address
const pexStorageT_addr = config.address_contract.pexStorageT_address

const pairs = config.params_config.trading_pairs
const positionParams = config.params_config.position_min_max
const levergaeParams = config.params_config.levergae_min_max
const timeInterval = config.params_config.timeInterval_min_max



// utils function

function getRandom(min, max){
  return Math.floor(Math.random()*max) + min;
}

async function getOpenPrice(coin){
  let url = `https://min-api.cryptocompare.com/data/price?fsym=${coin.toUpperCase()}&tsyms=USDT`
  let openPrice, openPriceExpand

  try {
    const response = await axios.get(url);
    openPrice = new BigNumber(JSON.parse(JSON.stringify(response.data)).USDT)
    openPriceExpand = BigInt(openPrice.times(Math.pow(10, 10)))
  } catch (error) {
    console.log(error)
  }

  return openPriceExpand
}

async function getUsdtBalance(address){  
  const usdt = new ethers.Contract(usdt_addr, usdt_abi, provider)
  const balance = await usdt.balanceOf(address)
  return balance.div(1e6).toNumber()
}

async function getOpenTradesCount(address, pairIndex){
  const pexStorageT = new ethers.Contract(pexStorageT_addr, pexStorageT_abi, provider)
  const tradeCount =  await pexStorageT.openTradesCount(address, pairIndex)

  return tradeCount.toNumber()
}

async function getOpenTradesByTrader(address) {
  const pexStorageT = new ethers.Contract(pexStorageT_addr, pexStorageT_abi, provider)
  const tradeInfo = await pexStorageT.getAllOpenTradesByTrader(address)

  return tradeInfo
}

async function executeOpenTrade(i, tradeInfo){
  const wallet = new ethers.Wallet(traders[i], provider)
  const pexTradingV1 = new ethers.Contract(pexTrading_addr, pexTrading_abi, wallet)

  try {
    await pexTradingV1.openTrade(
      tradeInfo,
      0, 
      10e10,
    )
  } catch (error) {
    console.log(error)
  }
}

async function executeCloseTrade(i, pairIndex, index){
  const wallet = new ethers.Wallet(traders[i], provider)
  const pexTradingV1 = new ethers.Contract(pexTrading_addr, pexTrading_abi, wallet)

  try {
    await pexTradingV1.closeTradeMarket(pairIndex, index)
  } catch (error) {
    console.log(error)
  }
}

async function randomTriggered(){

  // random trader index
  const i = getRandom(0, traders.length)
  const wallet = new ethers.Wallet(traders[i], provider)
  const traderAddr = wallet.address

  // trader addr usdt balance
  const usdtBalance = await getUsdtBalance(traderAddr)
  if(usdtBalance < 1){
    console.log("Usdt not enough")
    return false
  }


  // random params
  let collateralFinal
  const buy = getRandom(0,1)
  const position = getRandom(positionParams[0], positionParams[1])
  const leverage = getRandom(levergaeParams[0], levergaeParams[1])
  const collateral = Math.floor(position/leverage)
  const pairIndex = getRandom(0, pairs.length)

  if(collateral > usdtBalance){
    collateralFinal = getRandom(1, usdtBalance)
  } else {
    collateralFinal = collateral
  }

  const openPirce = await getOpenPrice(pairs[pairIndex])

  const openTradeData = [
    traderAddr, 
    pairIndex,
    0,
    0,
    BigInt(collateralFinal * 1e6),
    openPirce,
    buy,
    leverage,
    0,
    0]

  const openTradesCount = await getOpenTradesCount(traderAddr, pairIndex)

  // 有倉位就平一個
  if(openTradesCount > 0){
    const tradeInfos = await getOpenTradesByTrader(traderAddr)
    const t = getRandom(0, openTradesCount)
    await executeCloseTrade(i, tradeInfos[t].trade.pairIndex.toNumber(), tradeInfos[t].trade.index.toNumber())
    console.log(`${traderAddr} close ${pairs[pairIndex]}[${t}] position`)
  }

  // 再開一個倉位
  await executeOpenTrade(i, openTradeData)
  
  return true
}

// 在隨機間隔內觸發任務的函數
function scheduleRandomTask() {
  const randomInterval = getRandom(timeInterval[0], timeInterval[1])// 生成 1 到 5 秒的隨機間隔

  setTimeout(async() => {
    const timestamp = Date.now()
    const date = new Date(timestamp)
    console.log(date.toLocaleString())

    await randomTriggered()

    //await randomTriggered()
    scheduleRandomTask()// 重新安排下一次任務
  }, randomInterval * 1000)
}


async function main() {

  const network = await provider.getNetwork()
  console.log(network.name)

  scheduleRandomTask(); // 首次安排任務
}

main()
  .then(() => {
    readline.close();
  })
  .catch(error => {
    console.error(error);
    process.exit(1);
  });