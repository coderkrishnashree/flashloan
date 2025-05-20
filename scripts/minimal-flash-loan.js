const { ethers } = require("ethers");
require("dotenv").config();

async function main() {
  console.log("Testing minimal flash loan...");
  
  // Connect to Polygon
  const provider = new ethers.providers.JsonRpcProvider(
    process.env.POLYGON_MAINNET_RPC_URL
  );
  
  // Create wallet
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  console.log(`Using wallet address: ${wallet.address}`);
  
  // Contract address
  const contractAddress = process.env.ARBITRAGE_FLASH_LOAN_ADDRESS_MAINNET;
  
  // ABI for flash loan function
  const abi = [
    "function executeFlashLoan(address _asset, uint256 _amount) external"
  ];
  
  const contract = new ethers.Contract(contractAddress, abi, wallet);
  
  // Use a very small loan amount for testing
  const DAI = "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063";
  const amountToLoan = ethers.utils.parseEther("1"); // Just 1 DAI
  
  try {
    console.log(`Executing minimal flash loan for ${ethers.utils.formatEther(amountToLoan)} DAI...`);
    
    const tx = await contract.executeFlashLoan(DAI, amountToLoan, {
      gasLimit: 3000000
    });
    
    console.log(`Transaction submitted: ${tx.hash}`);
    console.log(`Polygonscan URL: https://polygonscan.com/tx/${tx.hash}`);
    
    const receipt = await tx.wait();
    
    if (receipt.status === 1) {
      console.log("Transaction succeeded!");
    } else {
      console.log("Transaction failed!");
    }
  } catch (error) {
    console.error("Error executing flash loan:", error.message);
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });