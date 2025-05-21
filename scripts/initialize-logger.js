// scripts/initialize-logger-with-gas.js
const { ethers } = require("hardhat");
require("dotenv").config();

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Initializing with account:", deployer.address);
  
  // Get the network name to decide which addresses to use
  const network = await ethers.provider.getNetwork();
  const isMainnet = network.name === "polygon" || network.chainId === 137;
  const networkSuffix = isMainnet ? "MAINNET" : "AMOY";
  
  // Get the bot address
  const botAddress = process.env[`ADVANCED_ARBITRAGE_BOT_ADDRESS_${networkSuffix}`];
  
  if (!botAddress) {
    throw new Error(`Bot address not found in .env file for ${networkSuffix}`);
  }
  
  console.log(`Initializing ArbitrageBot at address: ${botAddress}`);
  
  // Connect to the bot contract
  const AdvancedArbitrageBot = await ethers.getContractFactory("AdvancedArbitrageBot");
  const bot = await AdvancedArbitrageBot.attach(botAddress);
  
  // Initialize the logger with explicit gas
  console.log("Calling initializeLogger() with explicit gas limit...");
  const tx = await bot.initializeLogger({
    gasLimit: 500000,  // Use a higher gas limit
    gasPrice: (await ethers.provider.getGasPrice()).mul(120).div(100) // 20% higher
  });
  
  console.log("Transaction sent:", tx.hash);
  
  // Wait for confirmation
  console.log("Waiting for confirmation...");
  await tx.wait();
  console.log("Logger initialized successfully!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error initializing logger:", error);
    process.exit(1);
  });