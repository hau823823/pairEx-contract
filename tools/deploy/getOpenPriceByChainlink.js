const { ethers } = require("hardhat");
const helps = require("./shared/helpers")
const { GetConfig } = require("../../config/getConfig")

async function getOpenPriceByChainLink(coin){
  let config = GetConfig();
  const btcPriceFeed = config.address.btc_price_feed;
  const ethPriceFeed = config.address.eth_price_feed;

  const [user] = await ethers.getSigners();

  if (coin.toUpperCase() == "BTC") {
    contractAddress = btcPriceFeed;
  } else {
    contractAddress = ethPriceFeed;
  }
  const priceFeed = await ethers.getContractAt("contracts/interfaces/IChainlinkFeed.sol:IChainlinkFeed", contractAddress);
  const price = await priceFeed.latestRoundData();
  //console.log(price.toString());
  //console.log(price[1].toString());

  return BigInt(price[1]*100)
}

async function main() {
  data = await getOpenPriceByChainLink("ETH")
  console.log(data)
}

main()
  .then(() => {
    process.exit(0)
  })
  .catch(error => {
    console.error(error);
    process.exit(1);
});