const fs = require('fs')
const path = require('path')
const parse = require('csv-parse')
const request = require("request");
const {ethers, network,upgrades} = require("hardhat");
const readline = require('readline').createInterface({
  input: process.stdin,
  output: process.stdout
});

const HARDHAT_NETWORK = "hardhat"
const LOCALHOST_NETWORK = "localhost"
const ARBI_GOERLI_NETWORK = "arbitrumGoerli"
const ARBI_SEPOLIA_NETWORK = "arbitrumSepolia"
const ARBI_ONE_NETWORK = "arbitrumOne"

const readCsv = async (file) => {
  records = []
  const parser = fs
    .createReadStream(file)
    .pipe(parse({columns: true, delimiter: ','}))
  parser.on('error', function (err) {
    console.error(err.message)
  })
  for await (const record of parser) {
    records.push(record)
  }
  return records
}

async function sendTxn(txnPromise, label) {
  const txn = await txnPromise
  console.info(`Sending ${label}...`)
  await txn.wait()
  console.info(`... Sent! ${txn.hash}`)
  return txn
}

async function callWithRetries(func, args, retriesCount = 3) {
  let i = 0
  while (true) {
    i++
    try {
      return await func(...args)
    } catch (ex) {
      if (i === retriesCount) {
        console.error("call failed %s times. throwing error", retriesCount)
        throw ex
      }
      console.error("call i=%s failed. retrying....", i)
      console.error(ex.message)
    }
  }
}

async function deployContract(name, args, label, options) {
  let info = name
  if (label) {
    info = name + ":" + label
  }
  const contractFactory = await ethers.getContractFactory(name) //通过name找到对应的合约类；
  let contract
  if (options) {
    contract = await contractFactory.deploy(...args, options)
  } else {
    contract = await contractFactory.deploy(...args)
  }
  const argStr = args.map((i) => `"${i}"`).join(" ")
  console.info(`Deploying ${info} ${contract.address} ${argStr}`)
  await contract.deployTransaction.wait()
  console.info("... Completed!")
  return contract
}

async function contractAt(name, address, provider) {
  let contractFactory = await ethers.getContractFactory(name)
  if (provider) {
    contractFactory = contractFactory.connect(provider)
  }
  return await contractFactory.attach(address)
}

const tmpAddressesFilepath = path.join(__dirname, '..', '..', `.tmp-addresses-${process.env.HARDHAT_NETWORK}.json`)

function readTmpAddresses() {
  console.info(`tmpAddressesFilepath: ${tmpAddressesFilepath} `)
  if (fs.existsSync(tmpAddressesFilepath)) {
    return JSON.parse(fs.readFileSync(tmpAddressesFilepath))
  }
  return {}
}

function writeTmpAddresses(json) {
  console.info(`tmpAddressesFilepath: ${tmpAddressesFilepath} `)
  const tmpAddresses = Object.assign(readTmpAddresses(), json)
  fs.writeFileSync(tmpAddressesFilepath, JSON.stringify(tmpAddresses))
}

// batchLists is an array of lists
async function processBatch(batchLists, batchSize, handler) {
  let currentBatch = []
  const referenceList = batchLists[0]

  for (let i = 0; i < referenceList.length; i++) {
    const item = []

    for (let j = 0; j < batchLists.length; j++) {
      const list = batchLists[j]
      item.push(list[i])
    }

    currentBatch.push(item)

    if (currentBatch.length === batchSize) {
      console.log("handling currentBatch", i, currentBatch.length, referenceList.length)
      await handler(currentBatch)
      currentBatch = []
    }
  }

  if (currentBatch.length > 0) {
    console.log("handling final batch", currentBatch.length, referenceList.length)
    await handler(currentBatch)
  }
}


function createAddrRecorder(filePath) {
  let addrRecord = {}
  const path = filePath

  try {
    if (fs.existsSync(path)) {
      addrRecord = JSON.parse(fs.readFileSync(path))
    }
  } catch (e) {
    console.error(e);
    process.exit(1);
  }

  const setAddr = (key, addr) => {
    addrRecord[key] = addr
    fs.writeFileSync(
      path,
      JSON.stringify(
        addrRecord,
        "",
        " "
      )
    )
  }

  const getAddr = (key) => {
    return addrRecord[key]
  }

  return {
    setAddr,
    getAddr,
    addrRecord,
  }
}

function createSettingRecorder(filePath) {
  let actionRecord = {}
  const path = filePath

  try {
    if (fs.existsSync(path)) {
      actionRecord = JSON.parse(fs.readFileSync(path))
    }
  } catch (e) {
    console.error(e);
    process.exit(1);
  }

  const setActionTx = (key, tx) => {
    actionRecord[key] = tx
    fs.writeFileSync(
      path,
      JSON.stringify(
        actionRecord,
        "",
        " "
      )
    )
  }

  const getActionTx = (key) => {
    return actionRecord[key]
  }

  return {
    setActionTx,
    getActionTx,
    actionRecord,
  }
}

