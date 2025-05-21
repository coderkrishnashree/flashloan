// scripts/stepwise-init.js
const { ethers } = require("hardhat");
require("dotenv").config();

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Using account:", deployer.address);
  
  // Get addresses
  const network = await ethers.provider.getNetwork();
  const isMainnet = network.name === "polygon" || network.chainId === 137;
  const networkSuffix = isMainnet ? "MAINNET" : "AMOY";
  
  const botAddress = process.env[`ADVANCED_ARBITRAGE_BOT_ADDRESS_${networkSuffix}`];
  const loggerAddress = process.env[`ARBITRAGE_LOGGER_ADDRESS_${networkSuffix}`];
  
  console.log(`Bot address: ${botAddress}`);
  console.log(`Logger address: ${loggerAddress}`);
  
  // Connect to contracts
  const ArbitrageLogger = await ethers.getContractFactory("ArbitrageLogger");
  const logger = await ArbitrageLogger.attach(loggerAddress);
  
  // Create a custom function that will mimic what the initializeLogger function is doing
  console.log("\nManually executing the initialization steps...");
  
  // Step 1: Check if bot is already authorized
  const isAuthorized = await logger.authorizedBots(botAddress);
  console.log(`Is bot already authorized: ${isAuthorized}`);
  
  // Step 2: If not authorized, authorize it
  if (!isAuthorized) {
    console.log("Authorizing bot...");
    const authTx = await logger.setAuthorizedBot(botAddress, true, { gasLimit: 300000 });
    console.log("Authorization tx sent:", authTx.hash);
    await authTx.wait();
    console.log("Bot authorized successfully!");
  }
  
  // Step 3: Start execution
  console.log("Starting execution...");
  const execTx = await logger.startExecution({ gasLimit: 300000 });
  console.log("Start execution tx sent:", execTx.hash);
  const execReceipt = await execTx.wait();
  console.log("Execution started in block:", execReceipt.blockNumber);
  
  // Get the execution ID from the event
  let executionId;
  if (execReceipt.events && execReceipt.events.length > 0) {
    for (const event of execReceipt.events) {
      if (event.event === "ExecutionProgress" && event.args) {
        executionId = event.args.id;
        console.log("Got execution ID from event:", executionId.toString());
      }
    }
  }
  
  // Fallback to using the execution count
  if (!executionId) {
    executionId = await logger.executionCount();
    console.log("Using execution count as ID:", executionId.toString());
  }
  
  // Step 4: Log a step using the execution ID
  console.log("Logging initialization step...");
  const stepTx = await logger.logStep(executionId, "INIT", "Bot initialized manually", { gasLimit: 300000 });
  console.log("Log step tx sent:", stepTx.hash);
  const stepReceipt = await stepTx.wait();
  console.log("Step logged in block:", stepReceipt.blockNumber);
  
  console.log("\nManual initialization completed successfully!");
  console.log("This proves all the individual steps work when done manually.");
  console.log("The issue is likely in how the contract is handling the return value from startExecution().");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });