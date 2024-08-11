const { ethers } = require('ethers')
const axios = require('axios')
const BigNumber = require("bignumber.js")
const { GetConfig } = require('./config/getConfig')
const cron = require('node-cron')

// abi 
const usdt_abi = require('./abi/Usdt.json')
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

function sleep(time) {
  return new Promise(resolve => setTimeout(resolve, time))
}

function getTimeStamp(){
  const timestamp = Date.now()
  const date = new Date(timestamp)

  return date.toLocaleString()
}

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
    return await pexTradingV1.openTrade( tradeInfo, 0, 10e10, {
      gasLimit: 10000000,
      maxFeePerGas: 135000000,
      maxPriorityFeePerGas: 55000000
    })
  } catch (error) {
    console.log(error)
    return error
  }
}

async function executeCloseTrade(i, pairIndex, index){
  const wallet = new ethers.Wallet(traders[i], provider)
  const pexTradingV1 = new ethers.Contract(pexTrading_addr, pexTrading_abi, wallet)

  try {
    return await pexTradingV1.closeTradeMarket(pairIndex, index, {
      gasLimit: 10000000,
      maxFeePerGas: 135000000,
      maxPriorityFeePerGas: 55000000
    })
  } catch (error) {
    console.log(error)
    return error
  }
}

async function randomTriggered(){

  const tp = getTimeStamp()

  // random trader index
  const i = getRandom(0, traders.length)
  const wallet = new ethers.Wallet(traders[i], provider)
  const traderAddr = wallet.address

  // trader addr usdt balance
  const usdtBalance = await getUsdtBalance(traderAddr)
  if(usdtBalance < 1){
    console.log(`[${tp}] Address:${traderAddr} Usdt not enough`)
    return false
  }


  // random params
  let collateralFinal
  let leverageFinal
  const buy = getRandom(0,1)
  const position = getRandom(positionParams[0], positionParams[1])
  const leverage = getRandom(levergaeParams[0], levergaeParams[1])
  const collateral = Math.floor(position/leverage)
  const pairIndex = getRandom(0, pairs.length)

  if(collateral > usdtBalance){
    collateralFinal = getRandom(1, usdtBalance)
    leverageFinal = Math.ceil(500 / collateralFinal)
  } else {
    collateralFinal = collateral
    leverageFinal = leverage
  }

  if (leverageFinal > levergaeParams[1] || leverageFinal < levergaeParams[0]){
    console.log(`[${tp}] Unable to generate suitable conditions`)
    return false
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
    leverageFinal,
    0,
    0]

  const openTradesCount = await getOpenTradesCount(traderAddr, pairIndex)

  // 有倉位就平一個
  if(openTradesCount > 0){
    const tradeInfos = await getOpenTradesByTrader(traderAddr)
    const t = getRandom(0, openTradesCount)
    tx = await executeCloseTrade(i, tradeInfos[t].trade.pairIndex.toNumber(), tradeInfos[t].trade.index.toNumber())
    console.log(`[${tp}] Hash:${tx.hash}, Address:${traderAddr} close ${pairs[pairIndex]}[${t}] position`)
  }

  // 再開一個倉位
  await sleep(60000)
  tx = await executeOpenTrade(i, openTradeData)
  console.log(`[${tp}] Hash:${tx.hash}, Address:${traderAddr} open ${pairs[pairIndex]} position`)
  
  return true
}

// 在隨機間隔內觸發任務的函數
function scheduleRandomTask() {
  const randomInterval = getRandom(timeInterval[0], timeInterval[1])// 生成 1 到 5 秒的隨機間隔

  setTimeout(async() => {
    const tp = getTimeStamp()
    console.log(`[${tp}] random triggered`)

    await randomTriggered()

    //await randomTriggered()
    scheduleRandomTask()// 重新安排下一次任務
  }, randomInterval * 1000)
}


async function main() {
  const tp = getTimeStamp()
  const network = await provider.getNetwork()
  console.log(`[${tp}] Start run traders bot at ${network.name}`)

  scheduleRandomTask(); // 首次安排任務
}

main()
  .catch(error => {
    console.error(error);
    process.exit(1);
  });