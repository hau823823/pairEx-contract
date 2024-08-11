const helps = require("./shared/helpers")
const {ethers, network} = require("hardhat");
const BigNumber = require("bignumber.js")
const { GetConfig } = require("../../config/getConfig")

const MAX_INT = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"

let addrMap = helps.createAddrRecorder("./contract_address.json");

async function getOrDeployContract(key, contract, params, label, options) {
  return await helps.getOrDeployContractWithPath(addrMap, key, contract, params, label, options)
}

async function main() {

  const [deployer] = await ethers.getSigners();
  console.log("deployer is:", deployer.address, "network is:", network.name)

  let config = GetConfig();
  //依赖的地址全部置顶
  const linkToken = config.address.link_token;
  const linkPriceFeed = config.address.link_price_feed;

  // 刪除 contract_address.json 中的 pexPriceAggregatorV1 地址
  // 再開始部署新的 pexPriceAggregatorV1 合約同時更新相關配置

  // 獲取 trading 合約
  const pexTradingV1 = await helps.contractAt("PEXTradingV1", addrMap.getAddr("PEXTradingV1"))

  // 獲取 storageT 合約
  const storageV1 = await helps.contractAt("PairexTradingStorageV1", addrMap.getAddr("PairexTradingStorageV1"))
  
  // 獲取 callback 合約
  const pexTradingCallbacksV1 = await helps.contractAt("PEXTradingCallbacksV1", addrMap.getAddr("PEXTradingCallbacksV1"))

  // 獲取 pexPairsStorageV1 合約
  const pexPairsStorageV1 = await helps.contractAt("PEXPairsStorageV1", addrMap.getAddr("PEXPairsStorageV1"))

  // 獲取 oracle 地址
  let oracleAddresses = []
  for (let i = 0; i < 2; i++) {
    const oracle_node = await helps.contractAt("Oracle", addrMap.getAddr("Oracle_node_" + i))
    oracleAddresses.push(oracle_node.address)
  }

  // 部署新的 aggregator 合約
  const pexPriceAggregatorV1 = await getOrDeployContract("PEXPriceAggregatorV1", "PEXPriceAggregatorV1",
    [linkToken, storageV1.address, pexPairsStorageV1.address, linkPriceFeed, 1/*minAnswers*/, oracleAddresses])
  
  // 配置相關參數
  await helps.sendTxn(pexTradingV1.pause(), "pexTradingV1.pause")
  await helps.sendTxn(pexTradingCallbacksV1.pause(), "pexTradingCallbacksV1.pause")

  await helps.sendTxn(storageV1.setPriceAggregator(pexPriceAggregatorV1.address), "storageV1.setTrading")

  await helps.sendTxn(pexTradingV1.pause(), "pexTradingV1.pause")
  await helps.sendTxn(pexTradingCallbacksV1.pause(), "pexTradingCallbacksV1.pause")

  // 轉 link 到新的 aggregator
  const link = await helps.contractAt("TestToken", linkToken)
  await helps.sendTxn(link.approve(storageV1.address, MAX_INT), "link.approve.storageT")
  await helps.sendTxn(link.transfer(pexPriceAggregatorV1.address, BigInt(0.1 * 1e18)), "deployer link.transfer.pexPriceAggregatorV1")
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
