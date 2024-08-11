const helps = require("./shared/helpers")
const { ethers, network } = require("hardhat");

const MAX_INT = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"

let addrMap = helps.createAddrRecorder("./contract_address.json");
let actionHandler = helps.createSettingRecorder("./contract_actions.json");

async function upgradeTransparentProxyContractWithPath(proxyKey, contractName) {
  return await helps.upgradeTransparentProxyContractWithPath(addrMap, proxyKey, contractName)
}

async function main() {

  const [deployer] = await ethers.getSigners();
  console.log("deployer is:", deployer.address, "network is:", network.name)

  // 獲取 trading 合約
  const pexTradingV1 = await helps.contractAt("PEXTradingV1", addrMap.getAddr("PEXTradingV1"))

  // 獲取 storageT 合約
  const storageV1 = await helps.contractAt("PairexTradingStorageV1", addrMap.getAddr("PairexTradingStorageV1"))

  // 獲取 callback 合約
  const pexTradingCallbacksV1 = await helps.contractAt("PEXTradingCallbacksV1", addrMap.getAddr("PEXTradingCallbacksV1"))

  // 獲取  adlclosing 合約
  const adlClosingV1_1 = await helps.contractAt("PEXAdlClosingV1_1", addrMap.getAddr("PEXAdlClosingV1_1"))

  // 獲取 adlcallback 合約
  const adlCallbacksV1_1 = await helps.contractAt("PEXAdlCallbacksV1_1", addrMap.getAddr("PEXAdlCallbacksV1_1"))

  // 獲取 referralStorage 合約
  const referralV1_1 = await helps.contractAt("PEXReferralStorageV1_1", addrMap.getAddr("PEXReferralStorageV1_1"))

  // 暫停相關合約
  await helps.sendActionWithPath(actionHandler, pexTradingV1.pause, [], "pexTradingV1.pause.1")
  await helps.sendActionWithPath(actionHandler, pexTradingCallbacksV1.pause, [], "pexTradingCallbacksV1.pause.1")
  await helps.sendActionWithPath(actionHandler, adlClosingV1_1.paused, [], "adlClosingV1_1.paused.1")
  await helps.sendActionWithPath(actionHandler, adlCallbacksV1_1.paused, [], "adlCallbacksV1_1.paused.1")

  // await helps.sendTxn(pexTradingV1.pause(), "pexTradingV1.pause")
  // await helps.sendTxn(pexTradingCallbacksV1.pause(), "pexTradingCallbacksV1.pause")
  // await helps.sendTxn(adlClosingV1_1.pause(), "adlClosingV1_1.pause")
  // await helps.sendTxn(adlCallbacksV1_1.pause(), "adlCallbacksV1_1.pause")

  // 升級相關合約
  // 1. 升級 trading callback 合約
  await upgradeTransparentProxyContractWithPath("PEXTradingCallbacksV1", "PEXTradingCallbacksV1")
  await helps.sendActionWithPath(actionHandler, pexTradingCallbacksV1.setReferralStorage, [referralV1_1.address], "callback.setReferralStorage")

  // 2. 升級 adl callback 合約
  await upgradeTransparentProxyContractWithPath("PEXAdlCallbacksV1_1", "PEXAdlCallbacksV1_1")


  // 配置相關參數
  await helps.sendActionWithPath(actionHandler, storageV1.addTradingContract, [referralV1_1.address], "storageV1.addTradingContract.referralV1_1")

  await helps.sendActionWithPath(actionHandler, pexTradingV1.pause, [], "pexTradingV1.pause.2")
  await helps.sendActionWithPath(actionHandler, pexTradingCallbacksV1.pause, [], "pexTradingCallbacksV1.pause.2")
  await helps.sendActionWithPath(actionHandler, adlClosingV1_1.paused, [], "adlClosingV1_1.paused.2")
  await helps.sendActionWithPath(actionHandler, adlCallbacksV1_1.paused, [], "adlCallbacksV1_1.paused.2")

  // await helps.sendTxn(pexTradingV1.pause(), "pexTradingV1.pause")
  // await helps.sendTxn(pexTradingCallbacksV1.pause(), "pexTradingCallbacksV1.pause")
  // await helps.sendTxn(adlClosingV1_1.pause(), "adlClosingV1_1.pause")
  // await helps.sendTxn(adlCallbacksV1_1.pause(), "adlCallbacksV1_1.pause")

}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
