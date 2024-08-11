const helps = require("./shared/helpers")
const {ethers, network} = require("hardhat");
const BigNumber = require("bignumber.js")
const { GetConfig } = require("../../config/getConfig")

const MAX_INT = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"

let addrMap = helps.createAddrRecorder("./contract_address.json");

async function upgradeTransparentProxyContractWithPath(proxyKey, contractName) {
  return await helps.upgradeTransparentProxyContractWithPath(addrMap,proxyKey, contractName)
}

async function main() {

  const [deployer] = await ethers.getSigners();
  console.log("deployer is:", deployer.address, "network is:", network.name)

  let config = GetConfig();
  //依赖的地址全部置顶
  const linkToken = config.address.link_token;
  const linkPriceFeed = config.address.link_price_feed;
  const oracleServerAddr = config.address.oracle_server_addr;
  
  // 獲取 trading 合約
  const pexTradingV1 = await helps.contractAt("PEXTradingV1", addrMap.getAddr("PEXTradingV1"))

  // 獲取 storageT 合約
  const storageV1 = await helps.contractAt("PairexTradingStorageV1", addrMap.getAddr("PairexTradingStorageV1"))
  
  // 獲取 callback 合約
  const pexTradingCallbacksV1 = await helps.contractAt("PEXTradingCallbacksV1", addrMap.getAddr("PEXTradingCallbacksV1"))

  // 獲取 aggregator 合約
  const pexPriceAggregatorV1 = await helps.contractAt("PEXPriceAggregatorV1", addrMap.getAddr("PEXPriceAggregatorV1"))

  // 獲取  adlclosing 合約
  const adlClosingV1_1 = await helps.contractAt("PEXAdlClosingV1_1", addrMap.getAddr("PEXAdlClosingV1_1"))

  // 獲取 adlcallback 合約
  const adlCallbacksV1_1 = await helps.contractAt("PEXAdlCallbacksV1_1", addrMap.getAddr("PEXAdlCallbacksV1_1"))

  // 暫停相關合約
  await helps.sendTxn(pexTradingV1.pause(), "pexTradingV1.pause")
  await helps.sendTxn(pexTradingCallbacksV1.pause(), "pexTradingCallbacksV1.pause")

  // 升級相關合約
  // 1. 升級 trading callback 合約
  await upgradeTransparentProxyContractWithPath("PEXTradingCallbacksV1","PEXTradingCallbacksV1")

  // 2. 升級 trading storage 合約
  await upgradeTransparentProxyContractWithPath("PairexTradingStorageV1", "PairexTradingStorageV1")

  // 3. 升級 pairsStorage 合約
  await upgradeTransparentProxyContractWithPath("PEXPairsStorageV1", "PEXPairsStorageV1")

  // 4. 升級 pairInfos 合約
  await upgradeTransparentProxyContractWithPath("PEXPairInfosV1", "PEXPairInfosV1")
  
  // 配置相關參數
  //await helps.sendTxn(storageV1.setPriceAggregator(pexPriceAggregatorV1.address), "storageV1.setPriceAggregator")
  await helps.sendTxn(storageV1.setAdlClosing(adlClosingV1_1.address), "storageT.setAdlClosing")
  await helps.sendTxn(storageV1.setAdlCallbacks(adlCallbacksV1_1.address), "storageV1.setAdlCallbacks")
  await helps.sendTxn(storageV1.addTradingContract(adlClosingV1_1.address), "storageV1.addTradingContract.adlClosing")
  await helps.sendTxn(storageV1.addTradingContract(adlCallbacksV1_1.address), "storageV1.addTradingContract.adlCallbacks")
  await helps.sendTxn(storageV1.addTradingContract(pexPriceAggregatorV1.address), "storageV1.addTradingContract.priceAggregator")

  await helps.sendTxn(pexTradingV1.pause(), "pexTradingV1.pause")
  await helps.sendTxn(pexTradingCallbacksV1.pause(), "pexTradingCallbacksV1.pause")

  // 更新聚合合約，有問題的話需要立即手動切回舊的聚合合約
  await helps.sendTxn(storageV1.setPriceAggregator(pexPriceAggregatorV1.address), "storageT.setPriceAggregator")

}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
