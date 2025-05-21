// scripts/authorize-bot.js
const { ethers } = require("hardhat");
require("dotenv").config();

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Using account:", deployer.address);
  
  // Get addresses from environment variables
  const network = await ethers.provider.getNetwork();
  const isMainnet = network.name === "polygon" || network.chainId === 137;
  const networkSuffix = isMainnet ? "MAINNET" : "AMOY";
  
  const loggerAddress = process.env[`ARBITRAGE_LOGGER_ADDRESS_${networkSuffix}`];
  const botAddress = process.env[`ADVANCED_ARBITRAGE_BOT_ADDRESS_${networkSuffix}`];
  
  console.log(`Logger address: ${loggerAddress}`);
  console.log(`Bot address: ${botAddress}`);
  
  // Connect to the logger contract
  const ArbitrageLogger = await ethers.getContractFactory("ArbitrageLogger");
  const logger = await ArbitrageLogger.attach(loggerAddress);
  
  // Authorize the bot
  console.log(`Authorizing bot ${botAddress} in logger...`);
  const tx = await logger.setAuthorizedBot(botAddress, true);
  console.log("Transaction sent:", tx.hash);
  
  await tx.wait();
  console.log("Bot authorized successfully!");
  
  // Verify authorization
  const isAuthorized = await logger.authorizedBots(botAddress);
  console.log(`Is bot authorized? ${isAuthorized}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error authorizing bot:", error);
    process.exit(1);
  });