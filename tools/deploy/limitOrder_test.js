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

let addrMap = helps.createAddrRecorder("./addrList.json");

async function main() {
  const MAX_INT = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"

  const [trader] = await ethers.getSigners();
  console.log("trader is:", trader.address)

  // get usdt
  const usdt = await contractAt("TestToken", addrMap.getAddr("USDT"))
  console.log("USDT.address is:", usdt.address)
  await sendTxn(usdt.mint(trader.address, BigInt(1e8 * 1e6)), "mint usdt to deployer")

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

  const pexTradingV1 = await contractAt("PEXTradingV1",  addrMap.getAddr("PEXTradingV1"))
  console.log("pexTradingV1.address is:", pexTradingV1.address)

  // 監聽
  listenOraclesOracleRequestEvent(oracles)
  listenLimitExecuted(callbacks)
  listenOpenLimitPlaced(pexTradingV1)
  listenNftOrderInitiated(pexTradingV1)

  // open trade
  await sendTxn(pexTradingV1.openTrade(
    [
      trader.address,
      1, // pairIndex(BTC 0, ETH 1)
      0, // index
      0, // initialPosUSDT (1e18)
      expandDecimals(500, 6), // positionSizeUsdt (1e18)
      openPriceExpand + BigInt(10 * 1e10), // openPrice
      1, // buy
      10, // leverage
      0, // tp
      0 // sl
    ],
    1, // orderType
    expandDecimals(5, 10), // slippageP, for market orders only
  ), "pexTradingV1.openTrade")
  await helps.sleep(1000 * 10)

  //await getPendingLimitOrder(storageT, trader.address)
  await doNftBotExecute(pexTradingV1, trader.address)
  await helps.sleep(1000 * 20)

  // 執行喂價
  for(let i = 0; i < 2; i++) {
    let fulfill =  await helps.sendTxn(oracles[i].fulfillOracleRequest(
      requestIds[i], payments[i], aggregator.address, callbackFunctionIds[i], cancelExpirations[i], [openPriceExpand]
    ), "oracle"+ i + ".fulfillOracleRequest")
    if(fulfill) {
      console.log("oracle fulfill request success")
    }
  }
  await helps.sleep(1000 * 10)
  
  const allTrades = await storageT.openTradesCount(trader.address, 1)
  console.log("openTrades count: ", allTrades)
}

// get openPrice
let openPrice, openPriceExpand
const url = "https://min-api.cryptocompare.com/data/price?fsym=ETH&tsyms=USD";
const getOpenPrice = async url => {
  try {
    const response = await axios.get(url);
    openPrice = new BigNumber(JSON.parse(JSON.stringify(response.data)).USD)
    openPriceExpand = BigInt(openPrice.times(Math.pow(10, 10)))
  } catch (error) {
    console.log(error);
  }
}

async function doNftBotExecute(pexTradingV1, traderAddr) {
    await helps.sendTxn(pexTradingV1.executeNftOrder(
      3/*orderType LimitOrder (TP, SL, LIQ, OPEN) */, traderAddr, 1/*pair index*/, 6/*index*/, 1/*nftId*/
    ), "pexTradingV1.executeNftOrder")
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

function listenLimitExecuted(callbacks) {
    callbacks.on("LimitExecuted", (orderId, index, finalTrade, nftHolder, LimitOrder, openPrice, priceImpactP, initialPosUSDT, tp, sl)=> {
      console.log(`LimitExecuted: orderId ${orderId}, index ${index}, nftHolder ${nftHolder}, LimitOrder ${LimitOrder}, openPrice ${openPrice}, priceImpactP ${priceImpactP}, initialPosUSDT ${initialPosUSDT}`)
    })
  }
  
  // 限價單委託成功監聽
  function listenOpenLimitPlaced(pexTradingV1) {
    pexTradingV1.on("OpenLimitPlaced", (sender, pairIndex, index)=> {
      console.log(`OpenLimitPlaced: sender ${sender}, pairIndex ${pairIndex}, index ${index}`)
    })
  }
  
  // 限價單觸發為價成功監聽
  function listenNftOrderInitiated(pexTradingV1) {
    pexTradingV1.on("NftOrderInitiated", (orderId, sender, trader, pairIndex)=> {
      console.log(`NftOrderInitiated: orderId ${orderId}, sender ${sender}, trader ${trader}, pairIndex ${pairIndex}`)
    })
  }

  async function getPendingLimitOrder(storageV1, traderAddr){
    let ids = await storageV1.getPendingOrderIds(traderAddr)
    console.log("storageV1.pendingOrderIds(deployer.address):", ids)
    for (let i = 0; i < ids.length; i++) {
      let order = await storageV1.reqID_pendingMarketOrder(ids[i])
      console.log("order", ids[i], "info:", order)
    }
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