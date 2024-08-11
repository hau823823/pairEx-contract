require("@nomiclabs/hardhat-waffle")
require('@openzeppelin/hardhat-upgrades');
require("@nomiclabs/hardhat-etherscan")
require("hardhat-contract-sizer")
require('@typechain/hardhat')
require("hardhat-abi-exporter")
const { GetConfig } = require("./config/getConfig")
let config = GetConfig();

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task("accounts", "Prints the list of accounts", async () => {
  const accounts = await ethers.getSigners()

  for (const account of accounts) {
    console.info(account.address)
  }
})

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  networks: {
    localhost:{
      gas:  30000000,
      gasPrice: 200000000,
      allowUnlimitedContractSize: true
    },
    hardhat: {
      forking: {
        url: config.url.node_rpc[0],
      },
      allowUnlimitedContractSize: true
    },
    arbitrumGoerli: {
      url: config.url.node_rpc[0],
      chainId: 421613,
      accounts: [config.address_private.deploy_private]
    },
    arbitrumSepolia: {
      url: config.url.node_rpc[0],
      chainId: 421614.,
      accounts: [config.address_private.deploy_private]
    },
    arbitrumOne: {
      url: config.url.node_rpc[1],
      chainId: 42161,
      accounts: [config.address_private.deploy_private]
    },
  },
  etherscan: {
    apiKey: {
      arbitrumGoerli: config.api_key.browser_api_key,
      arbitrumOne: config.api_key.browser_api_key,
      arbitrumSepolia: config.api_key.browser_api_key,
    },
    customChains: [
      {
        network: "arbitrumGoerli",
        chainId: 421613,
        urls: {
          apiURL: config.url.browser_api,
          browserURL: config.url.browser_url
        }
      },
      {
        network: "arbitrumSepolia",
        chainId: 421614.,
        urls: {
          apiURL: config.url.browser_api,
          browserURL: config.url.browser_url
        }
      },
      {
        network: "arbitrumOne",
        chainId: 42161,
        urls: {
          apiURL: config.url.browser_api,
          browserURL: config.url.browser_url
        }
      },
    ]
  },
  solidity: {
    compilers: [
      {
        version: "0.4.17",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1
          }
        }
      },
      {
        version: "0.6.6",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1
          }
        }
      },
      {
        version: "0.6.12",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1
          }
        }
      },
      {
        version: "0.7.0",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1
          }
        }
      },
      {
        version: "0.7.1",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1
          }
        }
      },
      {
        version: "0.8.17",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1
          }
        }
      },
    ],
    typechain: {
      outDir: "typechain",
      target: "ethers-v5",
    },

    abiExporter: {
      path: "./abi",
      format: "json"
    }
  },
};

