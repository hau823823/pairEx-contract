const helps = require("./shared/helpers")

const {contractAt, sendTxn, callWithRetries} = require("./shared/helpers")
const {expandDecimals} = require("./shared/utilities")
const fs = require('fs')
const process = require('process')
const axios = require("axios")
const BigNumber = require("bignumber.js")
const exp = require("constants")
const readline = require('readline').createInterface({
  input: process.stdin,
  output: process.stdout
});

let addrMap = helps.createAddrRecorder("./contract_address.json");

async function main() {
  const MAX_INT = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"

  const [trader] = await ethers.getSigners();
  console.log("trader is:", trader.address)

  // get usdt
  const usdt = await contractAt("TestToken", addrMap.getAddr("USDT"))
  console.log("USDT.address is:", usdt.address)
  //await sendTxn(usdt.mint(trader.address, BigInt(1e8 * 1e6)), "mint usdt to deployer")

  // approve
  const storageT = await contractAt("PairexTradingStorageV1", addrMap.getAddr("PairexTradingStorageV1"))
  console.log("storageT.address is:", storageT.address)
  await sendTxn(usdt.approve(storageT.address, MAX_INT), "usdt.approve.storageT")

  await getOpenPrice(url)

  // 監聽事件並執行
  let oracles = []
  for (let i = 0; i < 2; i++) {
    const oracle_node = await contractAt("Oracle", addrMap.getAddr("Oracle_node_" + i))
    oracles.push(oracle_node)
  }

  const callbacks = await contractAt("PEXTradingCallbacksV1", addrMap.getAddr("PEXTradingCallbacksV1")) 
  console.log("callbacks.address is:", callbacks.address)

  const aggregator = await contractAt("PEXPriceAggregatorV1", addrMap.getAddr("PEXPriceAggregatorV1"))
  console.log("aggregator.address is:", aggregator.address)

  //listenOraclesOracleRequestEvent(oracles)
  //listenCallbacksMarketOpenCanceled(callbacks)
  //listenCallbacksMarketExecuted(callbacks)
  //listenCallbacksMarketCloseCanceled(callbacks)

  // open trade
  const pexTradingV1 = await contractAt("PEXTradingV1",  addrMap.getAddr("PEXTradingV1"))
  console.log("pexTradingV1.address is:", pexTradingV1.address)

  
  await sendTxn(pexTradingV1.openTrade(
    [
      trader.address,
      0, // pairIndex(BTC 0, ETH 1)
      0, // index
      0, // initialPosUSDT (1e18)
      expandDecimals(50, 6), // positionSizeUsdt (1e18)
      openPriceExpand, // openPrice
      1, // buy
      10, // leverage
      0, // tp
      0 // sl
    ],
    0, // orderType
    expandDecimals(10, 10), // slippageP, for market orders only
    2305
  ), "pexTradingV1.openTrade")



  // close market trade
  //await sendTxn(pexTradingV1.closeTradeMarket(1,0), "pexTradingV1.closeTrade")
  //await helps.sleep(1000 * 20)

  // 執行喂價
  /*
  for(let i = 0; i < 2; i++) {
    let fulfill =  await helps.sendTxn(oracles[i].fulfillOracleRequest(
      requestIds[i], payments[i], aggregator.address, callbackFunctionIds[i], cancelExpirations[i], [openPriceExpand]
    ), "oracle"+ i + ".fulfillOracleRequest")
    if(fulfill) {
      console.log("oracle fulfill request success")
    }
  }
  await helps.sleep(1000 * 10)
  */
}

// get openPrice
let openPrice, openPriceExpand
const url = "https://min-api.cryptocompare.com/data/price?fsym=BTC&tsyms=USD";
const getOpenPrice = async url => {
  try {
    const response = await axios.get(url);
    openPrice = new BigNumber(JSON.parse(JSON.stringify(response.data)).USD)
    openPriceExpand = BigInt(openPrice.times(Math.pow(10, 10)))
  } catch (error) {
    console.log(error);
  }
}

let requestIds = [], payments = [], callbackFunctionIds = [], cancelExpirations = []
function listenOraclesOracleRequestEvent(oracles) {
  for (let i = 0; i < oracles.length; i++) {
    oracles[i].on("OracleRequest",
      async (specId, requester, requestId, payment, callbackAddr, callbackFunctionId, cancelExpiration, dataVersion, data, event) => {
        console.log(`oracle[${i}] EVENT: requestId ${requestId} callbackAddr ${callbackAddr} callbackFunctionId ${callbackFunctionId}`);
        console.log(`oracle[${i}] EVENT txHash`, event.transactionHash);
        requestIds.push(requestId)
        payments.push(payment)
        callbackFunctionIds.push(callbackFunctionId)
        cancelExpirations.push(cancelExpiration)
      });
  }
}

function listenCallbacksMarketOpenCanceled(callbacks) {
  callbacks.on("MarketOpenCanceled", (orderId, trader, pairIndex)=> {
    console.log(`MarketOpenCanceled: orderId ${orderId}, trader ${trader}, pairIndex ${pairIndex}`)
  })
}

function listenCallbacksMarketExecuted(callbacks) {
  callbacks.on("MarketExecuted", (orderId, trade, open, price, priceImpactP, positionSizeUsdt, percentProfit, usdtSentToTrader)=> {
    console.log(`MarketExecuted: orderId ${orderId}, trade ${trade}, open ${open}, price ${price}, priceImpactP ${priceImpactP}, positionSizeUsdt ${positionSizeUsdt}`)
  })
}

function listenCallbacksMarketCloseCanceled(callbacks) {
  callbacks.on("MarketCloseCanceled", (orderId, trader, pairIndex, index)=> {
    console.log(`MarketCloseCanceled: orderId ${orderId}, trader ${trader}, pairIndex ${pairIndex}, index ${index}`)
  })
}

main()
  .then(() => {
    readline.close();
    process.exit(0)
  })
  .catch(error => {
    console.error(error);
    process.exit(1);
  });