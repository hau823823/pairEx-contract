const { ethers } = require("hardhat");

async function main() {
  const provider = new ethers.providers.JsonRpcProvider();
  
  // 模拟新的区块的产生，5000 block
  for (let i = 0; i < 2500; i++) {
    await provider.send("evm_mine", []);
  }
}

main();