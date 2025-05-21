const { ethers } = require("ethers");
require("dotenv").config();

async function main() {
  const provider = new ethers.providers.JsonRpcProvider(process.env.POLYGON_MAINNET_RPC_URL);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  
  // Addresses and ABI
  const contractAddress = process.env.ADVANCED_ARBITRAGE_BOT_ADDRESS_MAINNET;
  const DAI = "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063";
  const USDC = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
  
  const quickswap = process.env.QUICKSWAP_ROUTER;
  const sushiswap = process.env.SUSHISWAP_ROUTER;
  
  // More complete ABI
  const abi = [
    "function executeArbitrage(address _asset, uint256 _amount, bytes calldata _strategyData, bytes32 _secretHash) external",
    "function authorizedCallers(address) external view returns (bool)",
    "function setAuthorizedCaller(address _caller, bool _status) external",
    "function owner() external view returns (address)"
  ];
  
  const contract = new ethers.Contract(contractAddress, abi, wallet);
  
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
  const tokenAbi = ["function balanceOf(address) external view returns (uint256)"];
  const dai = new ethers.Contract(DAI, tokenAbi, provider);
  
  const daiBalance = await dai.balanceOf(contractAddress);
  console.log(`Contract DAI balance: ${ethers.utils.formatUnits(daiBalance, 18)} DAI`);
  
  // Arbitrage parameters
  const strategyType = 1; // 1 = simple
  const amountToLoan = ethers.utils.parseUnits("1", 18); // 1 DAI for testing
  
  // Calculate premium (0.09% for AAVE flash loans)
  const premium = amountToLoan.mul(9).div(10000);
  
  if (daiBalance.lt(premium)) {
    console.warn(`WARNING: Contract may not have enough DAI to cover the premium (${ethers.utils.formatUnits(premium, 18)} DAI needed)`);
  }
  
  // Swap path and minimum outs
  const path = [DAI, USDC];
  const minAmountsOut = [
    ethers.utils.parseUnits("0.95", 6), // DAI -> USDC (expect 0.95 USDC min for 1 DAI)
    ethers.utils.parseUnits("0.9", 18)  // USDC -> DAI (expect 0.9 DAI min for 0.95 USDC)
  ];
  
  // ABI-encode strategy data
  const ethersAbi = new ethers.utils.AbiCoder();
  const strategyData = ethersAbi.encode(
    ["uint8", "address[]", "uint256[]"],
    [strategyType, path, minAmountsOut]
  );
  const secretHash = ethers.utils.keccak256(strategyData);
  
  console.log("\nExecuting arbitrage with parameters:");
  console.log(`- Asset: ${DAI} (DAI)`);
  console.log(`- Loan Amount: ${ethers.utils.formatUnits(amountToLoan, 18)} DAI`);
  console.log(`- Strategy Type: Simple (${strategyType})`);
  console.log(`- Path: DAI -> USDC -> DAI`);
  console.log(`- Secret Hash: ${secretHash}`);
  
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
  
  const receipt = await tx.wait();
  console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
  console.log(`Gas used: ${receipt.gasUsed.toString()}`);
  
  if (receipt.status === 1) {
    console.log("Arbitrage executed successfully!");
  } else {
    console.error("Transaction failed!");
  }
}

main().catch(error => {
  console.error("Error executing arbitrage:", error);
  process.exit(1);
});