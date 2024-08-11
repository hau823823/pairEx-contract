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
  const [tester] = await ethers.getSigners();
  console.log("tester is:", tester.address)

  const storageT = await contractAt("PairexTradingStorageV1", addrMap.getAddr("PairexTradingStorageV1"))
  console.log("storageT.address is:", storageT.address)

  // 暫時加入 tester 地址方邊測試
  /*
  await sendTxn(storageT.addTradingContract(tester.address))

  await sendTxn(storageT.storeTrade(
    [tester.address, 1, 0, BigInt(984*1e15), BigInt(984*1e5), BigInt(237819*1e9), 0, 20, BigInt(34481*1e10), 0],
    [0,BigInt(1968000000),0,0,0,0]
  ))
  */

  const allTradesNum0 = await storageT.openTradesCount(tester.address, 0)
  const allTradesNum1 = await storageT.openTradesCount(tester.address, 1)
  console.log(allTradesNum0)
  console.log(allTradesNum1)

  const allTrades = await storageT.getAllOpenTradesByTrader(tester.address)
  console.log(allTrades)

  //const trades = await storageT.openTrades(tester.address, 0, 0)
  //console.log(trades)
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