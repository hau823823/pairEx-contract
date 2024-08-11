const helps = require("../shared/helpers")
const {expandDecimals} = require("../shared/utilities")
const {ethers, network} = require("hardhat");
const axios = require("axios")
const BigNumber = require("bignumber.js")
const { GetConfig } = require("../../../config/getConfig")

const MAX_INT = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"

let addrMap = helps.createAddrRecorder("./economic_contract_address.json");
let actionHandler = helps.createSettingRecorder("./economic_contract_actions.json");

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
  // 0xeA7650F9EBBd4B98eC8F8E7229d025dc331E2a57
  if(deployer.address.toLowerCase()!=="0xeA7650F9EBBd4B98eC8F8E7229d025dc331E2a57".toLowerCase()){
    console.log("deployer address err ,use 0xeA7650F9EBBd4B98eC8F8E7229d025dc331E2a57 but ",deployer.address)
    return
  }
  console.log("deployer is:", deployer.address, "network is:", network.name)

  let govAddr = deployer.address

  const usdt = await getOrDeployContract("USDT", "TestToken", ["PEXUSDT", "PEXUSDT", 6, BigInt(5000 * 1e6)])
  const PairexTradingStorageV1 = await getOrDeployTransparentProxyContractWithPath("PairexTradingStorageV1", "PairexTradingStorageV1", [govAddr, usdt.address, govAddr])
  var PTokenV1 = await getOrDeployTransparentProxyContractWithPath("PTokenV1", "PTokenV1", [
    "PLP","PLP",6,
    usdt.address,
    PairexTradingStorageV1.address,
    PairexTradingStorageV1.address,
    govAddr,
  ])
  const PEX = await getOrDeployContract("PEX", "PEX", [
    "PairEx Token","PEX",
    PairexTradingStorageV1.address,
    deployer.address,deployer.address,deployer.address,deployer.address,
    deployer.address,deployer.address,deployer.address,deployer.address,
  ])
  const esPEX = await getOrDeployTransparentProxyContractWithPath("esPEX", "esPEX", ["Escrowed PEX", "esPEX", PEX.address, PairexTradingStorageV1.address])
  const Vester = await getOrDeployTransparentProxyContractWithPath("Vester", "Vester", [PEX.address, esPEX.address, PairexTradingStorageV1.address])

  const uniswapRouter = "0x4648a43b2c14da09fdf82b161150d3f634f40491"
  const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3"
  const EcosystemManage = await getOrDeployTransparentProxyContractWithPath("EcosystemManage", "EcosystemManage", [PairexTradingStorageV1.address,uniswapRouter,usdt.address ,PEX.address, esPEX.address])

  const PLPStaking = await getOrDeployTransparentProxyContractWithPath("PLPStaking", "PLPStaking", [esPEX.address, PairexTradingStorageV1.address, EcosystemManage.address, PTokenV1.address])
  const RewardRouter = await getOrDeployTransparentProxyContractWithPath("RewardRouter", "RewardRouter", [PEX.address,esPEX.address, PairexTradingStorageV1.address, EcosystemManage.address,usdt.address])

  //await sendAction(PairexTradingStorageV1.updateSupportedCollateral, [usdt.address], "PairexTradingStorageV1.updateSupportedCollateral")
  await sendAction(PairexTradingStorageV1.setVault, [PTokenV1.address], "PairexTradingStorageV1.setValut")
  await sendAction(PairexTradingStorageV1.setEcosystemManage, [EcosystemManage.address], "PairexTradingStorageV1.setEcosystemManage")
  await sendAction(PairexTradingStorageV1.approveEcoSystem, [], "PairexTradingStorageV1.approveEcoSystem")
  await sendAction(PairexTradingStorageV1.setPlatformFeeSharesP, [25, 15, 60], "PairexTradingStorageV1.setPlatformFeeSharesP")
  await sendAction(esPEX.setConvertPEXAddress, [Vester.address,true], "esPEX.setConvertPEXAddress.vester")
  await sendAction(esPEX.setConvertEsPEXAddress, [deployer.address,true], "esPEX.setConvertEsPEXAddress.deployer")
  await sendAction(PEX.approve, [esPEX.address,MAX_INT], "PEX.approve.deployer")
  await sendAction(PTokenV1.approve, [PLPStaking.address,MAX_INT], "PLPStaking.approve.deployer")
  await sendAction(PEX.approve, [RewardRouter.address,MAX_INT], "PEX.staking.approve.deployer")
  await sendAction(esPEX.approve, [RewardRouter.address,MAX_INT], "esPEX.staking.approve.deployer")
  await sendAction(EcosystemManage.Approve, [usdt.address,PERMIT2], "EcosystemManage.Approve")
  await sendAction(EcosystemManage.ApprovePERMIT2, [PERMIT2,usdt.address,uniswapRouter], "EcosystemManage.ApprovePERMIT2")
  await sendAction(EcosystemManage.addTriggeredWhiteList, [deployer.address], "EcosystemManage.addTriggeredWhiteList")
  await sendAction(EcosystemManage.setEcosystemSharesP, [5, 35, 5, 15], "EcosystemManage.setEcosystemSharesP")
  await sendAction(EcosystemManage.setRewardRouter, [RewardRouter.address], "EcosystemManage.setRewardRouter")
  await sendAction(EcosystemManage.setPlpStaking, [PLPStaking.address], "EcosystemManage.setPlpStaking")
  //await sendAction(usdt.transfer, [EcosystemManage.address,1000000000], "EcosystemManage.usdt.transfer")
}

main()
  .then(() => {
    process.exit(0)
  })
  .catch(error => {
    console.error(error);
    process.exit(1);
  });