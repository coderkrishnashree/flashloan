// scripts/fix-pending-tx.js
const { ethers } = require("ethers");
require("dotenv").config();

async function main() {
  console.log("PENDING TRANSACTION RESOLVER");
  console.log("----------------------------");
  
  // Connect to network
  const provider = new ethers.providers.JsonRpcProvider(
    process.env.POLYGON_MAINNET_RPC_URL
  );
  
  // Create wallet
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  console.log(`Wallet address: ${wallet.address}`);
  
  // Get nonce info
  const latestNonce = await provider.getTransactionCount(wallet.address, "latest");
  const pendingNonce = await provider.getTransactionCount(wallet.address, "pending");
  
  console.log(`Latest confirmed nonce: ${latestNonce}`);
  console.log(`Pending nonce: ${pendingNonce}`);
  
  if (pendingNonce === latestNonce) {
    console.log("✅ No pending transactions found. Your transaction queue is clear.");
    return;
  }
  
  console.log(`You have ${pendingNonce - latestNonce} pending transactions.`);
  console.log("We need to handle the earliest pending transaction (nonce: " + latestNonce + ")");
  
  // Get current gas price with a premium
  const currentGasPrice = await provider.getGasPrice();
  const suggestedGasPrice = currentGasPrice.mul(2); // 100% higher (double) to ensure it goes through
  
  console.log(`Current gas price: ${ethers.utils.formatUnits(currentGasPrice, "gwei")} gwei`);
  console.log(`Suggested gas price: ${ethers.utils.formatUnits(suggestedGasPrice, "gwei")} gwei`);
  
  // Prompt for action
  console.log("\nOptions:");
  console.log("1. Cancel the transaction (send 0 MATIC to yourself with the same nonce)");
  console.log("2. Speed up by resending with higher gas price");
  console.log("3. Exit and do nothing");
  
  const action = await prompt("Choose an option (1/2/3): ");
  
  if (action === "1") {
    // Cancel transaction
    const cancelTx = {
      to: wallet.address, // Send to yourself
      value: 0, // 0 MATIC
      nonce: latestNonce, // Use the same nonce
      gasPrice: suggestedGasPrice,
      gasLimit: 21000 // Basic transfer gas limit
    };
    
    console.log("\nPreparing to cancel transaction with nonce " + latestNonce);
    console.log(`Using gas price: ${ethers.utils.formatUnits(suggestedGasPrice, "gwei")} gwei`);
    
    const confirm = await prompt("Proceed with cancellation? (yes/no): ");
    
    if (confirm.toLowerCase() === "yes") {
      try {
        const tx = await wallet.sendTransaction(cancelTx);
        console.log(`Cancellation transaction submitted: ${tx.hash}`);
        console.log(`Polygonscan URL: https://polygonscan.com/tx/${tx.hash}`);
        
        console.log("Waiting for confirmation...");
        const receipt = await tx.wait();
        
        if (receipt.status === 1) {
          console.log("✅ Transaction successfully cancelled!");
          console.log("Your transaction queue should start moving again.");
        } else {
          console.log("❌ Cancellation transaction failed!");
        }
      } catch (error) {
        console.error("Error cancelling transaction:", error.message);
      }
    } else {
      console.log("Cancellation aborted.");
    }
  }
  else if (action === "2") {
    console.log("\nTo speed up a transaction, you need to know what the original transaction was.");
    console.log("Since we can't easily fetch that information, we'll create a new transaction.");
    console.log("Please enter the details of the transaction you want to speed up:");
    
    const toAddress = await prompt("To address (leave empty for your own address): ");
    const valueInMatic = await prompt("Value in MATIC (default 0): ");
    
    // Prepare transaction
    const speedUpTx = {
      to: toAddress || wallet.address,
      value: ethers.utils.parseEther(valueInMatic || "0"),
      nonce: latestNonce, // Use the same nonce
      gasPrice: suggestedGasPrice,
      gasLimit: 100000 // Higher gas limit to be safe
    };
    
    console.log("\nPreparing to speed up transaction with nonce " + latestNonce);
    console.log(`To: ${speedUpTx.to}`);
    console.log(`Value: ${ethers.utils.formatEther(speedUpTx.value)} MATIC`);
    console.log(`Using gas price: ${ethers.utils.formatUnits(suggestedGasPrice, "gwei")} gwei`);
    
    const confirm = await prompt("Proceed with speed up? (yes/no): ");
    
    if (confirm.toLowerCase() === "yes") {
      try {
        const tx = await wallet.sendTransaction(speedUpTx);
        console.log(`Speed up transaction submitted: ${tx.hash}`);
        console.log(`Polygonscan URL: https://polygonscan.com/tx/${tx.hash}`);
        
        console.log("Waiting for confirmation...");
        const receipt = await tx.wait();
        
        if (receipt.status === 1) {
          console.log("✅ Transaction successfully sped up and confirmed!");
          console.log("Your transaction queue should start moving again.");
        } else {
          console.log("❌ Speed up transaction failed!");
        }
      } catch (error) {
        console.error("Error speeding up transaction:", error.message);
      }
    } else {
      console.log("Speed up aborted.");
    }
  }
  else {
    console.log("No action taken. Your pending transactions remain in the queue.");
  }
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