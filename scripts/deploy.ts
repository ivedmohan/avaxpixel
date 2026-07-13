import { ethers } from 'hardhat'

async function main() {
  const [deployer] = await ethers.getSigners()
  console.log('Deploying from:', deployer.address)

  const RPlace = await ethers.getContractFactory('RPlace')
  const rplace = await RPlace.deploy()
  await rplace.waitForDeployment()

  const address = await rplace.getAddress()
  console.log('RPlace deployed to:', address)
  console.log('Update CONTRACT_ADDRESS in src/config.ts with this address')
}

main().catch(e => { console.error(e); process.exit(1) })
