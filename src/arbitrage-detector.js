const { ethers } = require("ethers");

// ABI definitions for interacting with routers and tokens
const ERC20_ABI = [
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
  "function name() external view returns (string)",
  "function balanceOf(address) external view returns (uint256)"
];

const ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)"
];

const FLASH_LOAN_BOT_ABI = [
  "function executeArbitrage(address _asset, uint256 _amount, bytes calldata _strategyData, bytes32 _secretHash) external"
];

// Set of verified pairs that have liquidity on both exchanges
const VERIFIED_PAIRS = new Set();

class ArbitrageDetector {
  constructor(provider, wallet, flashLoanContractAddress, quickswapRouterAddress, sushiswapRouterAddress, tokens, minProfitUsd, tokenPairsString, tokenPairNamesString) {
    this.provider = provider;
    this.wallet = wallet;
    this.flashLoanContractAddress = flashLoanContractAddress;
    this.quickswapRouterAddress = quickswapRouterAddress;
    this.sushiswapRouterAddress = sushiswapRouterAddress;
    this.tokens = tokens;
    this.minProfitUsd = minProfitUsd;
    this.tokenPairsString = tokenPairsString;
    this.tokenPairNamesString = tokenPairNamesString;
    
    // Initialize contracts
    this.quickswapRouter = new ethers.Contract(quickswapRouterAddress, ROUTER_ABI, provider);
    this.sushiswapRouter = new ethers.Contract(sushiswapRouterAddress, ROUTER_ABI, provider);
    this.flashLoanBot = new ethers.Contract(flashLoanContractAddress, FLASH_LOAN_BOT_ABI, wallet);
    
    // Token cache
    this.tokenCache = {};
    
    // Status table
    this.statusTable = {};
    this.profitableCount = 0;
    
    // Track execution history
    this.executionHistory = [];
    this.isExecuting = false;
    this.currentBlock = 0;
    this.currentGasPrice = null;
    
    // Table display control
    this.lastTableUpdate = 0;
    this.updateNeeded = false;
    
    // Rate limit protection
    this.pairCheckQueue = [];
    this.isProcessingQueue = false;
    this.lastCheckTime = 0;
    this.checkDelay = 200; // 200ms delay between checks to avoid rate limiting
    
    // Debug mode
    this.debugMode = true;
    
    console.log("Arbitrage Detector initialized with:");
    console.log(`- QuickSwap Router: ${quickswapRouterAddress}`);
    console.log(`- SushiSwap Router: ${sushiswapRouterAddress}`);
    console.log(`- Flash Loan Bot: ${flashLoanContractAddress}`);
    console.log(`- Min Profit USD: $${minProfitUsd}`);
  }
  
  async initializeTokenCache() {
    console.log("Loading token details...");
    console.log("Available tokens in configuration:");
    Object.entries(this.tokens).forEach(([key, value]) => {
      console.log(`- ${key}: ${value}`);
    });
    
    // Create an array of promises for loading all tokens
    const tokenPromises = [];
    
    // Standard token addresses to ensure we have them
    const standardTokenAddresses = {
      // Stablecoins
      "DAI": "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
      "USDC": "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
      "USDT": "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
      
      // Major tokens
      "WETH": "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
      "WMATIC": "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
      "WBTC": "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6",
      
      // DeFi tokens
      "AAVE": "0xD6DF932A45C0f255f85145f286eA0b292B21C90B",
      "LINK": "0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39",
      "QUICK": "0x831753DD7087CaC61aB5644b308642cc1c33Dc13",
      "SUSHI": "0x0b3F868E0BE5597D5DB7fEB59E1CADBb0fdDa50a",
      "CRV": "0x172370d5Cd63279eFa6d502DAB29171933a610AF",
      "FRAX": "0x104592a158490a9228070E0A8e5343B499e125D0",
      
      // More volatile tokens
      "SAND": "0xBbba073C31bF03b8ACf7c28EF0738DeCF3695683",
      "GALA": "0x09E1943Dd2A4e82032773594f50CF54453000b97",
      "AXS": "0x61BDD9C7d4dF4Bf47A4508c0c8245505F2Af5b7b"
    };
    
    // Merge standard addresses with ones from config
    const allTokens = { ...standardTokenAddresses, ...this.tokens };
    
    for (const [key, tokenAddress] of Object.entries(allTokens)) {
      if (!tokenAddress) continue;
      
      const promise = (async () => {
        try {
          const token = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
          const [decimals, symbol, name] = await Promise.all([
            token.decimals(),
            token.symbol(),
            token.name()
          ]);
          
          this.tokenCache[tokenAddress] = {
            address: tokenAddress,
            decimals,
            symbol,
            name,
            contract: token
          };
          
          // Also store token by symbol for easier lookup
          this.tokens[key] = tokenAddress;
          
          console.log(`✅ Loaded token: ${symbol} (${name}) - ${tokenAddress}`);
        } catch (error) {
          console.error(`❌ Failed to load token ${key} at ${tokenAddress}: ${error.message}`);
        }
      })();
      
      tokenPromises.push(promise);
    }
    
    // Wait for all tokens to be loaded
    await Promise.all(tokenPromises);
    console.log("Token cache initialized with", Object.keys(this.tokenCache).length, "tokens");
    
    // Define ALL token pairs - ONLY pairs with DAI
    const daiAddress = this.tokens.DAI;
    if (!daiAddress) {
      console.error("DAI token address not found! Cannot set up pairs.");
      return;
    }
    
    const allPairs = [];
    
    // Add every token as a pair with DAI
    for (const [key, tokenAddress] of Object.entries(this.tokens)) {
      if (key === "DAI" || !tokenAddress) continue;
      
      allPairs.push({
        from: daiAddress,
        to: tokenAddress,
        name: `DAI-${key}`,
        tokenKey: key
      });
    }
    
    console.log(`Generated ${allPairs.length} DAI pairs from tokens`);
    
    // Filter out any pairs with undefined tokens
    this.tokenPairs = allPairs.filter(pair => {
      const fromValid = pair.from && this.tokenCache[pair.from];
      const toValid = pair.to && this.tokenCache[pair.to];
      
      if (!fromValid || !toValid) {
        console.log(`⚠️ Skipping invalid pair: ${pair.name} (missing tokens)`);
      }
      
      return fromValid && toValid;
    });
    
    console.log(`\nWill monitor the following ${this.tokenPairs.length} DAI pairs:`);
    this.tokenPairs.forEach(pair => {
      const fromSymbol = this.tokenCache[pair.from]?.symbol || 'Unknown';
      const toSymbol = this.tokenCache[pair.to]?.symbol || 'Unknown';
      console.log(`- ${fromSymbol}/${toSymbol}`);
    });
    
    if (this.tokenPairs.length === 0) {
      console.error("⚠️ WARNING: No valid token pairs found! Check your token addresses.");
    }
    
    // Initialize liquidity validation
    await this.validatePairLiquidity();
    
    console.log("\nStarting monitoring. Table will refresh every 3 seconds...");
    console.log("==========================================");
  }
  
  async validatePairLiquidity() {
    console.log("\nValidating liquidity for all pairs...");
    const validationPromises = this.tokenPairs.map(async pair => {
      const fromToken = this.tokenCache[pair.from];
      const toToken = this.tokenCache[pair.to];
      
      if (!fromToken || !toToken) return false;
      
      const pairKey = `${fromToken.symbol}/${toToken.symbol}`;
      
      try {
        // Check both QuickSwap and SushiSwap for liquidity
        const quickswapLiquidity = await this.checkPairLiquidity(
          this.quickswapRouter, fromToken, toToken
        );
        
        const sushiswapLiquidity = await this.checkPairLiquidity(
          this.sushiswapRouter, fromToken, toToken
        );
        
        const hasLiquidity = quickswapLiquidity && sushiswapLiquidity;
        
        if (hasLiquidity) {
          console.log(`✅ ${pairKey} has liquidity on both exchanges`);
          VERIFIED_PAIRS.add(pairKey);
          
          // Add to status table with initial status
          this.statusTable[pairKey] = {
            quickPrice: "Checking...",
            sushiPrice: "Checking...",
            diffPct: "Checking...",
            direction: "Checking...",
            gasCost: "Checking...",
            status: "Valid Pair"
          };
        } else {
          console.log(`❌ ${pairKey} missing liquidity on ${!quickswapLiquidity ? 'QuickSwap' : ''}${!quickswapLiquidity && !sushiswapLiquidity ? ' and ' : ''}${!sushiswapLiquidity ? 'SushiSwap' : ''}`);
          
          // Don't add invalid pairs to the status table at all
        }
        
        return hasLiquidity;
      } catch (error) {
        console.error(`Error validating ${pairKey} liquidity: ${error.message}`);
        return false;
      }
    });
    
    const results = await Promise.all(validationPromises);
    const validPairCount = results.filter(Boolean).length;
    
    console.log(`\nLiquidity validation complete: ${validPairCount} out of ${this.tokenPairs.length} pairs have liquidity`);
    
    // Print initial status table with valid pairs
    this.printStatusTable(true);
    
    return validPairCount;
  }
  
  // Check if a pair has liquidity on a given DEX
  async checkPairLiquidity(router, fromToken, toToken) {
    try {
      // Use a small amount for the check to minimize gas usage
      const smallAmount = ethers.utils.parseUnits("0.1", fromToken.decimals);
      
      // Try to get a quote - if this succeeds, the pool exists and has liquidity
      const amounts = await router.getAmountsOut(smallAmount, [fromToken.address, toToken.address]);
      
      // Verify that we get a non-zero output amount
      return amounts && amounts.length > 1 && amounts[1].gt(0);
    } catch (error) {
      // The call threw an error, which means the pair doesn't exist or has no liquidity
      return false;
    }
  }
  
  async checkOpportunities(blockNumber, gasPrice) {
    // Skip if already executing a trade
    if (this.isExecuting) {
      console.log("Skipping opportunity check: Already executing a trade");
      return;
    }
    
    // Update current block and gas price
    this.currentBlock = blockNumber;
    this.currentGasPrice = gasPrice;
    this.updateNeeded = true;
    
    // Force table print on new block
    if (blockNumber % 5 === 0) {
      this.printStatusTable(true);
    }
    
    // Only check verified pairs that have liquidity on both exchanges
    const verifiedPairs = this.tokenPairs.filter(pair => {
      const fromToken = this.tokenCache[pair.from];
      const toToken = this.tokenCache[pair.to];
      if (!fromToken || !toToken) return false;
      
      const pairKey = `${fromToken.symbol}/${toToken.symbol}`;
      return VERIFIED_PAIRS.has(pairKey);
    });
    
    if (this.debugMode) {
      console.log(`Checking ${verifiedPairs.length} valid pairs for arbitrage opportunities...`);
    }
    
    // Check each verified pair for arbitrage opportunities with a queue to avoid rate limiting
    this.pairCheckQueue = [...verifiedPairs];
    await this.processQueue();
    
    // Update table periodically
    const now = Date.now();
    if (this.updateNeeded && (now - this.lastTableUpdate > 3000)) {
      this.printStatusTable();
      this.lastTableUpdate = now;
      this.updateNeeded = false;
    }
  }
  
// Process the queue of pairs to check, with rate limiting
// Process the queue of pairs to check, with rate limiting
async processQueue() {
    if (this.isProcessingQueue) return;
    
    this.isProcessingQueue = true;
    
    try {
      // Copy the queue to avoid modification issues during iteration
      const pairsToCheck = [...this.pairCheckQueue];
      this.pairCheckQueue = [];
      
      for (const pair of pairsToCheck) {
        // Implement rate limiting to avoid overwhelming the RPC provider
        const now = Date.now();
        const timeSinceLastCheck = now - this.lastCheckTime;
        
        if (timeSinceLastCheck < this.checkDelay) {
          await new Promise(resolve => setTimeout(resolve, this.checkDelay - timeSinceLastCheck));
        }
        
        this.lastCheckTime = Date.now();
        
        // Check this pair
        await this.checkPairArbitrage(pair, this.currentBlock, this.currentGasPrice);
      }
    } catch (error) {
      console.error("Error processing queue:", error.message);
    } finally {
      this.isProcessingQueue = false;
    }
  }
  
  printStatusTable(force = false) {
    // Only update if forced or enough time has passed
    const now = Date.now();
    if (!force && now - this.lastTableUpdate < 3000) {
      return;
    }
    
    this.lastTableUpdate = now;
    
    // Clear console and print header
    console.log("\n\n");
    console.log("====================================================================================");
    console.log(`📊 ARBITRAGE MONITOR - Block: ${this.currentBlock} - Gas: ${ethers.utils.formatUnits(this.currentGasPrice, "gwei")} gwei - ${new Date().toLocaleTimeString()}`);
    console.log("====================================================================================");
    console.log("PAIR          | QUICK PRICE   | SUSHI PRICE   | DIFF %       | DIRECTION     | GAS COST($)  | STATUS       ");
    console.log("------------------------------------------------------------------------------------");
    
    // Only show pairs that are in the VERIFIED_PAIRS set
    const pairNames = Object.keys(this.statusTable)
      .filter(pairName => VERIFIED_PAIRS.has(pairName))
      .sort((a, b) => {
        const aStatus = this.statusTable[a].status || "";
        const bStatus = this.statusTable[b].status || "";
        const aProfitable = aStatus.includes("Profitable");
        const bProfitable = bStatus.includes("Profitable");
        
        if (aProfitable && !bProfitable) return -1;
        if (!aProfitable && bProfitable) return 1;
        
        // If both have same profit status, sort by difference
        const aDiff = parseFloat((this.statusTable[a].diffPct || "0%").replace("%", ""));
        const bDiff = parseFloat((this.statusTable[b].diffPct || "0%").replace("%", ""));
        return bDiff - aDiff;
      });
    
    // Print each pair's status
    let rowCount = 0;
    for (const pairName of pairNames) {
      const status = this.statusTable[pairName];
      if (!status) continue;
      
      // Format columns to fixed width
      const pair = pairName.padEnd(14);
      const quickPrice = (status.quickPrice || "N/A").toString().padEnd(14);
      const sushiPrice = (status.sushiPrice || "N/A").toString().padEnd(14); 
      const diffPct = (status.diffPct || "N/A").toString().padEnd(14);
      const direction = (status.direction || "N/A").toString().padEnd(14);
      const gasCost = (status.gasCost || "N/A").toString().padEnd(14);
      const statusText = (status.status || "N/A").toString().padEnd(14);
      
      console.log(`${pair}| ${quickPrice}| ${sushiPrice}| ${diffPct}| ${direction}| ${gasCost}| ${statusText}`);
      rowCount++;
    }
    
    // If no pairs have been checked yet
    if (rowCount === 0) {
      console.log("No valid pairs found - check token addresses and liquidity");
    } else if (this.debugMode) {
      console.log(`Showing ${rowCount} valid pairs with liquidity on both exchanges`);
    }
    
    console.log("------------------------------------------------------------------------------------");
    // Bottom status line
    if (this.profitableCount > 0) {
      console.log(`🔍 Found ${this.profitableCount} profitable opportunities above threshold ($${this.minProfitUsd})`);
    } else {
      console.log("No profitable opportunities found yet");
    }
    console.log("====================================================================================");
  }
  
  async checkPairArbitrage(pair, blockNumber, gasPrice) {
    const { from, to, name } = pair;
    
    if (!this.tokenCache[from] || !this.tokenCache[to]) {
      if (this.debugMode) {
        console.error(`Token details not found for ${name}:`);
        console.error(`- From token (${from}): ${this.tokenCache[from] ? 'Found' : 'Missing'}`);
        console.error(`- To token (${to}): ${this.tokenCache[to] ? 'Found' : 'Missing'}`);
      }
      return;
    }
    
    const fromToken = this.tokenCache[from];
    const toToken = this.tokenCache[to];
    
    // Create a key for this pair
    const pairKey = `${fromToken.symbol}/${toToken.symbol}`;
    
    // Skip pairs that haven't been verified to have liquidity
    if (!VERIFIED_PAIRS.has(pairKey)) {
      // Only log in debug mode to avoid console spam
      if (this.debugMode) {
        console.log(`Skipping ${pairKey}: Not verified to have liquidity on both exchanges`);
      }
      return;
    }
    
    try {
      // Get price quotes for a standard amount
      const standardAmount = ethers.utils.parseUnits("1", fromToken.decimals);
      
      // QuickSwap price
      const quickAmounts = await this.quickswapRouter.getAmountsOut(standardAmount, [from, to]);
      const quickPrice = quickAmounts[1];
      const quickPriceFormatted = ethers.utils.formatUnits(
        quickPrice,
        toToken.decimals
      );
      
      // SushiSwap price
      const sushiAmounts = await this.sushiswapRouter.getAmountsOut(standardAmount, [from, to]);
      const sushiPrice = sushiAmounts[1];
      const sushiPriceFormatted = ethers.utils.formatUnits(
        sushiPrice,
        toToken.decimals
      );
      
      // Calculate price difference and determine better route
      const quickHigher = quickPrice.gt(sushiPrice);
      const priceDiff = quickHigher
        ? ((parseFloat(quickPriceFormatted) / parseFloat(sushiPriceFormatted) - 1) * 100)
        : ((parseFloat(sushiPriceFormatted) / parseFloat(quickPriceFormatted) - 1) * 100);
      
      // Calculate gas cost in USD
      const gasLimit = 700000; // Based on your contract's gas usage
      const gasCostWei = gasPrice.mul(gasLimit);
      const gasCostMatic = parseFloat(ethers.utils.formatEther(gasCostWei));
      const gasCostUsd = gasCostMatic * 0.5; // Assuming MATIC price of $0.5
      
      // Update status table with current prices
      this.statusTable[pairKey] = {
        quickPrice: quickPriceFormatted.substring(0, 8),
        sushiPrice: sushiPriceFormatted.substring(0, 8),
        diffPct: priceDiff.toFixed(4) + "%",
        direction: quickHigher ? "Quick>Sushi" : "Sushi>Quick",
        gasCost: `$${gasCostUsd.toFixed(2)}`,
        status: priceDiff > 0.1 ? "Analyzing..." : "No Arb"
      };
      
      let bestOpportunity = null;
      
      // Only proceed with detailed analysis if the difference is significant
      if (priceDiff > 0.1) {
        const amountsToTry = [
          ethers.utils.parseUnits("1", fromToken.decimals),
          ethers.utils.parseUnits("10", fromToken.decimals),
          ethers.utils.parseUnits("100", fromToken.decimals),
          ethers.utils.parseUnits("1000", fromToken.decimals)
        ];
        
        for (const amount of amountsToTry) {
          try {
            // Check first route (buy on lower price DEX, sell on higher price DEX)
            const route1Result = await this.checkRouteArbitrage(
              amount,
              fromToken,
              toToken,
              quickHigher ? this.sushiswapRouter : this.quickswapRouter, // Buy on lower price
              quickHigher ? this.quickswapRouter : this.sushiswapRouter, // Sell on higher price
              quickHigher ? "SushiSwap" : "QuickSwap",
              quickHigher ? "QuickSwap" : "SushiSwap",
              gasPrice
            );
            
            if (route1Result && (!bestOpportunity || route1Result.profitUsd > bestOpportunity.profitUsd)) {
              bestOpportunity = route1Result;
            }
          } catch (error) {
            // Skip this amount if there's an error
            if (this.debugMode) {
              console.error(`Error checking ${pairKey} with amount ${amount.toString()}: ${error.message}`);
            }
            continue;
          }
        }
      }
      
      // Update status table with results
      if (bestOpportunity) {
        const isProfitable = bestOpportunity.profitUsd >= this.minProfitUsd;
        
        this.statusTable[pairKey] = {
          quickPrice: quickPriceFormatted.substring(0, 8),
          sushiPrice: sushiPriceFormatted.substring(0, 8),
          diffPct: priceDiff.toFixed(4) + "%",
          direction: quickHigher ? "Quick>Sushi" : "Sushi>Quick",
          gasCost: `$${gasCostUsd.toFixed(2)}`,
          status: isProfitable ? 
            `Profitable $${bestOpportunity.profitUsd.toFixed(4)}` : 
            `Low Profit $${bestOpportunity.profitUsd.toFixed(4)}`
        };
        
        // Update profitable count
        this.profitableCount = Object.values(this.statusTable).filter(
          s => s.status && s.status.includes("Profitable")
        ).length;
        
        // Force a table update for profitable opportunities
        if (isProfitable) {
          this.printStatusTable(true);
          
          // Execute the trade
          console.log(`\n🚀 Executing arbitrage for ${fromToken.symbol}/${toToken.symbol}...`);
          await this.executeArbitrage(bestOpportunity, blockNumber);
        }
      } else if (priceDiff > 0.1) {
        this.statusTable[pairKey] = {
          quickPrice: quickPriceFormatted.substring(0, 8),
          sushiPrice: sushiPriceFormatted.substring(0, 8),
          diffPct: priceDiff.toFixed(4) + "%",
          direction: quickHigher ? "Quick>Sushi" : "Sushi>Quick",
          gasCost: `$${gasCostUsd.toFixed(2)}`,
          status: "Not Profitable"
        };
      }
      
    } catch (error) {
      // Most errors are likely due to the pair not being available on one of the DEXes
      if (this.debugMode) {
        console.error(`Error checking ${pairKey} arbitrage: ${error.message}`);
      }
      
      // If this error happens, we should remove the pair from the verified list
      // since it might have lost liquidity
      VERIFIED_PAIRS.delete(pairKey);
      
      // Update status table
      this.statusTable[pairKey] = {
        quickPrice: "Error",
        sushiPrice: "Error",
        diffPct: "N/A",
        direction: "N/A",
        gasCost: "N/A",
        status: "Error - Removed"
      };
      
      // Schedule a re-check of this pair's liquidity after a cool-down period
      setTimeout(() => this.recheckPairLiquidity(pair), 60000); // Re-check after 1 minute
    }
  }
  
  // Re-check a pair's liquidity after an error
  async recheckPairLiquidity(pair) {
    const fromToken = this.tokenCache[pair.from];
    const toToken = this.tokenCache[pair.to];
    
    if (!fromToken || !toToken) return;
    
    const pairKey = `${fromToken.symbol}/${toToken.symbol}`;
    
    try {
      // Check both QuickSwap and SushiSwap for liquidity
      const quickswapLiquidity = await this.checkPairLiquidity(
        this.quickswapRouter, fromToken, toToken
      );
      
      const sushiswapLiquidity = await this.checkPairLiquidity(
        this.sushiswapRouter, fromToken, toToken
      );
      
      const hasLiquidity = quickswapLiquidity && sushiswapLiquidity;
      
      if (hasLiquidity) {
        console.log(`✅ ${pairKey} has regained liquidity on both exchanges`);
        VERIFIED_PAIRS.add(pairKey);
        
        // Reset status
        this.statusTable[pairKey] = {
          quickPrice: "Rechecking...",
          sushiPrice: "Rechecking...",
          diffPct: "N/A",
          direction: "N/A",
          gasCost: "N/A",
          status: "Verified"
        };
      }
    } catch (error) {
      console.error(`Error rechecking ${pairKey} liquidity: ${error.message}`);
    }
  }
  
  async checkRouteArbitrage(amount, fromToken, toToken, router1, router2, router1Name, router2Name, gasPrice) {
    try {
      // Path for the first swap
      const pathOut = [fromToken.address, toToken.address];
      
      // Path for the second swap (reverse)
      const pathBack = [toToken.address, fromToken.address];
      
      // Get quote for first route
      const amountsOut1 = await router1.getAmountsOut(amount, pathOut);
      const midAmount = amountsOut1[1];
      
      // Get quote for second route
      const amountsOut2 = await router2.getAmountsOut(midAmount, pathBack);
      const finalAmount = amountsOut2[1];
      
      // Calculate profit
      const profit = finalAmount.sub(amount);
      
      // Only consider positive profit opportunities
      if (profit.lte(0)) {
        return null;
      }
      
      // Calculate profit percentage
      const profitPercentage = parseFloat(profit.mul(10000).div(amount).toString()) / 100;
      
      // Estimate profit in USD (simplified - in a real system we'd use price oracles)
      // For DAI/USDC/USDT we'll assume 1:1 ratio to USD
      let profitUsd = 0;
      if (fromToken.symbol === "DAI" || fromToken.symbol === "USDC" || fromToken.symbol === "USDT") {
        profitUsd = parseFloat(ethers.utils.formatUnits(profit, fromToken.decimals));
      } else {
        // For other tokens, we'd need to get the current price
        // Using a placeholder of $2000 for ETH and $0.5 for MATIC
        if (fromToken.symbol === "WETH") {
            profitUsd = parseFloat(ethers.utils.formatUnits(profit, fromToken.decimals)) * 2000;
          } else if (fromToken.symbol === "WMATIC" || fromToken.symbol === "WPOL") {
            profitUsd = parseFloat(ethers.utils.formatUnits(profit, fromToken.decimals)) * 0.5;
          } else if (fromToken.symbol === "WBTC") {
            profitUsd = parseFloat(ethers.utils.formatUnits(profit, fromToken.decimals)) * 30000;
          } else {
            // For other tokens use a default estimate of $1 per token
            profitUsd = parseFloat(ethers.utils.formatUnits(profit, fromToken.decimals));
          }
      }
      
      // Estimate gas cost in USD
      const gasLimit = 700000; // Based on your contract's gas usage
      const gasCostWei = gasPrice.mul(gasLimit);
      const gasCostMatic = parseFloat(ethers.utils.formatEther(gasCostWei));
      const gasCostUsd = gasCostMatic * 0.5; // Assuming MATIC price of $0.5
      
      // Calculate net profit
      const netProfitUsd = profitUsd - gasCostUsd;
      
      // If net profit is negative, it's not worth executing
      if (netProfitUsd <= 0) {
        return null;
      }
      
      return {
        amount,
        fromToken,
        toToken,
        midAmount,
        finalAmount,
        profit,
        profitPercentage,
        profitUsd: netProfitUsd,
        gasCostUsd,
        route1: router1Name,
        route2: router2Name,
        router1,
        router2,
        pathOut,
        pathBack,
        gasPrice
      };
    } catch (error) {
      // No need to log here, handle errors in the parent method
      return null;
    }
  }
  
