const { ethers } = require("ethers");
require("dotenv").config();

async function main() {
  // Get token pairs from environment variables
  const tokenPairAddresses = (process.env.TOKEN_PAIRS || "").split(',');
  const tokenPairNames = (process.env.TOKEN_PAIR_NAMES || "").split(',');
  
  // Create token pairs array from env
  const tokenPairs = [];
  for (let i = 0; i < tokenPairAddresses.length; i++) {
    if (!tokenPairAddresses[i]) continue;
    
    const [token0, token1] = tokenPairAddresses[i].split(':');
    
    if (token0 && token1) {
      tokenPairs.push({
        token0: token0,
        token1: token1,
        name: (i < tokenPairNames.length) ? tokenPairNames[i] : `Pair ${i+1}`
      });
    }
  }
  
  if (tokenPairs.length === 0) {
    console.error("No token pairs defined in .env file");
    return;
  }

  // Router addresses from .env
  const QUICKSWAP_ROUTER = process.env.QUICKSWAP_ROUTER;
  const SUSHISWAP_ROUTER = process.env.SUSHISWAP_ROUTER;

  // Update the provider to use the full RPC URL directly
  const provider = new ethers.providers.JsonRpcProvider(process.env.POLYGON_MAINNET_RPC_URL);
  
  // Router ABI for price checks
  const routerAbi = [
    "function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)"
  ];
  
  const quickswapRouter = new ethers.Contract(QUICKSWAP_ROUTER, routerAbi, provider);
  const sushiswapRouter = new ethers.Contract(SUSHISWAP_ROUTER, routerAbi, provider);
  
  // Get interval from env with fallback
  const monitorInterval = parseInt(process.env.MONITOR_INTERVAL_MS || "10000");
  const priceDiffThreshold = parseFloat(process.env.PRICE_DIFFERENCE_THRESHOLD || "0.5");
  
  console.log(`Starting price monitoring for ${tokenPairs.length} pairs...`);
  console.log(`Using threshold: ${priceDiffThreshold}% and interval: ${monitorInterval}ms`);
  
  // Check prices periodically
  setInterval(async () => {
    for (const pair of tokenPairs) {
      try {
        const amountIn = ethers.utils.parseEther("1"); // 1 token
        const path = [pair.token0, pair.token1];
        
        // Get QuickSwap price
        const quickswapAmounts = await quickswapRouter.getAmountsOut(amountIn, path);
        const quickswapPrice = quickswapAmounts[1];
        
        // Get Sushiswap price
        const sushiswapAmounts = await sushiswapRouter.getAmountsOut(amountIn, path);
        const sushiswapPrice = sushiswapAmounts[1];
        
        // Calculate price difference
        const uniswapPriceFormatted = ethers.utils.formatUnits(quickswapPrice, 18);
        const sushiswapPriceFormatted = ethers.utils.formatUnits(sushiswapPrice, 18);
        
        const priceDiff = Math.abs(
          (parseFloat(uniswapPriceFormatted) / parseFloat(sushiswapPriceFormatted) - 1) * 100
        );
        
        console.log(`${pair.name} price difference: ${priceDiff.toFixed(4)}%`);
        
        if (priceDiff > priceDiffThreshold) {
          console.log(`Potential arbitrage opportunity found for ${pair.name}!`);
          // Here you could trigger your flash loan contract
        }
      } catch (error) {
        console.error(`Error checking prices for ${pair.name}:`, error.message);
      }
    }
  }, monitorInterval);
}

main().catch(console.error);