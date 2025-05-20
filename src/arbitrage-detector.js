const { ethers } = require("ethers");
require("dotenv").config();

class ArbitrageDetector {
  constructor(provider, flashLoanContract) {
    this.provider = provider;
    this.flashLoanContract = flashLoanContract;
    this.walletKey = process.env.PRIVATE_KEY;
    this.wallet = new ethers.Wallet(this.walletKey, this.provider);
    
    // Get router addresses from .env
    this.quickswapRouter = process.env.QUICKSWAP_ROUTER;
    this.sushiswapRouter = process.env.SUSHISWAP_ROUTER;
    
    // ABI for router interaction
    this.routerAbi = [
      "function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)"
    ];
    
    // Create contract instances - fix the inconsistency here
    this.quickswapContract = new ethers.Contract(this.quickswapRouter, this.routerAbi, this.provider);
    this.sushiswapContract = new ethers.Contract(this.sushiswapRouter, this.routerAbi, this.provider);
    
    // Parse token pairs from environment variables
    this.tokenPairs = this.parseTokenPairs();
    
    // Get threshold from env with fallback
    this.priceDiffThreshold = parseFloat(process.env.PRICE_DIFFERENCE_THRESHOLD || "0.5");
    this.monitorInterval = parseInt(process.env.MONITOR_INTERVAL_MS || "10000");
  }
  
  parseTokenPairs() {
    // Parse TOKEN_PAIRS and TOKEN_PAIR_NAMES from .env
    const tokenPairAddresses = (process.env.TOKEN_PAIRS || "").split(',');
    const tokenPairNames = (process.env.TOKEN_PAIR_NAMES || "").split(',');
    
    const pairs = [];
    
    for (let i = 0; i < tokenPairAddresses.length; i++) {
      if (!tokenPairAddresses[i]) continue;
      
      const [token0, token1] = tokenPairAddresses[i].split(':');
      
      if (token0 && token1) {
        pairs.push({
          token0: token0,
          token1: token1,
          name: (i < tokenPairNames.length) ? tokenPairNames[i] : `Pair ${i+1}`
        });
      }
    }
    
    return pairs;
  }
  
  async monitorOpportunities() {
    console.log("Starting arbitrage opportunity detection...");
    console.log(`Monitoring ${this.tokenPairs.length} token pairs with ${this.priceDiffThreshold}% threshold`);
    
    // Monitor prices at regular intervals
    setInterval(async () => {
      for (const pair of this.tokenPairs) {
        await this.checkArbitrageOpportunity(pair);
      }
    }, this.monitorInterval);
  }
  
  async checkArbitrageOpportunity(pair) {
    try {
      const amountIn = ethers.utils.parseEther("1"); // 1 token
      const path = [pair.token0, pair.token1];
      
      // Get QuickSwap price
      const quickswapAmounts = await this.quickswapContract.getAmountsOut(amountIn, path);
      const quickswapPrice = quickswapAmounts[1];
      
      // Get Sushiswap price
      const sushiswapAmounts = await this.sushiswapContract.getAmountsOut(amountIn, path);
      const sushiswapPrice = sushiswapAmounts[1];
      
      // Calculate price difference
      const priceDiff = Math.abs(
        (parseFloat(ethers.utils.formatUnits(quickswapPrice, 18)) / 
         parseFloat(ethers.utils.formatUnits(sushiswapPrice, 18)) - 1) * 100
      );
      
      console.log(`${pair.name} price difference: ${priceDiff.toFixed(4)}%`);
      
      // If significant price difference found
      if (priceDiff > this.priceDiffThreshold) {
        console.log(`Potential arbitrage opportunity found for ${pair.name}!`);
        
        // Calculate optimal trade path
        let buyOnQuickswap = parseFloat(ethers.utils.formatUnits(quickswapPrice, 18)) < 
                           parseFloat(ethers.utils.formatUnits(sushiswapPrice, 18));
        
        // Find optimal loan amount
        const optimalAmount = await this.calculateOptimalTradeSize(
          pair.token0,
          pair.token1,
          buyOnQuickswap
        );
        
        // Execute if profitable
        if (optimalAmount.gt(0)) {
          await this.executeArbitrage(
            pair.token0,
            optimalAmount,
            pair.token1,
            buyOnQuickswap
          );
        }
      }
    } catch (error) {
      console.error(`Error checking arbitrage for ${pair.name}:`, error.message);
    }
  }
  
  async calculateOptimalTradeSize(token0, token1, buyOnQuickswap) {
    try {
      // Get token information for correct decimal handling
      const tokenContract = new ethers.Contract(
        token0,
        ["function decimals() view returns (uint8)"],
        this.provider
      );
      
      // Try to get decimals, fallback to 18 if it fails
      let decimals = 18;
      try {
        decimals = await tokenContract.decimals();
      } catch (e) {
        console.warn(`Could not get decimals for ${token0}, using default of 18`);
      }
      
      // Calculate gas costs for this transaction (estimate)
      const gasPrice = await this.provider.getGasPrice();
      const gasCost = gasPrice.mul(3000000); // Estimated gas limit
      const gasCostInEth = parseFloat(ethers.utils.formatEther(gasCost));
      
      // Minimum profit threshold from .env (convert to ETH)
      const minProfitThreshold = parseFloat(process.env.MIN_PROFIT_THRESHOLD || "0.01");
      
      // Add safety margin to ensure profit covers gas
      const targetProfit = minProfitThreshold + gasCostInEth;
      
      // In a real system, we would test different loan sizes here
      // For now, use a simple approach based on the target profit
      
      // Start with a moderate amount 
      return ethers.utils.parseUnits("10", decimals);
    } catch (error) {
      console.error("Error calculating optimal trade size:", error.message);
      return ethers.constants.Zero;
    }
  }
  
  async executeArbitrage(token0, amount, token1, buyOnQuickswap) {
    try {
      // Prepare path data
      const path = [token0, token1];
      
      // Simple strategy encoding
      const strategyData = ethers.utils.defaultAbiCoder.encode(
        ["uint8", "address[]", "uint256[]", "address[]"],
        [
          1, // Strategy type 1: simple QuickSwap/Sushi arbitrage
          path,
          [0, 0], // Min amounts out (would calculate proper values in production)
          buyOnQuickswap ? 
            [this.quickswapRouter, this.sushiswapRouter] : 
            [this.sushiswapRouter, this.quickswapRouter]
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
      console.log(`Executing arbitrage with ${ethers.utils.formatEther(amount)} tokens...`);
      
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