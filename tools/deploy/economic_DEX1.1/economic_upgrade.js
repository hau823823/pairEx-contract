const helps = require("../shared/helpers")

let addrMap = helps.createAddrRecorder("./economic_contract_address.json");
let actionHandler = helps.createSettingRecorder("./economic_contract_actions.json");

async function upgradeTransparentProxyContractWithPath(proxyKey, contractName) {
  return await helps.upgradeTransparentProxyContractWithPath(addrMap,proxyKey, contractName)
}

async function main() {
  // 升级 esPEX 合约
  // await upgradeTransparentProxyContractWithPath("esPEX","esPEX")

  // 升级 Vester 合约
  // await upgradeTransparentProxyContractWithPath("Vester","Vester")

  // 升级 PLPStaking 合约
  // await upgradeTransparentProxyContractWithPath("PLPStaking","PLPStaking")

  // 升级 RewardRouter 合约
  // await upgradeTransparentProxyContractWithPath("RewardRouter","RewardRouter")

  // 升级 EcosystemManage 合约
  // await upgradeTransparentProxyContractWithPath("EcosystemManage","EcosystemManage")
}

main()
  .then(() => {
    process.exit(0)
  })
  .catch(error => {
    console.error(error);
    process.exit(1);
  });