const helps = require("./shared/helpers")
const {ethers, network} = require("hardhat");
const BigNumber = require("bignumber.js")
const { GetConfig } = require("../../config/getConfig")

let addrMap = helps.createAddrRecorder("./contract_address.json");

async function getOrDeployContract(key, contract, params, label, options) {
  return await helps.getOrDeployContractWithPath(addrMap, key, contract, params, label, options)
}

async function main() {

  const [deployer] = await ethers.getSigners();
  console.log("deployer is:", deployer.address, "network is:", network.name)

  // 將 contract_address.json 中的 pexTradingV1 地址粘貼到下方
  // 刪除 contract_address.json 中的 pexTradingV1 地址
  // 再開始部署新的 trading 合約同時更新相關配置

  // 將舊的 pexTradingV1 粘貼至此
  const pexTradingV1_old = await helps.contractAt("PEXTradingV1", "0x17f4B55A352Be71CC03856765Ad04147119Aa09B")

  // 獲取 storageT 合約
  const storageV1 = await helps.contractAt("PairexTradingStorageV1", addrMap.getAddr("PairexTradingStorageV1"))
  
  // 獲取 callback 合約
  const pexTradingCallbacksV1 = await helps.contractAt("PEXTradingCallbacksV1", addrMap.getAddr("PEXTradingCallbacksV1"))

  const pexNftRewardsV1 = await helps.contractAt("PEXNftRewardsV1", addrMap.getAddr("PEXNftRewardsV1"))

  const pexPairInfosV1 = await helps.contractAt("PEXPairInfosV1", addrMap.getAddr("PEXPairInfosV1"))

  // 暫停舊的 trading 合約以及 callback 合約
  await helps.sendTxn(pexTradingV1_old.done(), "pexTradingV1_new.done")
  await helps.sendTxn(pexTradingCallbacksV1.pause(), "pexTradingCallbacksV1.pause")

  // 部署新的 trading 合約
  const pexTradingV1_new = await getOrDeployContract("PEXTradingV1", "PEXTradingV1",
    [storageV1.address, pexNftRewardsV1.address, pexPairInfosV1.address, pexTradingCallbacksV1.address,
      BigInt(500000 * 1e6)/*maxPosUsdt*/,
      3/*limitOrdersTimelock*/, 3/*marketOrdersTimeout*/])

  // 配置相關參數
  await helps.sendTxn(pexTradingV1_new.pause(), "pexTradingV1_new.pause")
  await helps.sendTxn(storageV1.setTrading(pexTradingV1_new.address), "storageV1.setTrading")
  await helps.sendTxn(storageV1.addTradingContract(pexTradingV1_new.address), "storageV1.addTradingContract")
  await helps.sendTxn(storageV1.removeTradingContract(pexTradingV1_old.address), "storageV1.removeTradingContract")
  await helps.sendTxn(pexTradingV1_new.pause(), "pexTradingV1_new.pause")
  await helps.sendTxn(pexTradingCallbacksV1.pause(), "pexTradingCallbacksV1.pause")
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
