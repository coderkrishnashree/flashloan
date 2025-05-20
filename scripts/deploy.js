const { ethers } = require("hardhat");
require("dotenv").config();

async function main() {
  // Get deployer account
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);
  console.log("Account balance:", (await deployer.getBalance()).toString());
  
  // Verify required env variables
  const lendingPoolAddressProvider = process.env.AAVE_LENDING_POOL_ADDRESS_PROVIDER;
  if (!lendingPoolAddressProvider) {
    throw new Error("AAVE_LENDING_POOL_ADDRESS_PROVIDER not set in .env file");
  }
  
  const quickswapRouter = process.env.QUICKSWAP_ROUTER;
  const sushiswapRouter = process.env.SUSHISWAP_ROUTER;
  
  if (!quickswapRouter || !sushiswapRouter) {
    throw new Error("DEX router addresses not set in .env file");
  }
  
  // Deploy the basic flash loan contract
  console.log("Deploying basic ArbitrageFlashLoan...");
  const ArbitrageFlashLoan = await ethers.getContractFactory("ArbitrageFlashLoan");
  const arbitrageFlashLoan = await ArbitrageFlashLoan.deploy(lendingPoolAddressProvider);
  await arbitrageFlashLoan.deployed();
  console.log("Basic ArbitrageFlashLoan deployed to:", arbitrageFlashLoan.address);
  
  // Deploy the advanced contract
  console.log("Deploying AdvancedArbitrageBot...");
  try {
    const AdvancedArbitrageBot = await ethers.getContractFactory("AdvancedArbitrageBot");
    const advancedBot = await AdvancedArbitrageBot.deploy(
      lendingPoolAddressProvider,
      quickswapRouter,
      sushiswapRouter
    );
    await advancedBot.deployed();
    console.log("Advanced ArbitrageBot deployed to:", advancedBot.address);
    
    console.log("\n-------------------------------------------------");
    console.log("Contracts deployed! Update your .env file with these addresses:");
    console.log(`ARBITRAGE_FLASH_LOAN_ADDRESS=${arbitrageFlashLoan.address}`);
    console.log(`ADVANCED_ARBITRAGE_BOT_ADDRESS=${advancedBot.address}`);
    console.log("-------------------------------------------------\n");
    
  } catch (error) {
    console.error("Error deploying advanced contract:", error.message);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });