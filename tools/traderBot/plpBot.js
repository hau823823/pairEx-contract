const { GetConfig } = require('./config/getConfig')
const {ethers} = require("ethers");
const { BigNumber } = require('ethers');

const config = GetConfig();
const node_url = config.url.node_rpc
const provider = new ethers.providers.JsonRpcProvider(node_url)

const plp_traders = config.address_private.plp_private
const PToken_address = config.address_contract.plp_address
const timeInterval = config.params_config.plp_timeInterval_min_max
const amountMinMax = config.params_config.plp_amount_min_max

const Ptoken_abi = require('./abi/PToken.json')

function getDayOfYear() {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const timeDiff = now - startOfYear;
  return Math.floor(timeDiff / (1000 * 60 * 60 * 24)) + 1;
}

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function PlpTrigger(){
  console.log("PlpTrigger running...")
  const minApplyAmount = BigNumber.from('10000000');
  const plp_apply_amount = getRandomInt(amountMinMax[0], amountMinMax[1]);
  const amount = new BigNumber.from(plp_apply_amount * 1e6);
  if(amount.lt(minApplyAmount)){
    console.log("amount < minApplyAmount")
    return
  }
  if(plp_traders.length === 0){
    console.log("plp_traders.length === 0")
    return
  }
  const privateLen = plp_traders.length
  const day = getDayOfYear()
  var runIndex = day % privateLen;
  const balance =await BalanceOf(runIndex);
  const LockSum =await GetLockSum(runIndex);

  const wallet = new ethers.Wallet(plp_traders[runIndex], provider)
  console.log(wallet.address,day,balance,LockSum[0])

  let tx;
  if(balance.gt(LockSum[0]) && balance.sub(LockSum[0]).gt(amount) ) {
    // 已经满足解锁的
    console.log("running executeApplyWithdraw,amount:",amount.toString())
    tx = await executeApplyWithdraw(runIndex, amount)
  }else{
    console.log("running executeApplyDeposit,amount:",amount.toString())
    tx =  await executeApplyDeposit(runIndex,amount)
  }
  console.log("tx:",tx.hash)
}

async function BalanceOf(i){
  const wallet = new ethers.Wallet(plp_traders[i], provider)
  const PToken = new ethers.Contract(PToken_address, Ptoken_abi, wallet)

  try {
    return await PToken.balanceOf(wallet.address)
  } catch (error) {
    console.log(error)
    return error
  }
}

async function GetLockSum(i){
  const wallet = new ethers.Wallet(plp_traders[i], provider)
  const PToken = new ethers.Contract(PToken_address, Ptoken_abi, wallet)
  try {
    return await PToken.GetLockSum(wallet.address)
  } catch (error) {
    console.log(error)
    return error
  }
}

async function executeApplyDeposit(i, amount){
  const wallet = new ethers.Wallet(plp_traders[i], provider)
  const PToken = new ethers.Contract(PToken_address, Ptoken_abi, wallet)

  try {
    return await PToken.applyDeposit(amount, wallet.address)
  } catch (error) {
    console.log(error)
    return error
  }
}

async function executeApplyWithdraw(i, amount){
  const wallet = new ethers.Wallet(plp_traders[i], provider)
  const PToken = new ethers.Contract(PToken_address, Ptoken_abi, wallet)

  try {
    return await PToken.applyWithdraw(amount, wallet.address)
  } catch (error) {
    console.log(error)
    return error
  }
}

function getRandom(min, max){
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// 在隨機間隔內觸發任務的函數
function scheduleRandomTask() {
  const randomInterval = getRandom(timeInterval[0], timeInterval[1])// 生成 1 到 5 秒的隨機間隔
  console.log("next second:",randomInterval)

  setTimeout(async() => {
    const timestamp = Date.now()
    const date = new Date(timestamp)
    console.log(date.toLocaleString())

    await PlpTrigger()

    //await randomTriggered()
    scheduleRandomTask()// 重新安排下一次任務
  }, randomInterval * 1000)
}


async function main() {

  const network = await provider.getNetwork()
  console.log(network.name)

  scheduleRandomTask(); // 首次安排任務
}

main()
  .catch(error => {
    console.error(error);
    process.exit(1);
  });