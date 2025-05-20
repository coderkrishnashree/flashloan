const { ethers } = require("ethers");
require("dotenv").config();

async function main() {
// Define token pairs to monitor
const tokenPairs = [
  {
    token0: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", // WMATIC
    token1: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063", // DAI on Polygon
    name: "WMATIC/DAI"
  },
  {
    token0: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", // WMATIC
    token1: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", // USDC on Polygon
    name: "WMATIC/USDC"
  }
];

// Router addresses
const QUICKSWAP_ROUTER = "0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff";
const SUSHISWAP_ROUTER = "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506";

// Update the provider
const provider = new ethers.providers.JsonRpcProvider(
  `https://polygon-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`
);
  
  // Router ABI for price checks
  const routerAbi = [
    "function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)"
  ];
  
  const uniswapRouter = new ethers.Contract(UNISWAP_ROUTER, routerAbi, provider);
  const sushiswapRouter = new ethers.Contract(SUSHISWAP_ROUTER, routerAbi, provider);
  
  console.log("Starting price monitoring...");
  
  // Check prices every 10 seconds
  setInterval(async () => {
    for (const pair of tokenPairs) {
      try {
        const amountIn = ethers.utils.parseEther("1"); // 1 token
        const path = [pair.token0, pair.token1];
        
        // Get Uniswap price
        const uniswapAmounts = await uniswapRouter.getAmountsOut(amountIn, path);
        const uniswapPrice = uniswapAmounts[1];
        
        // Get Sushiswap price
        const sushiswapAmounts = await sushiswapRouter.getAmountsOut(amountIn, path);
        const sushiswapPrice = sushiswapAmounts[1];
        
        // Calculate price difference
        const uniswapPriceFormatted = ethers.utils.formatUnits(uniswapPrice, 18);
        const sushiswapPriceFormatted = ethers.utils.formatUnits(sushiswapPrice, 18);
        
        const priceDiff = Math.abs(
          (parseFloat(uniswapPriceFormatted) / parseFloat(sushiswapPriceFormatted) - 1) * 100
        );
        
        console.log(`${pair.name} price difference: ${priceDiff.toFixed(4)}%`);
        
        if (priceDiff > 0.5) { // More than 0.5% difference
          console.log(`Potential arbitrage opportunity found for ${pair.name}!`);
          // Here you could trigger your flash loan contract
        }
      } catch (error) {
        console.error(`Error checking prices for ${pair.name}:`, error.message);
      }
    }
  }, 10000);
}

main().catch(console.error);