const { ethers } = require("ethers");
const ArbitrageDetector = require("./arbitrage-detector");
const MevProtection = require("./mev-protection");
require("dotenv").config();

async function setupMonitoring() {
  console.log("Starting monitoring system...");
  
  // Setup provider with fallback
  const provider = new ethers.providers.JsonRpcProvider(
    `https://polygon-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`
  );
  
  // Check connection
  try {
    const blockNumber = await provider.getBlockNumber();
    console.log(`Connected to Polygon network. Current block: ${blockNumber}`);
  } catch (error) {
    console.error("Failed to connect to network:", error.message);
    process.exit(1);
  }
  
  // Get flash loan contract address from env
  const flashLoanContract = process.env.ADVANCED_ARBITRAGE_BOT_ADDRESS || 
                          process.env.ARBITRAGE_FLASH_LOAN_ADDRESS; 
  
  if (!flashLoanContract) {
    console.error("No flash loan contract address found in .env file");
    process.exit(1);
  }
  
  // Initialize MEV protection
  const mevProtection = new MevProtection(provider, process.env.PRIVATE_KEY);
  
  // Initialize arbitrage detector
  const arbitrageDetector = new ArbitrageDetector(provider, flashLoanContract);
  
  // Setup gas price monitoring
  provider.on("block", async (blockNumber) => {
    try {
      // Log new blocks
      console.log(`New block: ${blockNumber}`);
      
      // Check gas price
      const gasPrice = await provider.getGasPrice();
      const gasPriceGwei = ethers.utils.formatUnits(gasPrice, "gwei");
      
      console.log(`Current gas price: ${gasPriceGwei} gwei`);
      
      // Alert if gas price is very high (threshold could be in .env)
      const gasPriceThreshold = process.env.GAS_PRICE_THRESHOLD_GWEI || 100;
      if (parseFloat(gasPriceGwei) > gasPriceThreshold) {
        console.log("⚠️ WARNING: Gas price is very high! Pausing operations...");
        // In a real system, you would pause operations or adjust strategy
      }
    } catch (error) {
      console.error("Error in block monitoring:", error.message);
    }
  });
  
  // Start opportunity detection
  arbitrageDetector.monitorOpportunities();
  
  console.log("Monitoring system active and scanning for arbitrage opportunities...");
}

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("Shutting down monitoring system...");
  process.exit(0);
});

// Start the monitoring system
setupMonitoring().catch(console.error);