const { ethers } = require("ethers");
require("dotenv").config();

class ArbitrageDetector {
  constructor(provider, flashLoanContract) {
    this.provider = provider;
    this.flashLoanContract = flashLoanContract;
    this.walletKey = process.env.PRIVATE_KEY;
    this.wallet = new ethers.Wallet(this.walletKey, this.provider);
    
    // Contract addresses
    this.uniswapRouter = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
    this.sushiswapRouter = "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F";
    
    // ABI for router interaction
    this.routerAbi = [
      "function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)"
    ];
    
    // Create contract instances
    this.uniswapContract = new ethers.Contract(this.uniswapRouter, this.routerAbi, this.provider);
    this.sushiswapContract = new ethers.Contract(this.sushiswapRouter, this.routerAbi, this.provider);
    
    // Token list to monitor
    this.tokenPairs = [
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
  }
  
  async monitorOpportunities() {
    console.log("Starting arbitrage opportunity detection...");
    
    // Monitor prices at regular intervals
    setInterval(async () => {
      for (const pair of this.tokenPairs) {
        await this.checkArbitrageOpportunity(pair);
      }
    }, 10000);
  }
  
  async checkArbitrageOpportunity(pair) {
    try {
      const amountIn = ethers.utils.parseEther("1"); // 1 token
      const path = [pair.token0, pair.token1];
      
      // Get Uniswap price
      const uniswapAmounts = await this.uniswapContract.getAmountsOut(amountIn, path);
      const uniswapPrice = uniswapAmounts[1];
      
      // Get Sushiswap price
      const sushiswapAmounts = await this.sushiswapContract.getAmountsOut(amountIn, path);
      const sushiswapPrice = sushiswapAmounts[1];
      
      // Calculate price difference
      const priceDiff = Math.abs(
        (parseFloat(ethers.utils.formatUnits(uniswapPrice, 18)) / 
         parseFloat(ethers.utils.formatUnits(sushiswapPrice, 18)) - 1) * 100
      );
      
      console.log(`${pair.name} price difference: ${priceDiff.toFixed(4)}%`);
      
      // If significant price difference found
      if (priceDiff > 0.5) { // More than 0.5% difference
        console.log(`Potential arbitrage opportunity found for ${pair.name}!`);
        
        // Calculate optimal trade path
        let buyOnUniswap = parseFloat(ethers.utils.formatUnits(uniswapPrice, 18)) < 
                           parseFloat(ethers.utils.formatUnits(sushiswapPrice, 18));
        
        // Find optimal loan amount
        const optimalAmount = await this.calculateOptimalTradeSize(
          pair.token0,
          pair.token1,
          buyOnUniswap
        );
        
        // Execute if profitable
        if (optimalAmount.gt(0)) {
          await this.executeArbitrage(
            pair.token0,
            optimalAmount,
            pair.token1,
            buyOnUniswap
          );
        }
      }
    } catch (error) {
      console.error(`Error checking arbitrage for ${pair.name}:`, error.message);
    }
  }
  
  async calculateOptimalTradeSize(token0, token1, buyOnUniswap) {
    // In a real application, this would use a mathematical model
    // to find the optimal trade size considering slippage and gas costs
    
    // For learning purposes, we'll use a fixed amount
    return ethers.utils.parseEther("10"); // 10 ETH worth
  }
  
  async executeArbitrage(token0, amount, token1, buyOnUniswap) {
    try {
      // Prepare path data
      const path = [token0, token1];
      
      // Simple strategy encoding
      const strategyData = ethers.utils.defaultAbiCoder.encode(
        ["uint8", "address[]", "uint256[]", "address[]"],
        [
          1, // Strategy type 1: simple Uni/Sushi arbitrage
          path,
          [0, 0], // Min amounts out (would calculate proper values in production)
          [this.uniswapRouter, this.sushiswapRouter]
        ]
      );
      
      // Generate strategy hash to prevent front-running
      const secretHash = ethers.utils.keccak256(strategyData);
      
      // Create contract instance
      const advancedBot = new ethers.Contract(
        this.flashLoanContract,
        [
          "function executeArbitrage(address,uint256,bytes,bytes32) external"
        ],
        this.wallet
      );
      
      // Execute transaction
      console.log(`Executing arbitrage with ${ethers.utils.formatEther(amount)} ETH...`);
      
      const tx = await advancedBot.executeArbitrage(
        token0,
        amount,
        strategyData,
        secretHash,
        {
          gasLimit: 3000000,
          gasPrice: await this.provider.getGasPrice()
        }
      );
      
      console.log(`Transaction submitted: ${tx.hash}`);
      
      // Wait for confirmation
      const receipt = await tx.wait();
      console.log("Transaction confirmed!");
      
      // Look for events
      const events = receipt.events?.filter((e) => e.event === "ArbitrageExecuted");
      if (events && events.length > 0) {
        console.log(`Profit: ${ethers.utils.formatEther(events[0].args.profit)} ETH`);
      }
    } catch (error) {
      console.error("Error executing arbitrage:", error.message);
    }
  }
}

module.exports = ArbitrageDetector;