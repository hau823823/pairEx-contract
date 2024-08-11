const helps = require("./shared/helpers")
const {ethers, network} = require("hardhat")
const { GetConfig } = require("../../config/getConfig")

const MAX_INT = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"

let addrMap = helps.createAddrRecorder("./contract_address.json")
let actionHandler = helps.createSettingRecorder("./nft_actions.json")

async function upgradeTransparentProxyContractWithPath(proxyKey, contractName) {
  return await helps.upgradeTransparentProxyContractWithPath(addrMap,proxyKey, contractName)
}

async function sendAction(func, params, label) {
  return await helps.sendActionWithPath(actionHandler, func, params, label)
}

async function main() {

  const [deployer] = await ethers.getSigners();
  console.log("deployer is:", deployer.address, "network is:", network.name)

  let config = GetConfig();

  // 獲取舊的 trading 合約
  let tradingAddr_old 
  if( network.name === helps.ARBI_ONE_NETWORK) {
    tradingAddr_old = "0x9d55e9e08B02aB9e68D9c549e028858CFFD031E4"
  } else if (network.name === helps.ARBI_GOERLI_NETWORK) {
    tradingAddr_old = "0x88B1B7CFe7Ffd1BfFaAa5C0Cba669Dccac91786a"
  }

  // 獲取舊的 trading 合約
  const pexTradingV1_old = await helps.contractAt("PEXTradingV1", tradingAddr_old)
  
  // 獲取新的 trading 合約
  const pexTradingV1_new = await helps.contractAt("PEXTradingV1", addrMap.getAddr("PEXTradingV1"))

  // 獲取 storageT 合約
  const storageV1 = await helps.contractAt("PairexTradingStorageV1", addrMap.getAddr("PairexTradingStorageV1"))
  
  // 獲取 callback 合約
  const pexTradingCallbacksV1 = await helps.contractAt("PEXTradingCallbacksV1", addrMap.getAddr("PEXTradingCallbacksV1"))

  // 獲取 tradeRegister 合約
  const pexTradeRegisterV1_1 = await helps.contractAt("PEXTradeRegisterV1_1", addrMap.getAddr("PEXTradeRegisterV1_1"))

  // 獲取 MonthPassNft 合約
  const monthPassNft = await helps.contractAt("PairExPassNftV1_1", addrMap.getAddr("PairExPassNftV1_1"))

  // 暫停相關合約
  await sendAction(pexTradingV1_old.done, [], "pexTradingV1_old.done")
  await sendAction(pexTradingCallbacksV1.pause, [], "pexTradingCallbacksV1.pause")

  // 升級相關合約
  // 1. 升級 trading callback 合約
  await upgradeTransparentProxyContractWithPath("PEXTradingCallbacksV1","PEXTradingCallbacksV1")

  // 2. 升級 trading storage 合約
  await upgradeTransparentProxyContractWithPath("PairexTradingStorageV1", "PairexTradingStorageV1")

  // 3. 升級 pairsStorage 合約
  await upgradeTransparentProxyContractWithPath("PEXPairsStorageV1", "PEXPairsStorageV1")

  // 4. 升級 pairInfos 合約
  await upgradeTransparentProxyContractWithPath("PEXPairInfosV1", "PEXPairInfosV1")

  // 5. 升級 nftreward 合約
  await upgradeTransparentProxyContractWithPath("PEXNftRewardsV1", "PEXNftRewardsV1")

  // 6. 升級 adlcallback 合約
  await upgradeTransparentProxyContractWithPath("PEXAdlCallbacksV1_1", "PEXAdlCallbacksV1_1")

  // 7. 升級 referral 合約
  await upgradeTransparentProxyContractWithPath("PEXReferralStorageV1_1", "PEXReferralStorageV1_1")
  
  // 配置相關參數
  // 1. storageT 合約相關參數配置
  await sendAction(storageV1.setTradeRegister, [pexTradeRegisterV1_1.address], "storageV1.setTradeRegister")
  await sendAction(storageV1.setMonthPassNft, [monthPassNft.address], "storageV1.setMonthPassNft")
  await sendAction(storageV1.setTrading, [pexTradingV1_new.address], "storageV1.setTrading.pexTradingV1_new")
  await sendAction(storageV1.addTradingContract, [pexTradingV1_new.address], "storageV1.addTradingContract.pexTradingV1_new")
  await sendAction(storageV1.addTradingContract, [monthPassNft.address], "storageV1.addTradingContract.monthPassNft")
  await sendAction(storageV1.removeTradingContract, [pexTradingV1_old.address], "storageV1.removeTradingContract.pexTradingV1_old")
  await sendAction(storageV1.addTradingContract, [pexTradeRegisterV1_1.address], "storageV1.addTradingContract.pexTradeRegisterV1_1")

  // 2. callback 合約配置費率相關參數
  await sendAction(pexTradingCallbacksV1.setExecutionFee, [500000], "pexTradingCallbacksV1.setExecutionFee")
  await sendAction(pexTradingCallbacksV1.setNftPassSaveFeeP, [BigInt(100 * 1e10)], "pexTradingCallbacksV1.setNftPassSaveFeeP")

  // 重新打開合約
  await sendAction(pexTradingV1_new.pause, [], "pexTradingV1_new.open")
  await sendAction(pexTradingCallbacksV1.pause, [], "pexTradingCallbacksV1.open")

}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
