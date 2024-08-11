const { ethers, upgrades } = require("hardhat");
const {Manifest} = require("@openzeppelin/upgrades-core");
const helps = require("./shared/helpers");
let addrMap = helps.createAddrRecorder("./contract_address.json");
let actionHandler = helps.createSettingRecorder("./contract_actions.json");
/**
 * 针对某个合约进行升级
 * @param proxyKey 需要升级的代理合约名称，对应 contract_address.json 的名称
 * @param contractName  用于升级的逻辑合约名称，写 sol 文件中的合约名
 * @returns {Promise<void>} 返回升级完成的代理合约地址
 */
async function upgradeTransparentProxyContractWithPath(proxyKey, contractName) {
  return await helps.upgradeTransparentProxyContractWithPath(addrMap,proxyKey, contractName)
}

async function getOrDeployContract(key, contract, params, label, options) {
  return await helps.getOrDeployContractWithPath(addrMap, key, contract, params, label, options)
}

async function sendAction(func, params, label) {
  return await helps.sendActionWithPath(actionHandler, func, params, label)
}

async function Timelock(){
  // 使用 timelock 方式升级，先记录在此，后续整理
  const [deployer] = await ethers.getSigners();
  let govArrs = [deployer.address]
  const PEXTimelock = await getOrDeployContract("PEXTimelock", "PEXTimelock",
    [120,govArrs,govArrs,deployer.address]) // 部署这个合约时浏览器可能无法验证，需要指定合约文件

  // 1. 利用这个函数校验修改和生成逻辑合约
  await upgradeTransparentProxyContractWithPath("PairexTradingStorageV1","PairexTradingStorageV1")
  // 2. 验证逻辑合约
  await helps.verifyContract("0xB8C7DC32C72F00382c69B230Ea1e5C016B9260E6", [])
  // 3. 提交修改的申请
  await sendAction(PEXTimelock.schedule,[
    "0x30039059d0405264b33aee67e2d8ce77a7059b42", // 目标地址
    0 // 转账金额
    // 执行函数，字节码方式
    ,"0x99a88ec4000000000000000000000000fc5a2e5e64555fa0917ed27432c031a2fc75cbeb000000000000000000000000B8C7DC32C72F00382c69B230Ea1e5C016B9260E6"
    // 依赖的上一个申请，0 无依赖
    ,"0x0000000000000000000000000000000000000000000000000000000000000000",
    // 盐，用于解决冲突，我们使用应该递增
    "0x0000000000000000000000000000000000000000000000000000000000000000"
    // 多久后能执行？秒单位
    ,300
  ],"PEXTimelock.schedule") // 申请
  // 过指定时间后，执行，参数类似，少最后一个参数
  await sendAction(PEXTimelock.execute,[
    "0x30039059d0405264b33aee67e2d8ce77a7059b42",
    0,"0x99a88ec4000000000000000000000000fc5a2e5e64555fa0917ed27432c031a2fc75cbeb000000000000000000000000B8C7DC32C72F00382c69B230Ea1e5C016B9260E6"
    ,"0x0000000000000000000000000000000000000000000000000000000000000000",
    "0x0000000000000000000000000000000000000000000000000000000000000000"
  ],"PEXTimelock.execute") // 执行申请

  /*
  测试例子：
  添加一个 testProxt0 public 函数
  旧升级方式：https://goerli.arbiscan.io/tx/0x59da468ed9167f3a9c175edd6a7194a91fccdfac34dc89882424a2ca35de59c3
  修改owner为timelock合约：https://goerli.arbiscan.io/tx/0xaefb03667c01665fa9266fa3e4d244ff808eaaa721bcf7f462aeeec35abf26be
  把testProxt0函数修改为 testProxt1 view public 函数
  新逻辑合约：https://goerli.arbiscan.io/address/0xB8C7DC32C72F00382c69B230Ea1e5C016B9260E6
  由于修改了 owner权限，旧升级方式失败：https://goerli.arbiscan.io/tx/0x351c39eb39abedd76f488f7a9df0549571986f9f4c24803cf1312069447955be
  申请修改：https://goerli.arbiscan.io/tx/0xa71d2743c5498304022b84459a962eb98befdc2256fdaf84263d6dff607cf892
  未到时间就申请执行，执行失败：https://goerli.arbiscan.io/tx/0x87a6838a51a1859fb2ba5a934e2dcf7f616f635ba52688651c3600612e35e636
  执行申请：https://goerli.arbiscan.io/tx/0x31ea80085b79ea929054b83008f1b298bc4ea5eb7ba6a3f233eed43689be1b3e
    */
}

async function main() {
  // 升级 PEXTradingCallbacksV1 合约
  //await upgradeTransparentProxyContractWithPath("PEXTradingCallbacksV1","PEXTradingCallbacksV1")

  // 升级 PairexTradingStorageV1 合约
  //await upgradeTransparentProxyContractWithPath("PairexTradingStorageV1","PairexTradingStorageV1")

  // 升级 PToken 合约
  // await upgradeTransparentProxyContractWithPath("PTokenV1","PTokenV1")

  // 升级 PEXPairsStorageV1 合约
  //await upgradeTransparentProxyContractWithPath("PEXPairsStorageV1","PEXPairsStorageV1")

  // 升级 PEXPairInfosV1 合约
  //await upgradeTransparentProxyContractWithPath("PEXPairInfosV1","PEXPairInfosV1")

  // 升级 PEXNftRewardsV1 合约
  //await upgradeTransparentProxyContractWithPath("PEXNftRewardsV1","PEXNftRewardsV1")

  // 升级 PEXAdlCallbacksV1_1 合约
  //await upgradeTransparentProxyContractWithPath("PEXAdlCallbacksV1_1","PEXAdlCallbacksV1_1")

  // 升级 PEXAdlClosingV1_1 合约
  //await upgradeTransparentProxyContractWithPath("PEXAdlClosingV1_1","PEXAdlClosingV1_1")

  await upgradeTransparentProxyContractWithPath("PEXReferralStorageV1_1","PEXReferralStorageV1_1")
}

// 这里也可以简化为 main()，后面的都省略也可以
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });