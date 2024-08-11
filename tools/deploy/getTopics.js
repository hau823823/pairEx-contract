const { ethers } = require("hardhat");
const helps = require("./shared/helpers")

let addrMap = helps.createAddrRecorder("./contract_address.json");

async function main() {

  const contract = await helps.contractAt("PEXTradingV1", addrMap.getAddr("PEXTradingV1"))

  const eventName = "CouldNotCloseTrade";
  const eventInterface = contract.interface.getEvent(eventName);
  console.log(eventInterface.format());
  const fragment = ethers.utils.EventFragment.from(eventInterface.format());
  const emptyIface = new ethers.utils.Interface([]);
  const topicHash = emptyIface.getEventTopic(fragment);

  console.log(`${eventName} ->`, topicHash);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
