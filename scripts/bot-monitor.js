// bot-monitor.js
// Script to monitor and display execution of your arbitrage bot

const { ethers } = require('ethers');
require('dotenv').config();

// Parse arguments to determine which network to use
const args = process.argv.slice(2);
const isMainnet = args.includes('--mainnet') || !args.includes('--amoy');
const networkName = isMainnet ? 'MAINNET' : 'AMOY';
console.log(`Using network: ${networkName}`);

// Configuration from your .env file structure
const RPC_URL = isMainnet ? 
    process.env.POLYGON_MAINNET_RPC_URL : 
    process.env.POLYGON_AMOY_RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const BOT_ADDRESS = isMainnet ? 
    process.env.ADVANCED_ARBITRAGE_BOT_ADDRESS_MAINNET : 
    process.env.ADVANCED_ARBITRAGE_BOT_ADDRESS_AMOY;

// ABI for the logger contract (just the events we need)
const LOGGER_ABI = [
  "event ExecutionProgress(uint256 id, string step, string details)",
  "event ExecutionError(uint256 id, string step, string error)",
  "event SwapResult(uint256 id, string exchange, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut)",
  "event BalanceSnapshot(uint256 id, string point, address token, uint256 balance)",
  "event ProfitReport(uint256 id, address token, uint256 initialBalance, uint256 finalBalance, uint256 profit, bool isSuccess)",
  "function getLoggerAddress() external view returns (address)"
];

// Contract ABI (just what we need for this script)
const BOT_ABI = [
  "function getLoggerAddress() external view returns (address)"
];

// Token ABI for getting token info
const TOKEN_ABI = [
  "function symbol() external view returns (string)",
  "function decimals() external view returns (uint8)"
];

// Connect to the provider
const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

// Cache for token information
const tokenCache = {};

// Function to get token symbol and decimals
async function getTokenInfo(tokenAddress) {
  if (tokenCache[tokenAddress]) {
    return tokenCache[tokenAddress];
  }
  
  // Special case for ETH/MATIC
  if (tokenAddress === '0x0000000000000000000000000000000000000000') {
    tokenCache[tokenAddress] = { symbol: 'MATIC', decimals: 18 };
    return tokenCache[tokenAddress];
  }
  
  try {
    const tokenContract = new ethers.Contract(tokenAddress, TOKEN_ABI, provider);
    const [symbol, decimals] = await Promise.all([
      tokenContract.symbol(),
      tokenContract.decimals()
    ]);
    
    tokenCache[tokenAddress] = { symbol, decimals };
    return tokenCache[tokenAddress];
  } catch (error) {
    console.error(`Error getting token info for ${tokenAddress}:`, error.message);
    tokenCache[tokenAddress] = { symbol: 'UNKNOWN', decimals: 18 };
    return tokenCache[tokenAddress];
  }
}

// Format token amount with symbol
async function formatTokenAmount(amount, tokenAddress) {
  const { symbol, decimals } = await getTokenInfo(tokenAddress);
  const formattedAmount = ethers.utils.formatUnits(amount, decimals);
  return `${formattedAmount} ${symbol}`;
}

// Colorize console output
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m"
};

// Main monitoring function
async function monitorBot() {
  try {
    console.log(`${colors.bright}${colors.cyan}===== Arbitrage Bot Monitor ======${colors.reset}`);
    console.log(`${colors.dim}Connecting to network via ${RPC_URL}${colors.reset}`);
    
    // Get bot contract
    const botContract = new ethers.Contract(BOT_ADDRESS, BOT_ABI, provider);
    
    // Get logger address
    const loggerAddress = await botContract.getLoggerAddress();
    console.log(`${colors.cyan}Logger contract found at: ${loggerAddress}${colors.reset}`);
    
    // Connect to logger
    const loggerContract = new ethers.Contract(loggerAddress, LOGGER_ABI, provider);
    
    // Storage for executions
    const executions = {};
    
    // Listen for progress events
    loggerContract.on("ExecutionProgress", async (id, step, details) => {
      const idStr = id.toString();
      if (!executions[idStr]) {
        executions[idStr] = { steps: [], errors: [], swaps: [], balances: [] };
        console.log(`\n${colors.bright}${colors.cyan}===== New Execution #${idStr} ======${colors.reset}`);
      }
      
      executions[idStr].steps.push({ step, details });
      console.log(`${colors.green}[#${idStr}][${step}] ${details}${colors.reset}`);
    });
    
    // Listen for error events
    loggerContract.on("ExecutionError", async (id, step, error) => {
      const idStr = id.toString();
      if (!executions[idStr]) {
        executions[idStr] = { steps: [], errors: [], swaps: [], balances: [] };
        console.log(`\n${colors.bright}${colors.cyan}===== New Execution #${idStr} ======${colors.reset}`);
      }
      
      executions[idStr].errors.push({ step, error });
      console.log(`${colors.red}[#${idStr}][ERROR in ${step}] ${error}${colors.reset}`);
    });
    
    // Listen for swap events
    loggerContract.on("SwapResult", async (id, exchange, tokenIn, tokenOut, amountIn, amountOut) => {
      const idStr = id.toString();
      if (!executions[idStr]) {
        executions[idStr] = { steps: [], errors: [], swaps: [], balances: [] };
      }
      
      const formattedAmountIn = await formatTokenAmount(amountIn, tokenIn);
      const formattedAmountOut = await formatTokenAmount(amountOut, tokenOut);
      
      executions[idStr].swaps.push({
        exchange,
        tokenIn,
        tokenOut,
        amountIn,
        amountOut
      });
      
      console.log(`${colors.yellow}[#${idStr}][SWAP:${exchange}] ${formattedAmountIn} → ${formattedAmountOut}${colors.reset}`);
    });
    
    // Listen for balance events
    loggerContract.on("BalanceSnapshot", async (id, point, token, balance) => {
      const idStr = id.toString();
      if (!executions[idStr]) {
        executions[idStr] = { steps: [], errors: [], swaps: [], balances: [] };
      }
      
      const formattedBalance = await formatTokenAmount(balance, token);
      
      executions[idStr].balances.push({
        point,
        token,
        balance
      });
      
      console.log(`${colors.blue}[#${idStr}][BALANCE:${point}] ${formattedBalance}${colors.reset}`);
    });
    
    // Listen for profit reports
    loggerContract.on("ProfitReport", async (id, token, initialBalance, finalBalance, profit, isSuccess) => {
      const idStr = id.toString();
      if (!executions[idStr]) {
        executions[idStr] = { steps: [], errors: [], swaps: [], balances: [] };
      }
      
      const formattedInitial = await formatTokenAmount(initialBalance, token);
      const formattedFinal = await formatTokenAmount(finalBalance, token);
      const formattedProfit = await formatTokenAmount(profit, token);
      
      if (isSuccess) {
        console.log(`\n${colors.bright}${colors.green}[#${idStr}][PROFIT] Execution successful!${colors.reset}`);
        console.log(`${colors.green}Initial: ${formattedInitial}${colors.reset}`);
        console.log(`${colors.green}Final: ${formattedFinal}${colors.reset}`);
        console.log(`${colors.bright}${colors.green}Profit: ${formattedProfit}${colors.reset}\n`);
      } else {
        console.log(`\n${colors.bright}${colors.red}[#${idStr}][PROFIT] Execution failed!${colors.reset}`);
        console.log(`${colors.red}Initial: ${formattedInitial}${colors.reset}`);
        console.log(`${colors.red}Final: ${formattedFinal}${colors.reset}`);
        console.log(`${colors.red}No profit generated.${colors.reset}\n`);
      }
      
      // Summary of execution
      console.log(`${colors.cyan}===== Execution #${idStr} Summary =====${colors.reset}`);
      console.log(`${colors.cyan}Total steps: ${executions[idStr].steps.length}${colors.reset}`);
      console.log(`${colors.cyan}Total errors: ${executions[idStr].errors.length}${colors.reset}`);
      console.log(`${colors.cyan}Total swaps: ${executions[idStr].swaps.length}${colors.reset}`);
      
      if (executions[idStr].errors.length > 0) {
        console.log(`\n${colors.red}===== Errors in Execution #${idStr} =====${colors.reset}`);
        executions[idStr].errors.forEach((error, i) => {
          console.log(`${colors.red}${i+1}. [${error.step}] ${error.error}${colors.reset}`);
        });
      }
    });
    
    console.log(`${colors.bright}${colors.green}Monitoring started. Waiting for transactions...${colors.reset}`);
    console.log(`${colors.dim}Press Ctrl+C to stop${colors.reset}`);
    
  } catch (error) {
    console.error(`${colors.red}Error setting up monitoring:${colors.reset}`, error);
  }
}

// Start monitoring
monitorBot().catch(console.error);