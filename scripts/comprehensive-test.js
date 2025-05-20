// scripts/comprehensive-check.js
const { ethers } = require("ethers");
require("dotenv").config();

async function main() {
  console.log("===============================");
  console.log("COMPREHENSIVE DIAGNOSTIC CHECK");
  console.log("===============================\n");
  
  // 1. Network connection check
  console.log("1. CHECKING NETWORK CONNECTION");
  console.log("------------------------------");
  
  const provider = new ethers.providers.JsonRpcProvider(
    process.env.POLYGON_MAINNET_RPC_URL
  );
  
  try {
    const network = await provider.getNetwork();
    console.log(`Connected to: ${network.name} (chainId: ${network.chainId})`);
    
    const blockNumber = await provider.getBlockNumber();
    console.log(`Current block: ${blockNumber}`);
    
    const gasPrice = await provider.getGasPrice();
    console.log(`Current gas price: ${ethers.utils.formatUnits(gasPrice, "gwei")} gwei`);
    
    if (network.chainId !== 137) {
      console.error("ERROR: Not connected to Polygon Mainnet (chainId 137)");
      return;
    }
  } catch (error) {
    console.error("ERROR: Failed to connect to network:", error.message);
    return;
  }
  console.log("✅ Network connection successful\n");
  
  // 2. Wallet check
  console.log("2. CHECKING WALLET");
  console.log("------------------");
  
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  console.log(`Wallet address: ${wallet.address}`);
  
  try {
    const balance = await provider.getBalance(wallet.address);
    console.log(`MATIC balance: ${ethers.utils.formatEther(balance)} MATIC`);
    
    const pendingNonce = await provider.getTransactionCount(wallet.address, "pending");
    const confirmedNonce = await provider.getTransactionCount(wallet.address, "latest");
    
    console.log(`Latest confirmed nonce: ${confirmedNonce}`);
    console.log(`Pending nonce: ${pendingNonce}`);
    
    if (pendingNonce > confirmedNonce) {
      console.warn(`WARNING: You have ${pendingNonce - confirmedNonce} pending transactions`);
    }
    
    if (balance.lt(ethers.utils.parseEther("0.1"))) {
      console.warn("WARNING: Low MATIC balance. You might need more for gas fees.");
    } else {
      console.log("✅ Wallet balance sufficient");
    }
  } catch (error) {
    console.error("ERROR: Failed to check wallet:", error.message);
    return;
  }
  console.log("✅ Wallet check successful\n");
  
  // 3. Contract check
  console.log("3. CHECKING CONTRACT");
  console.log("--------------------");
  
  const contractAddress = process.env.ARBITRAGE_FLASH_LOAN_ADDRESS_MAINNET;
  console.log(`Contract address: ${contractAddress}`);
  
  try {
    // Verify contract exists
    const code = await provider.getCode(contractAddress);
    if (code === "0x") {
      console.error("ERROR: No contract found at this address!");
      return;
    }
    console.log("✅ Contract exists on the network");
    
    // Check contract balance
    const contractBalance = await provider.getBalance(contractAddress);
    console.log(`Contract MATIC balance: ${ethers.utils.formatEther(contractBalance)} MATIC`);
    
    if (contractBalance.isZero()) {
      console.warn("WARNING: Contract has no MATIC. It may need some for gas fees.");
    }
    
    // Basic contract info
    const abi = [
      "function owner() view returns (address)",
      "function minProfitThreshold() view returns (uint256)",
      "function LENDING_POOL() view returns (address)"
    ];
    
    const contract = new ethers.Contract(contractAddress, abi, provider);
    
    const owner = await contract.owner();
    console.log(`Contract owner: ${owner}`);
    console.log(`Is your wallet the owner? ${owner.toLowerCase() === wallet.address.toLowerCase()}`);
    
    const threshold = await contract.minProfitThreshold();
    console.log(`Minimum profit threshold: ${ethers.utils.formatEther(threshold)} ETH`);
    
    const lendingPool = await contract.LENDING_POOL();
    console.log(`Lending pool address: ${lendingPool}`);
    
  } catch (error) {
    console.error("ERROR: Failed to check contract:", error.message);
  }
  console.log("✅ Contract check completed\n");
  
  // 4. Test a simple transaction
  console.log("4. TESTING SIMPLE TRANSACTION");
  console.log("-----------------------------");
  
  try {
    console.log("Sending a tiny amount of MATIC to yourself as a test...");
    
    // Create a simple transaction - sending 0.0001 MATIC to yourself
    const tx = {
      to: wallet.address,
      value: ethers.utils.parseEther("0.0001"),
      gasLimit: 21000, // Standard gas limit for simple transfers
      gasPrice: (await provider.getGasPrice()).mul(12).div(10) // 20% higher gas price
    };
    
    console.log(`Amount: ${ethers.utils.formatEther(tx.value)} MATIC`);
    console.log(`Gas price: ${ethers.utils.formatUnits(tx.gasPrice, "gwei")} gwei`);
    
    const response = await prompt("Send this test transaction? (yes/no): ");
    
    if (response.toLowerCase() === "yes") {
      // Sign and send transaction
      const signedTx = await wallet.sendTransaction(tx);
      
      console.log(`Transaction submitted: ${signedTx.hash}`);
      console.log(`Polygonscan URL: https://polygonscan.com/tx/${signedTx.hash}`);
      
      console.log("Waiting for confirmation...");
      const receipt = await signedTx.wait();
      
      console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
      console.log(`Gas used: ${receipt.gasUsed.toString()}`);
      console.log("✅ Simple transaction successful");
    } else {
      console.log("Test transaction skipped");
    }
  } catch (error) {
    console.error("ERROR: Failed to send simple transaction:", error.message);
  }
  
  // 5. Flash loan test prompt
  console.log("\n5. FLASH LOAN TEST");
  console.log("------------------");
  console.log("Based on the diagnostics, you can now test a flash loan with:");
  console.log("- A very small amount (1 DAI)");
  console.log("- Higher gas price to ensure it's processed");
  console.log("- Check your pending transactions first");
  
  const testFlashLoan = await prompt("Would you like to test a minimal flash loan? (yes/no): ");
  
  if (testFlashLoan.toLowerCase() === "yes") {
    // Execute a minimal flash loan
    try {
      // Define test parameters
      const DAI = "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063";
      const amountToLoan = ethers.utils.parseEther("1"); // Just 1 DAI
      
      // Higher gas price
      const gasPrice = (await provider.getGasPrice()).mul(15).div(10); // 50% higher
      
      console.log(`Executing flash loan for ${ethers.utils.formatEther(amountToLoan)} DAI...`);
      console.log(`Using gas price: ${ethers.utils.formatUnits(gasPrice, "gwei")} gwei`);
      
      // ABI for flash loan function
      const flashLoanAbi = [
        "function executeFlashLoan(address _asset, uint256 _amount) external"
      ];
      
      // Connect as a signer
      const flashLoanContract = new ethers.Contract(contractAddress, flashLoanAbi, wallet);
      
      // Execute the flash loan
      const tx = await flashLoanContract.executeFlashLoan(DAI, amountToLoan, {
        gasLimit: 3000000,
        gasPrice: gasPrice
      });
      
      console.log(`Transaction submitted: ${tx.hash}`);
      console.log(`Polygonscan URL: https://polygonscan.com/tx/${tx.hash}`);
      
      console.log("Waiting for confirmation (this may take a while)...");
      const receipt = await tx.wait();
      
      if (receipt.status === 1) {
        console.log("✅ Flash loan transaction succeeded!");
      } else {
        console.log("❌ Flash loan transaction failed!");
      }
    } catch (error) {
      console.error("ERROR: Flash loan failed:", error.message);
      
      if (error.reason) {
        console.error("Reason:", error.reason);
      }
    }
  } else {
    console.log("Flash loan test skipped");
  }
  
  console.log("\nDiagnostic check completed!");
}

// Helper function for prompts
function prompt(question) {
  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise(resolve => {
    readline.question(question, answer => {
      readline.close();
      resolve(answer);
    });
  });
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error("Unhandled error:", error);
    process.exit(1);
  });