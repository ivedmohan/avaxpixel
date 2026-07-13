import { HardhatUserConfig } from 'hardhat/config'
import '@nomicfoundation/hardhat-ethers'
import * as dotenv from 'dotenv'
dotenv.config()

const pk = process.env.DEPLOYER_PRIVATE_KEY
const accounts = pk ? [pk] : []

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    fuji: {
      url: 'https://api.avax-test.network/ext/bc/C/rpc',
      chainId: 43113,
      accounts,
    },
  },
}

export default config
