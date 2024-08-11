const helps = require("./shared/helpers")
const {expandDecimals} = require("./shared/utilities")
const {ethers, network} = require("hardhat");
const axios = require("axios")
const BigNumber = require("bignumber.js")
const { GetConfig } = require("../../config/getConfig")

const MAX_INT = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"

let addrMap = helps.createAddrRecorder("./contract_address.json");
let actionHandler = helps.createSettingRecorder("./economic_actions.json");

async function getOrDeployContract(key, contract, params, label, options) {
  return await helps.getOrDeployContractWithPath(addrMap, key, contract, params, label, options)
}

async function getOrDeployTransparentProxyContractWithPath(key, contract, params, label, options) {
  return await helps.getOrDeployTransparentProxyContractWithPath(addrMap, key, contract, params, label, options)
}

async function upgradeTransparentProxyContractWithPath(proxyKey, contractName) {
  return await helps.upgradeTransparentProxyContractWithPath(addrMap,proxyKey, contractName)
}

async function sendAction(func, params, label) {
  return await helps.sendActionWithPath(actionHandler, func, params, label)
}

async function main() {

  const [deployer] = await ethers.getSigners();
  console.log("deployer is:", deployer.address, "network is:", network.name)

  let config = GetConfig()
  const usdtArbOneAddr = config.address.usdt_arbOne_address

  // tss 簽名地址
  const triggerAddr = deployer.address

  // pex 財務地址
  const pexMintAddr1 = "0x2e9eb8c37feb2d214aeb6f5af0826baf077ee9a0"
  const pexMintAddr2 = "0x2722717b93b8481d10e0f6f8ab91fae2da5cef52"

  let usdt
  let uniswapRouter
  if ( network.name === helps.ARBI_GOERLI_NETWORK) {
    usdt = await helps.contractAt("TestToken", addrMap.getAddr("USDT"))
    uniswapRouter = "0x4648a43b2c14da09fdf82b161150d3f634f40491"
  } else {
    usdt = await helps.contractAt("TestToken", usdtArbOneAddr)
    uniswapRouter = "0x4C60051384bd2d3C01bfc845Cf5F4b44bcbE9de5"
  }
  const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3"

  // 升級 storage 以及 ptoken 合約
  await upgradeTransparentProxyContractWithPath("PairexTradingStorageV1","PairexTradingStorageV1")
  await upgradeTransparentProxyContractWithPath("PTokenV1","PTokenV1")
  await upgradeTransparentProxyContractWithPath("PEXTradingCallbacksV1","PEXTradingCallbacksV1")
  await upgradeTransparentProxyContractWithPath("PEXTradeRegisterV1_1","PEXTradeRegisterV1_1")
  await upgradeTransparentProxyContractWithPath("PEXAdlCallbacksV1_1","PEXAdlCallbacksV1_1")
  
  const PairexTradingStorageV1 = await helps.contractAt("PairexTradingStorageV1", addrMap.getAddr("PairexTradingStorageV1"))
  const PTokenV1 = await helps.contractAt("PTokenV1", addrMap.getAddr("PTokenV1"))

  // 部署新合約
  const PEX = await getOrDeployContract("PEX", "PEX", ["PairEx Token","PEX", pexMintAddr1, pexMintAddr2])
  const esPEX = await getOrDeployTransparentProxyContractWithPath("esPEX", "esPEX", ["Escrowed PEX", "esPEX", PEX.address, PairexTradingStorageV1.address])
  const Vester = await getOrDeployTransparentProxyContractWithPath("Vester", "Vester", [PEX.address, esPEX.address, PairexTradingStorageV1.address])
  const EcosystemManage = await getOrDeployTransparentProxyContractWithPath("EcosystemManage", "EcosystemManage", [PairexTradingStorageV1.address,uniswapRouter,usdt.address ,PEX.address, esPEX.address])
  const PLPStaking = await getOrDeployTransparentProxyContractWithPath("PLPStaking", "PLPStaking", [esPEX.address, PairexTradingStorageV1.address, EcosystemManage.address, PTokenV1.address])
  const RewardRouter = await getOrDeployTransparentProxyContractWithPath("RewardRouter", "RewardRouter", [PEX.address,esPEX.address, PairexTradingStorageV1.address, EcosystemManage.address,usdt.address])

  // 配置參數
  await sendAction(PTokenV1.updatePlpStakingAddress, [PLPStaking.address], "PTokenV1.updatePlpStakingAddress")

  await sendAction(PairexTradingStorageV1.setEcosystemManage, [EcosystemManage.address], "PairexTradingStorageV1.setEcosystemManage")
  await sendAction(PairexTradingStorageV1.approveEcoSystem, [PTokenV1.address], "PairexTradingStorageV1.approveEcoSystem.ptokenv1")
  await sendAction(PairexTradingStorageV1.approveEcoSystem, [EcosystemManage.address], "PairexTradingStorageV1.approveEcoSystem.EcosystemManage")
  await sendAction(PairexTradingStorageV1.setPlatformFeeSharesP, [25, 15, 60], "PairexTradingStorageV1.setPlatformFeeSharesP")
  await sendAction(PairexTradingStorageV1.addTradingContract, [EcosystemManage.address], "PairexTradingStorageV1.addTradingContract")

  await sendAction(esPEX.setConvert2PEXAddress, [Vester.address,true], "esPEX.setConvertPEXAddress.vester")
  await sendAction(esPEX.setConvert2EsPEXAddress, [deployer.address,true], "esPEX.setConvertEsPEXAddress.deployer")
  await sendAction(esPEX.setConvert2EsPEXAddress, [EcosystemManage.address,true], "esPEX.setConvertEsPEXAddress.EcosystemManage")

  await sendAction(EcosystemManage.Approve, [usdt.address,PERMIT2], "EcosystemManage.Approve")
  await sendAction(EcosystemManage.Approve, [usdt.address, RewardRouter.address], "EcosystemManage.Approve.RewardRouter")
  await sendAction(EcosystemManage.Approve, [esPEX.address, PLPStaking.address], "EcosystemManage.Approve.PLPStaking.esPEX")
  await sendAction(EcosystemManage.Approve, [PEX.address, esPEX.address], "EcosystemManage.Approve.esPEX")
  await sendAction(EcosystemManage.ApprovePERMIT2, [PERMIT2, usdt.address, uniswapRouter], "EcosystemManage.ApprovePERMIT2")
  await sendAction(EcosystemManage.setEcosystemSharesP, [5, 35, 5, 15], "EcosystemManage.setEcosystemSharesP")
  await sendAction(EcosystemManage.setRewardRouter, [RewardRouter.address], "EcosystemManage.setRewardRouter")
  await sendAction(EcosystemManage.setPlpStaking, [PLPStaking.address], "EcosystemManage.setPlpStaking")
  await sendAction(EcosystemManage.addTriggeredWhiteList, [triggerAddr], "EcosystemManage.addTriggeredWhiteList.botAddr")
  await sendAction(EcosystemManage.addTriggeredWhiteList, [EcosystemManage.address], "EcosystemManage.addTriggeredWhiteList.contractSelfAddr")


  // 方便測試用
  await sendAction(PEX.approve, [esPEX.address,MAX_INT], "PEX.approve.deployer")
  await sendAction(PTokenV1.approve, [PLPStaking.address,MAX_INT], "PLPStaking.approve.deployer")
  await sendAction(PEX.approve, [RewardRouter.address,MAX_INT], "PEX.staking.approve.deployer")
  await sendAction(esPEX.approve, [RewardRouter.address,MAX_INT], "esPEX.staking.approve.deployer")
  
}

main()
  .then(() => {
    process.exit(0)
  })
  .catch(error => {
    console.error(error);
    process.exit(1);
  });