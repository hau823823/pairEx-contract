# PairEx Contract

## Introduction

![Node](https://img.shields.io/badge/Node-v16.17.0-brightgreen)
![Hardhat](https://img.shields.io/badge/Hardhat-v2.12.5-yellow)

[![PairEx Homepage](/img/pairExHomepage.png)]((https://pairex.io/en-ww/))

PairEx, available at [pairex.io](https://pairex.io/en-ww/), is a preeminent decentralized perpetual exchange that leverages the Arbitrum Network to provide a seamless trading experience to its users. Its user-friendly platform is built on a transparent and secure trading infrastructure, enabling users to decentralize their trades and assets with confidence.

>[!NOTE]  
>This codebase focuses on the smart contracts and not include backend services or frontend interfaces.

## Contract Address

- PEXTradingV1 : [0xd4078BD364949FB597B8CE38b404F3c44cb6127e](https://arbiscan.io/address/0xd4078BD364949FB597B8CE38b404F3c44cb6127e)
- PairexTradingStorageV1 : [0x9CC1b358E39651F118AA02126648f4a770B7432D](https://arbiscan.io/address/0x9CC1b358E39651F118AA02126648f4a770B7432D)
- PEXPairsStorageV1 : [0x887f7dC11d855636133A8790212D26a83d70C0F4](https://arbiscan.io/address/0x887f7dC11d855636133A8790212D26a83d70C0F4)
- PEXPairInfosV1 : [0xf8B74d5Db2CE324F879173b903b77209316Aaa86](https://arbiscan.io/address/0xf8B74d5Db2CE324F879173b903b77209316Aaa86)
- PTokenV1 : [0x2Ca07638acDa0B2bEa7B6a06F135476BDdd7101B](https://arbiscan.io/address/0x2Ca07638acDa0B2bEa7B6a06F135476BDdd7101B)
- PEXTradingCallbacksV1 : [0xF72B4737621f58F049b9Fcc1280E725e9d1cB853](https://arbiscan.io/address/0xF72B4737621f58F049b9Fcc1280E725e9d1cB853)
- Oracle_node_0 : [0xA7dE0DD19004b430cC8C920fCA9F5FDE5A66379b](https://arbiscan.io/address/0xA7dE0DD19004b430cC8C920fCA9F5FDE5A66379b)
- Oracle_node_1 : [0x35DD17F0d9098fc5B24D6328122B4C9ea5dD7DB5](https://arbiscan.io/address/0x35DD17F0d9098fc5B24D6328122B4C9ea5dD7DB5)
- PEXPriceAggregatorV1 : [0x0a30067Ad5ff753F6887bBaF03b467C87CF62eF3](https://arbiscan.io/address/0x0a30067Ad5ff753F6887bBaF03b467C87CF62eF3)
- PEXNftRewardsV1 : [0x9888A2a9501C43716D910c5E045bfB50873FE682](https://arbiscan.io/address/0x9888A2a9501C43716D910c5E045bfB50873FE682)
- PEXAdlClosingV1_1 : [0xDcB590bA2A1228EFE2948Ee4f5b49DDFaa1f93fe](https://arbiscan.io/address/0xDcB590bA2A1228EFE2948Ee4f5b49DDFaa1f93fe)
- PEXAdlCallbacksV1_1 : [0x8Af14E241A66a0b3Df3de987a44d1d1a0093C1f6](https://arbiscan.io/address/0x8Af14E241A66a0b3Df3de987a44d1d1a0093C1f6)
- PEXReferralStorageV1_1 : [0xA0E77148D200d1b9c7E6DC60f18BD6C864bD98f0](https://arbiscan.io/address/0xA0E77148D200d1b9c7E6DC60f18BD6C864bD98f0)
- PEXTradeRegisterV1_1 : [0xD1b9d1c05bA1654B9e2C79298390e4F621c6aD66](https://arbiscan.io/address/0xD1b9d1c05bA1654B9e2C79298390e4F621c6aD66)
- PairExPassNftV1_1 : [0xBf0441fF3dCBB558C28E5525de47f1F12D0EBC20](https://arbiscan.io/address/0xBf0441fF3dCBB558C28E5525de47f1F12D0EBC20)

## Interact with contract

The main entry contract for frontend interfaces or users opening and closing interactions is `PEXTradingV1`, which includes functionalities such as market and limit order openings and closings, as well as take profit and stop loss adjustments.

### openTrade

> Market and limit order positions opening

| Name | Types | Description | Other |
| ---- | ----- | ----------- | ----- |
|trader|address|opening address|in same structure|
|pairIndex|uint|opening asset (BTC 0, ETH 1)|in same structure|
|index|uint|fill with 0|in same structure|
|initialPosUSDT|uint|fill with 0|in same structure|
|positionSizeUsdt|uint|margin amount|in same structure|
|openPrice|uint|Opening Price|in same structure|
|buy|bool|long or short|in same structure|
|leverage|uint| |in same structure|
|tp|uint|take profit| in same structure|
|sl|uint|stop loss|all of the above are within the same structure|
|orderType|uint|market 0, limit 1| |
|slippageP|uint|max acceptable slippage for market order opening|
|monthPassId|uint|default 0|holding can reduce transaction fees|

### closeTradeMarket

> Positions closing

| Name | Types | Description | Other |
| ---- | ----- | ----------- | ----- |
|pairIndex|uint|closing asset (BTC 0, ETH 1)| |
|index|uint|existing positions index| |

### updateTp

> Update the take profit price

| Name | Types | Description | Other |
| ---- | ----- | ----------- | ----- |
|pairIndex|uint|closing asset (BTC 0, ETH 1)| |
|index|uint|existing positions index| |
|newTp|uint|new price|PRECISION 10|

### updateSl

> Update the sell loss price

| Name | Types | Description | Other |
| ---- | ----- | ----------- | ----- |
|pairIndex|uint|closing asset (BTC 0, ETH 1)| |
|index|uint|existing positions index| |
|newSl|uint|new price|PRECISION 10|

## Arch

>[!TIP]  
> This Arch diagram primarily illustrates the contract interaction logic and cash flow logic

![PairEx UML](/img/UML.jpg)

## Repository Structure

Main contracts are held within the `contracts/v1_0` and `contracts/v1_1` folder.  
And the utilities including deploy script are held within the `tools/deploy` folder.

```markdown
.
├── config
│   ├── config.yaml
│   └── getConfig.js
├── contracts
│   ├── PEXUSDT
│   ├── interfaces
│   ├── libraries
│   ├── oracle
│   ├── timelock
│   ├── v1_0
│   └── v1_1
├── test
│   ├── NFTV1_1
│   ├── PEXAdlClosingV1_1
│   ├── PEXReferralStorageV1_1
│   ├── PEXTradingV1
│   ├── PTokenv1
│   └── shared
├── tools
│   ├── deploy
│   └── traderBot
├── hardhat.config.js
├── package-lock.json
├── package.json
└── README.md
```

## Deploy and Test

>[!NOTE]  
> Node    version v16.17.0  
> Hardhat version v2.12.5

To deploy the contracts by yourself, you can clone this repo and follow the steps bellow.

```bash
npm install
cd ./tools/deploy
cp deployData/dev_config.yaml ../../config/config.yaml
```

Change the private key, dependency addresses, RPC, and API key in the config to your own deployment private key and the network environment you wish to deploy (example uses Arbitrum Sepolia).

```bash
npx hardhat compile
npx hardhat run deploy.js --network arbitrumSepolia
```

Or you can directly run the Hardhat framework tests and use the files under the `test` folder to familiarize yourself with and run the project

```bash
npx hardhat test
```
