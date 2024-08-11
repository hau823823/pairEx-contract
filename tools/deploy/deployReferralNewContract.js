const helps = require("./shared/helpers")
const {ethers, network} = require("hardhat");

const MAX_INT = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"

let addrMap = helps.createAddrRecorder("./contract_address.json");
let actionHandler = helps.createSettingRecorder("./contract_actions.json");

async function getOrDeployContract(key, contract, params, label, options) {
  return await helps.getOrDeployContractWithPath(addrMap, key, contract, params, label, options)
}

async function getOrDeployTransparentProxyContractWithPath(key, contract, params, label, options) {
  return await helps.getOrDeployTransparentProxyContractWithPath(addrMap, key, contract, params, label, options)
}

async function main() {

  const [deployer] = await ethers.getSigners();
  console.log("deployer is:", deployer.address, "network is:", network.name)

  // 獲取 storageT 合約
  const storageV1 = await helps.contractAt("PairexTradingStorageV1", addrMap.getAddr("PairexTradingStorageV1"))

  // 部署 ReferralStorage 合約
  const referralV1_1 = await getOrDeployTransparentProxyContractWithPath("PEXReferralStorageV1_1", "PEXReferralStorageV1_1", [storageV1.address]);
  // 配置Tire反佣比例
  await helps.sendActionWithPath(actionHandler, referralV1_1.setTier, [0, 1000, 1000], "PEXReferralStorageV1_1.setTier")

}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
