// scripts/fixed-simple-init.js
const { ethers } = require("hardhat");
require("dotenv").config();

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Using account:", deployer.address);
  
  // Get network info
  const network = await ethers.provider.getNetwork();
  const isMainnet = network.name === "polygon" || network.chainId === 137;
  const networkSuffix = isMainnet ? "MAINNET" : "AMOY";
  
  // Get addresses
  const botAddress = process.env[`ADVANCED_ARBITRAGE_BOT_ADDRESS_${networkSuffix}`];
  const loggerAddress = process.env[`ARBITRAGE_LOGGER_ADDRESS_${networkSuffix}`];
  
  console.log(`Bot address: ${botAddress}`);
  console.log(`Logger address: ${loggerAddress}`);
  
  // Connect to contracts
  const ArbitrageLogger = await ethers.getContractFactory("ArbitrageLogger");
  const logger = await ArbitrageLogger.attach(loggerAddress);
  
  // Attempt to log directly to verify it works
  console.log("Attempting to start execution directly on logger...");
  
  try {
    // Send the transaction and wait for it to be mined
    const tx = await logger.startExecution({ gasLimit: 300000 });
    console.log("Transaction sent:", tx.hash);
    
    const receipt = await tx.wait();
    console.log("Transaction confirmed in block:", receipt.blockNumber);
    
    // Check if there are any events emitted
    if (receipt.events && receipt.events.length > 0) {
      console.log("Events emitted:", receipt.events.length);
      for (const event of receipt.events) {
        console.log("Event:", event.event);
        if (event.args) {
          console.log("Args:", event.args);
        }
      }
    }
    
    // Use the executionCount to get the ID
    const executionCount = await logger.executionCount();
    console.log("Current execution count:", executionCount.toString());
    
    // Try to log a step using the current execution count
    console.log("Logging a step with execution count as ID...");
    const stepTx = await logger.logStep(executionCount, "TEST", "Direct test from script", { gasLimit: 300000 });
    console.log("Step log transaction sent:", stepTx.hash);
    
    const stepReceipt = await stepTx.wait();
    console.log("Step log confirmed in block:", stepReceipt.blockNumber);
    
    console.log("Direct logging successful!");
  } catch (error) {
    console.error("Error with direct logger interaction:", error);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });