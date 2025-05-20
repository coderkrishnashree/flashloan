const { ethers, network } = require("hardhat");
require("dotenv").config();

async function main() {
  console.log("Testing flash loan functionality...");
  console.log(`Current network: ${network.name} (chainId: ${network.config.chainId})`);
  
  // Get the provider and check which network we're connected to
  const provider = ethers.provider;
  const networkName = (await provider.getNetwork()).name;
  const chainId = (await provider.getNetwork()).chainId;
  console.log(`Connected to network: ${networkName} (chainId: ${chainId})`);
  
  // Get the block number to confirm connection
  const blockNumber = await provider.getBlockNumber();
  console.log(`Current block number: ${blockNumber}`);
  
  // Get the deployed contract using the address from .env
  const contractAddress = process.env.ARBITRAGE_FLASH_LOAN_ADDRESS_MAINNET;
  console.log(`Using contract address: ${contractAddress}`);
  
  if (!contractAddress) {
    throw new Error("ARBITRAGE_FLASH_LOAN_ADDRESS_MAINNET not set in .env file");
  }
  
  // Get the contract factory
  const ArbitrageFlashLoan = await ethers.getContractFactory("ArbitrageFlashLoan");
  
  // Connect to the deployed contract
  const arbitrageFlashLoan = ArbitrageFlashLoan.attach(contractAddress);
  
  // Define test parameters
  const DAI = "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063"; // DAI address on Polygon
  console.log(`Using DAI address: ${DAI}`);
  
  const amountToLoan = ethers.utils.parseEther("1000"); // 1000 DAI
  console.log(`Loan amount: ${ethers.utils.formatEther(amountToLoan)} DAI`);
  
  // Execute a flash loan
  try {
    // Get the wallet we're using to submit the transaction
    const [signer] = await ethers.getSigners();
    console.log(`Submitting transaction from: ${signer.address}`);
    
    console.log("Sending transaction...");
    const tx = await arbitrageFlashLoan.executeFlashLoan(DAI, amountToLoan);
    
    console.log("Transaction details:");
    console.log(`- Hash: ${tx.hash}`);
    console.log(`- From: ${tx.from}`);
    console.log(`- To: ${tx.to}`);
    console.log(`- Nonce: ${tx.nonce}`);
    console.log(`- Gas limit: ${tx.gasLimit.toString()}`);
    console.log(`- Gas price: ${ethers.utils.formatUnits(tx.gasPrice, "gwei")} gwei`);
    console.log(`- Chain ID: ${tx.chainId}`);
    
    console.log("Waiting for transaction confirmation...");
    const receipt = await tx.wait();
    
    console.log("Transaction confirmed!");
    console.log(`- Block number: ${receipt.blockNumber}`);
    console.log(`- Gas used: ${receipt.gasUsed.toString()}`);
    console.log(`- Status: ${receipt.status === 1 ? "Success" : "Failed"}`);
    
    // Check for events
    const events = receipt.events?.filter((x) => x.event === "ArbitrageExecuted");
    if (events && events.length > 0) {
      console.log("Arbitrage profit:", ethers.utils.formatEther(events[0].args.profit), "ETH");
    } else {
      console.log("No ArbitrageExecuted event found");
    }
  } catch (error) {
    console.error("Error executing flash loan:", error.message);
    if (error.error) {
      console.error("Error details:", error.error);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });