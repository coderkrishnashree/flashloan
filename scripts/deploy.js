// deploy.js - With enhanced logging and timeout
const { ethers } = require("hardhat");
require("dotenv").config();

async function main() {
  // Get deployer account
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);
  console.log("Account balance:", (await deployer.getBalance()).toString());
  
  // Get current gas price and increase it
  const gasPrice = await ethers.provider.getGasPrice();
  const deploymentGasPrice = gasPrice.mul(150).div(100); // 50% higher
  console.log("Current gas price:", ethers.utils.formatUnits(gasPrice, "gwei"), "gwei");
  console.log("Using deployment gas price:", ethers.utils.formatUnits(deploymentGasPrice, "gwei"), "gwei");
  
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
  
  // First, deploy the ArbitrageLogger contract
  console.log("Deploying ArbitrageLogger...");
  try {
    const ArbitrageLogger = await ethers.getContractFactory("ArbitrageLogger");
    console.log("Contract factory created, deploying...");
    
    // Deploy with explicit gas settings
    const arbitrageLogger = await ArbitrageLogger.deploy({
      gasPrice: deploymentGasPrice,
      gasLimit: 3000000
    });
    
    console.log("Transaction sent, hash:", arbitrageLogger.deployTransaction.hash);
    console.log("Check status at:", `https://polygonscan.com/tx/${arbitrageLogger.deployTransaction.hash}`);
    console.log("Waiting for confirmation (this may take several minutes)...");
    
    // Wait with a timeout of 1 confirmation
    await arbitrageLogger.deployTransaction.wait(1);
    console.log("ArbitrageLogger deployed to:", arbitrageLogger.address);

    // Now deploy the advanced contract with the logger address
    console.log("Deploying AdvancedArbitrageBot with logger...");
    const AdvancedArbitrageBot = await ethers.getContractFactory("AdvancedArbitrageBot");
    console.log("Contract factory created, deploying...");
    
    const advancedBot = await AdvancedArbitrageBot.deploy(
      lendingPoolAddressProvider,
      quickswapRouter,
      sushiswapRouter,
      arbitrageLogger.address,
      {
        gasPrice: deploymentGasPrice,
        gasLimit: 5000000 // Higher gas limit for more complex contract
      }
    );
    
    console.log("Transaction sent, hash:", advancedBot.deployTransaction.hash);
    console.log("Check status at:", `https://polygonscan.com/tx/${advancedBot.deployTransaction.hash}`);
    console.log("Waiting for confirmation (this may take several minutes)...");
    
    await advancedBot.deployTransaction.wait(1);
    console.log("Advanced ArbitrageBot deployed to:", advancedBot.address);
    
    // Check if this is mainnet or testnet based on network name
    const network = await ethers.provider.getNetwork();
    const isMainnet = network.name === "polygon" || network.chainId === 137;
    const networkSuffix = isMainnet ? "MAINNET" : "AMOY";
    
    console.log("\n-------------------------------------------------");
    console.log("Contracts deployed! Update your .env file with these addresses:");
    console.log(`ARBITRAGE_LOGGER_ADDRESS_${networkSuffix}=${arbitrageLogger.address}`);
    console.log(`ADVANCED_ARBITRAGE_BOT_ADDRESS_${networkSuffix}=${advancedBot.address}`);
    console.log("-------------------------------------------------\n");
    
  } catch (error) {
    console.error("Error deploying contracts:", error);
    if (error.transaction) {
      console.log("Transaction hash:", error.transaction.hash);
      console.log("Check status at:", `https://polygonscan.com/tx/${error.transaction.hash}`);
    }
  }
}

// Add a timeout to the entire process
const deploymentTimeout = 10 * 60 * 1000; // 10 minutes
const timeoutPromise = new Promise((_, reject) => {
  setTimeout(() => {
    reject(new Error(`Deployment timed out after ${deploymentTimeout/60000} minutes`));
  }, deploymentTimeout);
});

// Race the deployment against the timeout
Promise.race([main(), timeoutPromise])
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Deployment failed or timed out:", error.message);
    process.exit(1);
  });