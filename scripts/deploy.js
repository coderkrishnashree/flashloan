const { ethers } = require("hardhat");

async function main() {
  // Get deployer account
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);
  
  // Deploy the basic flash loan contract for learning
  const ArbitrageFlashLoan = await ethers.getContractFactory("ArbitrageFlashLoan");
  const arbitrageFlashLoan = await ArbitrageFlashLoan.deploy(
    process.env.AAVE_LENDING_POOL_ADDRESS_PROVIDER
  );
  await arbitrageFlashLoan.deployed();
  console.log("Basic ArbitrageFlashLoan deployed to:", arbitrageFlashLoan.address);
  
  // Deploy the advanced contract if ready
  try {
    const AdvancedArbitrageBot = await ethers.getContractFactory("AdvancedArbitrageBot");
    const advancedBot = await AdvancedArbitrageBot.deploy(
      process.env.AAVE_LENDING_POOL_ADDRESS_PROVIDER,
      "0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff", // Uniswap V2 Router
      "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506"  // Sushiswap Router
    );
    await advancedBot.deployed();
    console.log("Advanced ArbitrageBot deployed to:", advancedBot.address);
  } catch (error) {
    console.log("Advanced contract not ready for deployment yet:", error.message);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });