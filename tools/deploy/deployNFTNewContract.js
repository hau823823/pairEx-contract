const helps = require("./shared/helpers")
const {ethers, network} = require("hardhat")
const { GetConfig } = require("../../config/getConfig")

const MAX_INT = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"

let addrMap = helps.createAddrRecorder("./contract_address.json")
let actionHandler = helps.createSettingRecorder("./nft_actions.json")

async function getOrDeployContract(key, contract, params, label, options) {
  return await helps.getOrDeployContractWithPath(addrMap, key, contract, params, label, options)
}

async function getOrDeployTransparentProxyContractWithPath(key, contract, params, label, options) {
  return await helps.getOrDeployTransparentProxyContractWithPath(addrMap, key, contract, params, label, options)
}

async function sendAction(func, params, label) {
  return await helps.sendActionWithPath(actionHandler, func, params, label)
}


async function main() {

  const [deployer] = await ethers.getSigners();
  console.log("deployer is:", deployer.address, "network is:", network.name)

  let config = GetConfig()
  const usdtArbOneAddr = config.address.usdt_arbOne_address

  let usdt
  if ( network.name === helps.ARBI_GOERLI_NETWORK) {
    usdt = await helps.contractAt("TestToken", addrMap.getAddr("USDT"))
  } else {
    usdt = await helps.contractAt("TestToken", usdtArbOneAddr)
  }

  // 獲取 storageT 合約
  const storageV1 = await helps.contractAt("PairexTradingStorageV1", addrMap.getAddr("PairexTradingStorageV1"))
  
  // 獲取 callback 合約
  const pexTradingCallbacksV1 = await helps.contractAt("PEXTradingCallbacksV1", addrMap.getAddr("PEXTradingCallbacksV1"))

  // 獲取 PEXNftRewardsV1 合約
  const pexNftRewardsV1 = await helps.contractAt("PEXNftRewardsV1", addrMap.getAddr("PEXNftRewardsV1"))

  // 獲取 pexPairInfosV1 合約
  const pexPairInfosV1 = await helps.contractAt("PEXPairInfosV1", addrMap.getAddr("PEXPairInfosV1"))

  // 部署新合約
  // 1. 部署新的 trading 合約，需要將 contract_address.json 中舊的 trading 合約刪除
  const pexTradingV1 = await getOrDeployContract("PEXTradingV1", "PEXTradingV1",
    [storageV1.address, pexNftRewardsV1.address, pexPairInfosV1.address, pexTradingCallbacksV1.address,
      BigInt(500000 * 1e6)/*maxPosUsdt*/,
      3/*limitOrdersTimelock*/, 3/*marketOrdersTimeout*/])

  // 暫時暫停新的 trading 合約，等全部合約升級配置完成後再開啟
  await sendAction(pexTradingV1.pause, [], "pexTradingV1_new.pause")

  // 2. 部署新的 PEXTradeRegisterV1_1 合約
  await getOrDeployTransparentProxyContractWithPath("PEXTradeRegisterV1_1", "PEXTradeRegisterV1_1",
    [storageV1.address, pexPairInfosV1.address, pexNftRewardsV1.address, pexTradingCallbacksV1.address])

  // 3. 部署新的 nft 合約
  const monthPassNft = await getOrDeployContract("PairExPassNftV1_1", "PairExPassNftV1_1", [usdt.address, storageV1.address])

  // 配置新合約參數
  // nft 相關
  // 1.1 設置 month timestamps
  await sendAction(monthPassNft.setMonthTimeStampsArray, [
    [2305,2306,2307,2308,2309,2310,2311,2312,2401,2402,2403,2404,2405,2406,2407,2408,2409,2410,2411,2412,2501,2502,2503,2504],
    [1682899200,1685577600,1688169600,1690848000,1693526400,1696118400,1698796800,1701388800,1704067200,1706745600,1709251200,1711929600,1714521600,1717200000,1719792000,1722470400,1725148800,1727740800,1730419200,1733011200,1735689600,1738368000,1740787200,1743465600]
  ], "nft.setTimestampsArray")

  // 1.2 設置 nft 價格
  await sendAction(monthPassNft.setMonthPricesArray, [
    [2305,2306,2307,2308,2309,2310,2311,2312,2401,2402,2403,2404,2405,2406,2407,2408,2409,2410,2411,2412,2501,2502,2503,2504],
    [400000000,400000000,400000000,400000000,400000000,400000000,400000000,400000000,400000000,400000000,400000000,400000000,400000000,400000000,400000000,400000000,400000000,400000000,400000000,400000000,400000000,400000000,400000000,400000000]
  ], "nft.setMonthPricesArray")

  // 1.3 設置 nft 每月最大供應量
  await sendAction(monthPassNft.setMonthAmountsArrary, [
    [2305,2306,2307,2308,2309,2310,2311,2312,2401,2402,2403,2404,2405,2406,2407,2408,2409,2410,2411,2412,2501,2502,2503,2504],
    [2000,2000,2000,2000,2000,2000,2000,2000,2000,2000,2000,2000,2000,2000,2000,2000,2000,2000,2000,2000,2000,2000,2000,2000]
  ], "nft.setMonthAmountsArrary")

  // 1.4 設置 nft uri
  await sendAction(monthPassNft.setURI, ["https://pairex.io//nftMonthlyPass/metadata/"], "nft.setURI")

}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
