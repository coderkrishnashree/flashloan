const { ethers } = require("ethers");
require("dotenv").config();

async function main() {
  console.log("Testing flash loan on Polygon mainnet...");
  
  // Connect directly to Polygon
  const provider = new ethers.providers.JsonRpcProvider(
    process.env.POLYGON_MAINNET_RPC_URL
  );
  
  // Get network info
  const network = await provider.getNetwork();
  console.log(`Connected to: ${network.name} (chainId: ${network.chainId})`);
  
  // Current block
  const blockNumber = await provider.getBlockNumber();
  console.log(`Current block: ${blockNumber}`);
  
  // Create wallet
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  console.log(`Using wallet address: ${wallet.address}`);
  
  // Contract info
  const contractAddress = process.env.ARBITRAGE_FLASH_LOAN_ADDRESS_MAINNET;
  console.log(`Contract address: ${contractAddress}`);
  
  // Simple ABI for flash loan function
  const abi = [
    "function executeFlashLoan(address _asset, uint256 _amount) external",
    "event ArbitrageExecuted(address indexed tokenBorrowed, uint256 amount, uint256 profit)"
  ];
  
  // Create contract instance
  const flashLoanContract = new ethers.Contract(contractAddress, abi, wallet);
  
  // DAI token address on Polygon
  const DAI = "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063";
  
  // Loan amount - start with a smaller amount for testing
  const amountToLoan = ethers.utils.parseEther("100"); // 100 DAI instead of 1000
  console.log(`Loan amount: ${ethers.utils.formatEther(amountToLoan)} DAI`);
  
  try {
    console.log("Executing flash loan...");
    
    const gasPrice = await provider.getGasPrice();
    console.log(`Current gas price: ${ethers.utils.formatUnits(gasPrice, "gwei")} gwei`);
    
    // Execute flash loan with specific gas settings
    const tx = await flashLoanContract.executeFlashLoan(DAI, amountToLoan, {
      gasLimit: 3000000, // Higher gas limit for complex operations
      gasPrice: gasPrice.mul(12).div(10) // Use 1.2x current gas price
    });
    
    console.log(`Transaction submitted: ${tx.hash}`);
    console.log(`Polygonscan URL: https://polygonscan.com/tx/${tx.hash}`);
    
    console.log("Waiting for confirmation...");
    const receipt = await tx.wait();
    
    console.log("Transaction confirmed!");
    console.log(`Block: ${receipt.blockNumber}`);
    console.log(`Gas used: ${receipt.gasUsed.toString()}`);
    
    // Check for events
    const executeEvent = receipt.events?.find(e => 
      e.topics && e.topics[0] === ethers.utils.id("ArbitrageExecuted(address,uint256,uint256)")
    );
    
    if (executeEvent) {
      const decodedData = ethers.utils.defaultAbiCoder.decode(
        ["address", "uint256", "uint256"],
        executeEvent.data
      );
      console.log(`Profit: ${ethers.utils.formatEther(decodedData[2])} ETH`);
    } else {
      console.log("No ArbitrageExecuted event found");
    }
    
  } catch (error) {
    console.error("Error executing flash loan:", error.message);
    if (error.reason) {
      console.error("Reason:", error.reason);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });