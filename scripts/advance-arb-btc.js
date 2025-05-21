const { ethers } = require("ethers");
require("dotenv").config();

// Add ArbitrageLogger ABI for tracking events
const loggerAbi = [
  "event ExecutionProgress(uint256 id, string step, string details)",
  "event ExecutionError(uint256 id, string step, string error)",
  "event SwapResult(uint256 id, string exchange, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut)",
  "event BalanceSnapshot(uint256 id, string point, address token, uint256 balance)",
  "event ProfitReport(uint256 id, address token, uint256 initialBalance, uint256 finalBalance, uint256 profit, bool isSuccess)",
  "function executionCount() external view returns (uint256)"
];

async function main() {
  const provider = new ethers.providers.JsonRpcProvider(process.env.POLYGON_MAINNET_RPC_URL);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  
  // Addresses and ABI
  const contractAddress = process.env.ADVANCED_ARBITRAGE_BOT_ADDRESS_MAINNET;
  const loggerAddress = process.env.ARBITRAGE_LOGGER_ADDRESS_MAINNET; // Add this to your .env file
  const DAI = "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063";
  const WBTC = "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6"; // WBTC address on Polygon
  
  const quickswap = process.env.QUICKSWAP_ROUTER;
  const sushiswap = process.env.SUSHISWAP_ROUTER;
  
  // Setup contracts
  const abi = [
    "function executeArbitrage(address _asset, uint256 _amount, bytes calldata _strategyData, bytes32 _secretHash) external",
    "function authorizedCallers(address) external view returns (bool)",
    "function setAuthorizedCaller(address _caller, bool _status) external",
    "function owner() external view returns (address)",
    "function logger() external view returns (address)"
  ];
  
  const contract = new ethers.Contract(contractAddress, abi, wallet);

  // If logger address not in .env, try to get it from the contract
  if (!loggerAddress) {
    try {
      const dynamicLoggerAddress = await contract.logger();
      console.log(`Logger address retrieved from contract: ${dynamicLoggerAddress}`);
      loggerAddress = dynamicLoggerAddress;
    } catch (error) {
      console.warn("Could not retrieve logger address from contract. Some features may be limited.");
    }
  }

  // Setup logger if available
  let logger = null;
  if (loggerAddress) {
    logger = new ethers.Contract(loggerAddress, loggerAbi, provider);
    console.log(`ArbitrageLogger connected at: ${loggerAddress}`);
  } else {
    console.warn("No logger address provided. Event tracking will be limited.");
  }
  
  // Check if caller is authorized
  const isAuthorized = await contract.authorizedCallers(wallet.address);
  if (!isAuthorized) {
    console.log("Wallet not authorized. Checking if wallet is owner...");
    
    const owner = await contract.owner();
    if (owner.toLowerCase() === wallet.address.toLowerCase()) {
      console.log("Wallet is owner. Authorizing wallet as caller...");
      const authTx = await contract.setAuthorizedCaller(wallet.address, true);
      await authTx.wait();
      console.log("Wallet authorized successfully!");
    } else {
      console.error("Wallet is not owner and not authorized to call executeArbitrage!");
      return;
    }
  } else {
    console.log("Wallet is already authorized as a caller.");
  }
  
  // Check for DAI balance to cover premium
  const tokenAbi = [
    "function balanceOf(address) external view returns (uint256)",
    "function decimals() external view returns (uint8)"
  ];
  const dai = new ethers.Contract(DAI, tokenAbi, provider);
  const wbtc = new ethers.Contract(WBTC, tokenAbi, provider);
  
  const daiBalance = await dai.balanceOf(contractAddress);
  console.log(`Contract DAI balance: ${ethers.utils.formatUnits(daiBalance, 18)} DAI`);
  
  // Get WBTC decimals (usually 8 for Bitcoin tokens)
  const wbtcDecimals = await wbtc.decimals();
  console.log(`WBTC decimals: ${wbtcDecimals}`);
  
  // Arbitrage parameters based on your monitor data
  // QuickSwap price is higher (0.000008) than SushiSwap (0.000007)
  const strategyType = 1; // 1 = simple
  const amountToLoan = ethers.utils.parseUnits("1", 18); // 1 DAI for testing
  
  // Calculate premium (0.09% for AAVE flash loans)
  const premium = amountToLoan.mul(9).div(10000);
  
  if (daiBalance.lt(premium)) {
    console.warn(`WARNING: Contract may not have enough DAI to cover the premium (${ethers.utils.formatUnits(premium, 18)} DAI needed)`);
  }
  
  // Swap path for DAI/WBTC arbitrage (buy on SushiSwap, sell on QuickSwap)
  const path = [DAI, WBTC];
  
  // Calculate min amounts out based on your monitor data
  // SushiSwap: When buying WBTC with 1 DAI, expect at least 0.000007 * 0.95 WBTC (5% slippage buffer)
  const expectedWbtcAmount = ethers.utils.parseUnits(
    (0.000007 * 0.95).toFixed(wbtcDecimals), 
    wbtcDecimals
  );
  
  // QuickSwap: When selling WBTC back to DAI, expect at least 1 DAI + premium
  const minDaiReturn = amountToLoan.add(premium).mul(95).div(100); // 5% buffer
  
  const minAmountsOut = [
    expectedWbtcAmount, // DAI -> WBTC on SushiSwap (min amount)
    minDaiReturn        // WBTC -> DAI on QuickSwap (min amount)
  ];
  
  // Add routing information (which DEX to use for each hop)
  // This format might need to be adjusted based on your contract's implementation
  // In your contract, there are different route handling for STRATEGY_SIMPLE vs STRATEGY_MULTI_DEX
  const dexPath = [1, 0]; // First swap on SushiSwap (1), second on QuickSwap (0)
  
  // ABI-encode strategy data
  const ethersAbi = new ethers.utils.AbiCoder();
  const strategyData = ethersAbi.encode(
    ["uint8", "address[]", "uint256[]", "uint8[]"],
    [strategyType, path, minAmountsOut, dexPath]
  );
  const secretHash = ethers.utils.keccak256(strategyData);
  
  console.log("\nExecuting arbitrage with parameters:");
  console.log(`- Asset: ${DAI} (DAI)`);
  console.log(`- Loan Amount: ${ethers.utils.formatUnits(amountToLoan, 18)} DAI`);
  console.log(`- Strategy Type: Simple (${strategyType})`);
  console.log(`- Path: DAI -> WBTC -> DAI`);
  console.log(`- Min WBTC From SushiSwap: ${ethers.utils.formatUnits(expectedWbtcAmount, wbtcDecimals)} WBTC`);
  console.log(`- Min DAI Return From QuickSwap: ${ethers.utils.formatUnits(minDaiReturn, 18)} DAI`);
  console.log(`- Secret Hash: ${secretHash}`);
  
  // Get current execution count before transaction
  let currentExecutionCount = 0;
  if (logger) {
    try {
      currentExecutionCount = await logger.executionCount();
      console.log(`Current execution count: ${currentExecutionCount}`);
    } catch (error) {
      console.warn("Could not get execution count from logger", error.message);
    }
  }
  
  // Send tx
  console.log("\nSending transaction...");
  const gasPrice = await provider.getGasPrice();
  console.log(`Gas price: ${ethers.utils.formatUnits(gasPrice, 'gwei')} gwei`);
  
  const tx = await contract.executeArbitrage(DAI, amountToLoan, strategyData, secretHash, {
    gasLimit: 4000000,
    gasPrice: gasPrice,
  });
  
  console.log(`Transaction sent: ${tx.hash}`);
  console.log("Waiting for confirmation (this may take a while)...");
  
  let receipt;
  try {
    receipt = await tx.wait();
    console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
    console.log(`Gas used: ${receipt.gasUsed.toString()}`);
    
    if (receipt.status === 1) {
      console.log("Arbitrage executed successfully!");
      
      // Calculate expected profit
      const expectedDaiProfit = ethers.utils.formatUnits(
        minDaiReturn.sub(amountToLoan).sub(premium),
        18
      );
      console.log(`Expected minimum profit: ${expectedDaiProfit} DAI`);
    } else {
      console.error("Transaction failed!");
    }
  } catch (error) {
    console.error("Transaction failed with error:", error.message);
    // If transaction hash is available, we can still examine the logs
    if (tx.hash) {
      receipt = await provider.getTransactionReceipt(tx.hash);
    }
  }
  
  // Get execution ID - either the next ID from before or try to determine it from logs
  const executionId = currentExecutionCount > 0 ? currentExecutionCount + 1 : null;
  
  // Retrieve and display logs from the transaction
  console.log("\n--- EXECUTION LOG ANALYSIS ---");
  if (receipt && logger) {
    await analyzeTransactionLogs(receipt, logger, executionId, provider);
  } else {
    console.log("No receipt or logger available to analyze logs");
  }
}

// Function to analyze transaction logs
async function analyzeTransactionLogs(receipt, logger, executionId, provider) {
  try {
    // If we don't know the execution ID, try to find it in the logs
    if (!executionId) {
      const startEvents = receipt.logs
        .filter(log => logger.interface.parseLog(log).name === 'ExecutionProgress')
        .filter(log => logger.interface.parseLog(log).args.step === 'START');
      
      if (startEvents.length > 0) {
        executionId = logger.interface.parseLog(startEvents[0]).args.id.toString();
        console.log(`Found execution ID: ${executionId}`);
      } else {
        console.log("Could not determine execution ID from logs");
        return;
      }
    }
    
    // Filter all logs from the receipt that belong to the logger contract
    const loggerLogs = receipt.logs.filter(log => 
      log.address.toLowerCase() === logger.address.toLowerCase()
    );
    
    if (loggerLogs.length === 0) {
      console.log("No logs found from the logger contract in this transaction");
      
      // Check if there are any logs at all
      if (receipt.logs.length > 0) {
        console.log(`Found ${receipt.logs.length} logs from other contracts. First few addresses:`);
        receipt.logs.slice(0, 3).forEach(log => {
          console.log(`- ${log.address}`);
        });
      }
      return;
    }
    
    console.log(`Found ${loggerLogs.length} logs from the logger contract`);
    
    // Parse and display logs in order
    console.log("\n--- EXECUTION TIMELINE ---");
    let progressLogs = [];
    let errorLogs = [];
    let swapLogs = [];
    let balanceLogs = [];
    let profitLogs = [];
    
    for (const log of loggerLogs) {
      try {
        const parsedLog = logger.interface.parseLog(log);
        const logId = parsedLog.args.id.toString();
        
        if (logId !== executionId.toString()) continue;
        
        if (parsedLog.name === 'ExecutionProgress') {
          progressLogs.push({
            step: parsedLog.args.step,
            details: parsedLog.args.details
          });
        } else if (parsedLog.name === 'ExecutionError') {
          errorLogs.push({
            step: parsedLog.args.step,
            error: parsedLog.args.error
          });
        } else if (parsedLog.name === 'SwapResult') {
          swapLogs.push({
            exchange: parsedLog.args.exchange,
            tokenIn: parsedLog.args.tokenIn,
            tokenOut: parsedLog.args.tokenOut,
            amountIn: parsedLog.args.amountIn.toString(),
            amountOut: parsedLog.args.amountOut.toString()
          });
        } else if (parsedLog.name === 'BalanceSnapshot') {
          balanceLogs.push({
            point: parsedLog.args.point,
            token: parsedLog.args.token,
            balance: parsedLog.args.balance.toString()
          });
        } else if (parsedLog.name === 'ProfitReport') {
          profitLogs.push({
            token: parsedLog.args.token,
            initialBalance: parsedLog.args.initialBalance.toString(),
            finalBalance: parsedLog.args.finalBalance.toString(),
            profit: parsedLog.args.profit.toString(),
            isSuccess: parsedLog.args.isSuccess
          });
        }
      } catch (e) {
        console.log(`Could not parse log: ${e.message}`);
      }
    }
    
    // Output progress logs chronologically (execution timeline)
    console.log("\n=== EXECUTION STEPS ===");
    if (progressLogs.length > 0) {
      progressLogs.forEach((log, index) => {
        console.log(`${index + 1}. [${log.step}] ${log.details}`);
      });
    } else {
      console.log("No execution progress logs found");
    }
    
    // Output any errors (most critical information)
    console.log("\n=== ERRORS ===");
    if (errorLogs.length > 0) {
      errorLogs.forEach((log, index) => {
        console.log(`ERROR at [${log.step}]: ${log.error}`);
      });
    } else {
      console.log("No errors logged");
    }
    
    // Output swaps
    console.log("\n=== SWAPS ===");
    if (swapLogs.length > 0) {
      swapLogs.forEach((log, index) => {
        console.log(`Swap ${index + 1} on ${log.exchange}:`);
        console.log(`  ${log.amountIn} of token ${log.tokenIn}`);
        console.log(`  → ${log.amountOut} of token ${log.tokenOut}`);
      });
    } else {
      console.log("No swap logs found");
    }
    
    // Output balance snapshots
    console.log("\n=== BALANCE SNAPSHOTS ===");
    if (balanceLogs.length > 0) {
      balanceLogs.forEach((log) => {
        console.log(`[${log.point}] Token ${log.token}: ${log.balance}`);
      });
    } else {
      console.log("No balance snapshot logs found");
    }
    
    // Output profit reports
    console.log("\n=== PROFIT REPORT ===");
    if (profitLogs.length > 0) {
      profitLogs.forEach((log) => {
        console.log(`Token: ${log.token}`);
        console.log(`Initial Balance: ${log.initialBalance}`);
        console.log(`Final Balance: ${log.finalBalance}`);
        console.log(`Profit: ${log.profit}`);
        console.log(`Success: ${log.isSuccess}`);
      });
    } else {
      console.log("No profit report logs found");
    }
    
    // Determine failure point
    if (errorLogs.length > 0) {
      console.log("\n=== FAILURE ANALYSIS ===");
      const lastProgressStep = progressLogs.length > 0 ? progressLogs[progressLogs.length - 1].step : "N/A";
      const firstError = errorLogs[0];
      
      console.log(`Transaction failed at step [${firstError.step}]`);
      console.log(`Last successful step was [${lastProgressStep}]`);
      console.log(`Error reason: ${firstError.error}`);
      
      // If error is related to swaps, provide more insight
      if (firstError.step.includes("UNISWAP") || firstError.step.includes("SUSHISWAP")) {
        console.log("\nSwap Error Analysis:");
        console.log("This appears to be a DEX swap failure. Common causes include:");
        console.log("1. Insufficient slippage tolerance (min amount out too high)");
        console.log("2. Insufficient liquidity on the selected path");
        console.log("3. Price moved unfavorably during transaction execution");
        console.log("\nSuggested fixes:");
        console.log("- Increase slippage tolerance");
        console.log("- Verify liquidity on both DEXes before executing");
        console.log("- Ensure price difference still exists before execution");
      }
    }
    
  } catch (error) {
    console.error("Error analyzing transaction logs:", error);
  }
}

main().catch(error => {
  console.error("Error executing arbitrage:", error);
  process.exit(1);
});