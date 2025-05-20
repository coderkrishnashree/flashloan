const { ethers } = require("ethers");
const ArbitrageDetector = require("./arbitrage-detector");
const MevProtection = require("./mev-protection");
require("dotenv").config();

// Function to determine the current network and use the appropriate variables
function getNetworkConfig(provider) {
  return provider.getNetwork().then(network => {
    // Chain ID 80002 is Polygon Amoy, 137 is Polygon Mainnet
    const isAmoy = network.chainId === 80002;
    
    return {
      networkName: isAmoy ? "Amoy Testnet" : "Polygon Mainnet",
      flashLoanContract: isAmoy 
        ? process.env.ADVANCED_ARBITRAGE_BOT_ADDRESS_AMOY || process.env.ARBITRAGE_FLASH_LOAN_ADDRESS_AMOY
        : process.env.ADVANCED_ARBITRAGE_BOT_ADDRESS_MAINNET || process.env.ARBITRAGE_FLASH_LOAN_ADDRESS_MAINNET
    };
  });
}

async function setupMonitoring() {
  console.log("Starting monitoring system...");
  
  // Using mainnet by default - you can change this to Amoy if needed for testing
  const provider = new ethers.providers.JsonRpcProvider(process.env.POLYGON_MAINNET_RPC_URL);
  
  // Check connection and get network config
  try {
    const blockNumber = await provider.getBlockNumber();
    const networkConfig = await getNetworkConfig(provider);
    
    console.log(`Connected to ${networkConfig.networkName}. Current block: ${blockNumber}`);
    
    if (!networkConfig.flashLoanContract) {
      console.error(`No flash loan contract address found for ${networkConfig.networkName} in .env file`);
      process.exit(1);
    }
    
    // Initialize MEV protection
    const mevProtection = new MevProtection(provider, process.env.PRIVATE_KEY);
    
    // Initialize arbitrage detector with the correct contract address for this network
    const arbitrageDetector = new ArbitrageDetector(provider, networkConfig.flashLoanContract);
    
    // Setup gas price monitoring
    provider.on("block", async (blockNumber) => {
      try {
        // Log new blocks
        console.log(`New block: ${blockNumber}`);
        
        // Check gas price
        const gasPrice = await provider.getGasPrice();
        const gasPriceGwei = ethers.utils.formatUnits(gasPrice, "gwei");
        
        console.log(`Current gas price: ${gasPriceGwei} gwei`);
        
        // Alert if gas price is very high
        const gasPriceThreshold = process.env.GAS_PRICE_THRESHOLD_GWEI || 100;
        if (parseFloat(gasPriceGwei) > gasPriceThreshold) {
          console.log("⚠️ WARNING: Gas price is very high! Pausing operations...");
        }
      } catch (error) {
        console.error("Error in block monitoring:", error.message);
      }
    });
    
    // Start opportunity detection
    arbitrageDetector.monitorOpportunities();
    
    console.log("Monitoring system active and scanning for arbitrage opportunities...");
  } catch (error) {
    console.error("Failed to connect to network:", error.message);
    process.exit(1);
  }
}

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("Shutting down monitoring system...");
  process.exit(0);
});

// Start the monitoring system
setupMonitoring().catch(console.error);