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
        : process.env.ADVANCED_ARBITRAGE_BOT_ADDRESS_MAINNET || process.env.ARBITRAGE_FLASH_LOAN_ADDRESS_MAINNET,
      quickswapRouter: isAmoy ? process.env.QUICKSWAP_ROUTER_AMOY : process.env.QUICKSWAP_ROUTER,
      sushiswapRouter: isAmoy ? process.env.SUSHISWAP_ROUTER_AMOY : process.env.SUSHISWAP_ROUTER,
      tokens: {
        DAI: isAmoy ? process.env.DAI_AMOY : process.env.DAI || "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
        USDC: isAmoy ? process.env.USDC_AMOY : process.env.USDC || "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
        USDT: isAmoy ? process.env.USDT_AMOY : process.env.USDT || "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
        WETH: isAmoy ? process.env.WETH_AMOY : process.env.WETH || "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
        WMATIC: isAmoy ? process.env.WMATIC_AMOY : process.env.WMATIC || "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270"
      },
      minProfitUsd: process.env.MIN_PROFIT_USD || "0.5", // Minimum profit in USD to execute trade
      tokenPairs: process.env.TOKEN_PAIRS,
      tokenPairNames: process.env.TOKEN_PAIR_NAMES
    };
  });
}

async function setupMonitoring() {
  console.log("Starting monitoring system...");
  
  // Using mainnet by default - you can change this to Amoy if needed for testing
  const provider = new ethers.providers.JsonRpcProvider(process.env.POLYGON_MAINNET_RPC_URL);
  
  // Fix for private key formatting
  let privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error("PRIVATE_KEY is missing in .env file");
    process.exit(1);
  }

  // Add '0x' prefix if not present
  if (!privateKey.startsWith('0x')) {
    privateKey = `0x${privateKey}`;
  }

  const wallet = new ethers.Wallet(privateKey, provider);
  
  // Check connection and get network config
  try {
    const blockNumber = await provider.getBlockNumber();
    const networkConfig = await getNetworkConfig(provider);
    
    console.log(`Connected to ${networkConfig.networkName}. Current block: ${blockNumber}`);
    console.log(`Flash loan contract: ${networkConfig.flashLoanContract}`);
    console.log(`Monitoring address: ${wallet.address}`);
    
    if (!networkConfig.flashLoanContract) {
      console.error(`No flash loan contract address found for ${networkConfig.networkName} in .env file`);
      process.exit(1);
    }
    
    // Initialize MEV protection with fixed private key
    const mevProtection = new MevProtection(provider, privateKey);
    
    // Initialize arbitrage detector with the correct contract address for this network
    const arbitrageDetector = new ArbitrageDetector(
      provider, 
      wallet,
      networkConfig.flashLoanContract,
      networkConfig.quickswapRouter,
      networkConfig.sushiswapRouter,
      networkConfig.tokens,
      parseFloat(networkConfig.minProfitUsd),
      networkConfig.tokenPairs,
      networkConfig.tokenPairNames
    );
    
    // Wait for token cache to initialize before monitoring
    console.log("Initializing token information...");
    await arbitrageDetector.initializeTokenCache();
    console.log("Token information initialized successfully");
    
    // Setup gas price monitoring
    // Add error handling to the gas price retrieval
provider.on("block", async (blockNumber) => {
  try {
    // Log new blocks
    console.log(`\n📦 New block: ${blockNumber}`);
    
    // Check gas price with error handling
    let gasPrice;
    try {
      gasPrice = await provider.getGasPrice();
      if (gasPrice === null || gasPrice === undefined) {
        console.error("Failed to get gas price - received null value");
        gasPrice = ethers.utils.parseUnits("50", "gwei"); // Use a fallback value
      }
    } catch (gasError) {
      console.error("Error fetching gas price:", gasError.message);
      gasPrice = ethers.utils.parseUnits("50", "gwei"); // Use a fallback value
    }
    
    const gasPriceGwei = ethers.utils.formatUnits(gasPrice, "gwei");
    console.log(`⛽ Current gas price: ${gasPriceGwei} gwei`);
    
    // Rest of your code...
    
  } catch (error) {
    console.error("Error in block monitoring:", error.message);
  }
});
    
    console.log("Monitoring system active and scanning for arbitrage opportunities...");
    console.log("Press Ctrl+C to exit");
  } catch (error) {
    console.error("Failed to connect to network:", error.message);
    process.exit(1);
  }
}

// Graceful shutdown process
process.on("SIGINT", () => {
  console.log("Shutting down monitoring system...");
  process.exit(0);
});

// Start the monitoring system
setupMonitoring().catch(console.error);