  async executeArbitrage(opportunity, blockNumber) {
    if (this.isExecuting) {
      console.log("Already executing a trade, skipping...");
      return;
    }
    
    this.isExecuting = true;
    
    try {
      const { amount, fromToken, toToken, midAmount, router1, router2, route1, route2, pathOut, pathBack, gasCostUsd } = opportunity;
      const pairKey = `${fromToken.symbol}/${toToken.symbol}`;
      
      // Update the table immediately to show we're executing
      this.statusTable[pairKey] = {
        ...this.statusTable[pairKey],
        status: "Executing..."
      };
      this.printStatusTable(true);
      
      console.log(`Executing ${fromToken.symbol}-${toToken.symbol} arbitrage:`);
      console.log(`- Loan amount: ${ethers.utils.formatUnits(amount, fromToken.decimals)} ${fromToken.symbol}`);
      console.log(`- Route: ${route1} → ${route2}`);
      console.log(`- Expected profit: ${opportunity.profitUsd.toFixed(4)} (gas cost: ${gasCostUsd.toFixed(2)})`);
      console.log(`- Expected intermediate amount: ${ethers.utils.formatUnits(midAmount, toToken.decimals)} ${toToken.symbol}`);
      
      // Calculate minimum amounts out with 2% slippage
      const slippage = 200; // 2% slippage
      const minAmountOut1 = midAmount.mul(10000 - slippage).div(10000);
      const minFinalAmount = amount; // At minimum, we want to break even (excluding gas)
      
      const minAmountsOut = [minAmountOut1, minFinalAmount];
      
      // Encode strategy data for the flash loan bot
      // Strategy type 1 is the simple arbitrage (Token A -> Token B -> Token A)
      const strategyType = 1;
      const path = [fromToken.address, toToken.address];
      
      const abiCoder = new ethers.utils.AbiCoder();
      const strategyData = abiCoder.encode(
        ["uint8", "address[]", "uint256[]"],
        [strategyType, path, minAmountsOut]
      );
      
      const secretHash = ethers.utils.keccak256(strategyData);
      
      console.log(`Sending transaction to contract...`);
      
      // Execute the flash loan arbitrage
      const tx = await this.flashLoanBot.executeArbitrage(
        fromToken.address,
        amount,
        strategyData,
        secretHash,
        {
          gasLimit: 4000000,
          gasPrice: opportunity.gasPrice,
        }
      );
      
      console.log(`Transaction sent: ${tx.hash}`);
      console.log(`Monitor at: https://polygonscan.com/tx/${tx.hash}`);
      
      // Wait for confirmation
      console.log("Waiting for confirmation...");
      const receipt = await tx.wait();
      
      // Record the execution
      this.executionHistory.push({
        timestamp: new Date(),
        blockNumber,
        txHash: receipt.transactionHash,
        pair: `${fromToken.symbol}-${toToken.symbol}`,
        route: `${opportunity.route1} -> ${opportunity.route2}`,
        amount: ethers.utils.formatUnits(amount, fromToken.decimals),
        profit: ethers.utils.formatUnits(opportunity.profit, fromToken.decimals),
        profitUsd: opportunity.profitUsd,
        gasUsed: receipt.gasUsed.toString(),
        status: receipt.status
      });
      
      if (receipt.status === 1) {
        console.log(`\n✅ Arbitrage executed successfully!`);
        console.log(`- Gas used: ${receipt.gasUsed.toString()}`);
        
        // Check contract balance to confirm profit
        const balance = await fromToken.contract.balanceOf(this.flashLoanContractAddress);
        console.log(`- Contract ${fromToken.symbol} balance: ${ethers.utils.formatUnits(balance, fromToken.decimals)}`);
        
        // Update status
        this.statusTable[pairKey] = {
          ...this.statusTable[pairKey],
          status: `Success ${opportunity.profitUsd.toFixed(4)}`
        };
      } else {
        console.log(`\n❌ Arbitrage execution failed!`);
        
        // Update status
        this.statusTable[pairKey] = {
          ...this.statusTable[pairKey],
          status: "Failed"
        };
      }
      
      // Update the table with the execution results
      this.printStatusTable(true);
    } catch (error) {
      console.error(`Error executing arbitrage: ${error.message}`);
      
      // Update status
      const pairKey = `${opportunity.fromToken.symbol}/${opportunity.toToken.symbol}`;
      this.statusTable[pairKey] = {
        ...this.statusTable[pairKey],
        status: "Error"
      };
      this.printStatusTable(true);
    } finally {
      // Reset execution flag
      this.isExecuting = false;
    }
  }
}

module.exports = ArbitrageDetector;