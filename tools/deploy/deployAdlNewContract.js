const helps = require("./shared/helpers")
const {ethers, network} = require("hardhat");
const BigNumber = require("bignumber.js")
const { GetConfig } = require("../../config/getConfig")

const MAX_INT = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"

let addrMap = helps.createAddrRecorder("./contract_address.json");

async function getOrDeployContract(key, contract, params, label, options) {
  return await helps.getOrDeployContractWithPath(addrMap, key, contract, params, label, options)
}

async function getOrDeployTransparentProxyContractWithPath(key, contract, params, label, options) {
  return await helps.getOrDeployTransparentProxyContractWithPath(addrMap, key, contract, params, label, options)
}

async function main() {

  const [deployer] = await ethers.getSigners();
  console.log("deployer is:", deployer.address, "network is:", network.name)

  let config = GetConfig();
  //依赖的地址全部置顶
  const linkToken = config.address.link_token;
  const linkPriceFeed = config.address.link_price_feed;
  const oracleServerAddr = config.address.oracle_server_addr; 

  // 刪除 contract_address.json 中的 pexPriceAggregatorV1 地址 和 兩個 oracle 地址

  // 獲取 storageT 合約
  const storageV1 = await helps.contractAt("PairexTradingStorageV1", addrMap.getAddr("PairexTradingStorageV1"))
  
  // 獲取 callback 合約
  const pexTradingCallbacksV1 = await helps.contractAt("PEXTradingCallbacksV1", addrMap.getAddr("PEXTradingCallbacksV1"))

  // 獲取 pexPairsStorageV1 合約
  const pexPairsStorageV1 = await helps.contractAt("PEXPairsStorageV1", addrMap.getAddr("PEXPairsStorageV1"))

  // 獲取 pexPairInfosV1 合約
  const pexPairInfosV1 = await helps.contractAt("PEXPairInfosV1", addrMap.getAddr("PEXPairInfosV1"))

  // 部署新合約
  // 1. 部署 oracles 地址
  let oracles = [], oracleAddresses = []
  for (let i = 0; i < 2; i++) {
    const oracle_node = await getOrDeployContract("Oracle_node_" + i, "Oracle", [linkToken])
    await helps.sendTxn(oracle_node.setFulfillmentPermission(oracleServerAddr[i], 1), "oracle_node.setFullfillmentPermission." + i)

    oracles.push(oracle_node)
    oracleAddresses.push(oracle_node.address)
  }

  // 2. 部署新的 aggregator 合約
  await getOrDeployContract("PEXPriceAggregatorV1", "PEXPriceAggregatorV1",
    [linkToken, storageV1.address, pexPairsStorageV1.address, linkPriceFeed, 1/*minAnswers*/, oracleAddresses])

  // 3. 部署 adlclosing 合約
  await getOrDeployTransparentProxyContractWithPath("PEXAdlClosingV1_1", "PEXAdlClosingV1_1", [storageV1.address])

  // 4. 部署 adlcallback 合約
  await getOrDeployTransparentProxyContractWithPath("PEXAdlCallbacksV1_1", "PEXAdlCallbacksV1_1", 
    [storageV1.address, pexPairInfosV1.address, pexTradingCallbacksV1.address])

}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
