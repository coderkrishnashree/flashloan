const { ethers } = require("ethers");
require("dotenv").config();

async function main() {
  // Setup provider
  const provider = new ethers.providers.JsonRpcProvider(`https://mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`);
  
  // Define token pairs to monitor
  const tokenPairs = [
    {
      token0: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH
      token1: "0x6B175474E89094C44Da98b954EedeAC495271d0F", // DAI
      name: "WETH/DAI"
    },
    {
      token0: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH
      token1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
      name: "WETH/USDC"
    }
  ];
  
  // Router addresses
  const UNISWAP_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
  const SUSHISWAP_ROUTER = "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F";
  
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