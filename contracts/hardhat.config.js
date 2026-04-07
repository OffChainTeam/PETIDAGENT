require("@nomicfoundation/hardhat-toolbox");
require("@matterlabs/hardhat-zksync");
require("dotenv").config();

const PRIVATE_KEY = process.env.PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000001";

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  zksolc: {
    version: "1.5.15",
    settings: {},
  },
  solidity: {
    version: "0.8.22",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      evmVersion: "shanghai",
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
    testnet: {
      url: "https://rpc.tanenbaum.io",
      chainId: 5700,
      accounts: [PRIVATE_KEY],
      gasPrice: "auto",
    },
    zksys: {
      url: "https://rpc-pob.dev11.top",
      chainId: 57042,
      accounts: [PRIVATE_KEY],
      gasPrice: "auto",
    },
    zksystestnet: {
      url: "https://rpc-zk.tanenbaum.io",
      ethNetwork: "https://rpc-zk.tanenbaum.io",
      zksync: true,
      chainId: 57057,
      accounts: [PRIVATE_KEY],
      verifyURL: "https://explorer-zk.tanenbaum.io/contract_verification",
    },
    mainnet: {
      url: "https://rpc.syscoin.org",
      chainId: 57,
      accounts: [PRIVATE_KEY],
      gasPrice: "auto",
    },
  },
  etherscan: {
    apiKey: {
      testnet: "none",
      zksys: "none",
      mainnet: "none",
    },
    customChains: [
      {
        network: "testnet",
        chainId: 5700,
        urls: {
          apiURL: "https://explorer.tanenbaum.io/api",
          browserURL: "https://explorer.tanenbaum.io",
        },
      },
      {
        network: "zksys",
        chainId: 57042,
        urls: {
          apiURL: "https://explorer-pob.dev11.top/api",
          browserURL: "https://explorer-pob.dev11.top",
        },
      },
      {
        network: "zksystestnet",
        chainId: 57057,
        urls: {
          apiURL: "https://explorer-zk.tanenbaum.io/api",
          browserURL: "https://explorer-zk.tanenbaum.io",
        },
      },
      {
        network: "mainnet",
        chainId: 57,
        urls: {
          apiURL: "https://explorer.syscoin.org/api",
          browserURL: "https://explorer.syscoin.org",
        },
      },
    ],
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};