async function verifyContract(contractAddress, params) {
  if (network.name === HARDHAT_NETWORK || network.name === LOCALHOST_NETWORK) {
    return
  }
  console.log(`verifyContract, address: ${contractAddress} , params: ${params}`)
  try {
    return await hre.run("verify:verify", {
      address: contractAddress,
      constructorArguments: [...params
      ],
    });
  } catch (ex) {
    console.error("verifyContract error:", ex.message)
  }
}

//跟getOrDeployContract一样，只是在部署合约失败的情况下，会做3次重试；//其实可以做其它重试操作，但是目前仅仅用于部署合约；
//部署成功后，将合约-地址写入文件；
async function getOrCallWithRetries(addrMap, key, contract, func, params) {
  let ret;
  if (addrMap.getAddr(key) === undefined) {
    ret = await callWithRetries(func, [contract, params])
    addrMap.setAddr(key, ret.address)
    await verifyContract(ret.address, params)
  } else {
    ret = contractAt(contract, addrMap.getAddr(key))
    ret.address = addrMap.getAddr(key)
    console.log(`Get ${key} from ${addrMap.getAddr(key)}`)
  }
  return ret
}

async function waitForAnswer(question) {
  return new Promise((resolve, reject) =>
    readline.question(question, ok => {
      console.log("input is", ok)
      resolve(ok.toLocaleLowerCase() === 'y')
    })
  )
}

async function upgradeTransparentProxyContractWithPath(addrMap,proxyKey, contractName) {
  if (addrMap.getAddr(proxyKey) === undefined) {
    console.log(`upgradeTransparent err,not found proxy`)
    return
  }

  let proxyAddress = addrMap.getAddr(proxyKey);

  const token = await ethers.getContractFactory(contractName)
  let ret = await upgrades.upgradeProxy(proxyAddress, token)
  if(!ret.deployTransaction.hash){
    console.log(`upgrade ${contractName} fail ${ret}`)
  }

  let ImplementationAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress)
  await verifyContract(ImplementationAddress, [])

  console.log(`upgrade ${contractName} has been done in hash ${ret.deployTransaction.hash}`)
  return proxyAddress
}

async function getOrDeployTransparentProxyContractWithPath(addrMap, key, contract, params, label, options) {
  let ret;
  if (addrMap.getAddr(key) === undefined) {
    const token = await ethers.getContractFactory(contract)
    ret = await upgrades.deployProxy(token, params)

    let ImplementationAddress = await upgrades.erc1967.getImplementationAddress(ret.address)
    await verifyContract(ImplementationAddress.address, [])
    await verifyContract(ret.address, [])

    addrMap.setAddr(key, ret.address)
  } else {
    ret = contractAt(contract, addrMap.getAddr(key))
    ret.address = addrMap.getAddr(key)
    console.log(`Get ${key} from ${addrMap.getAddr(key)}`)
  }
  return ret
}

async function getOrDeployContractWithPath(addrMap, key, contract, params, label, options) {
  let ret;
  if (addrMap.getAddr(key) === undefined) {
    ret = await deployContract(contract, params, label, options)
    addrMap.setAddr(key, ret.address)
    await verifyContract(ret.address, params)
  } else {
    ret = contractAt(contract, addrMap.getAddr(key))
    ret.address = addrMap.getAddr(key)
    //await verifyContract(ret.address, params)
    console.log(`Get ${key} from ${addrMap.getAddr(key)}`)
  }
  return ret
}

async function sendActionWithPath(actionHandler, func, params, label) {
  const hash = actionHandler.getActionTx(label);
  if (hash) {
    console.log(`${label} has been done in hash ${hash}`)
    return
  }
  const txnPromise = func(...params);
  const tx = await sendTxn(txnPromise, label);
  actionHandler.setActionTx(label, tx.hash);
  return tx.nonce;
}

function sleep(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  })
}

module.exports = {
  HARDHAT_NETWORK,
  LOCALHOST_NETWORK,
  ARBI_GOERLI_NETWORK,
  ARBI_SEPOLIA_NETWORK,
  ARBI_ONE_NETWORK,
  readCsv,
  sendTxn,
  deployContract,
  contractAt,
  writeTmpAddresses,
  readTmpAddresses,
  callWithRetries,
  processBatch,
  createAddrRecorder,
  createSettingRecorder,
  judgeContractVerified,
  verifyContract,
  waitForAnswer,
  getOrDeployContractWithPath,
  getOrDeployTransparentProxyContractWithPath,
  upgradeTransparentProxyContractWithPath,
  sendActionWithPath,
  sleep,
}
