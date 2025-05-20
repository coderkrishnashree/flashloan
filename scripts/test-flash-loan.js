const { ethers } = require("hardhat");

async function main() {
  console.log("Testing flash loan functionality...");
  
  // Get the deployed contract
  const arbitrageFlashLoan = await ethers.getContract("ArbitrageFlashLoan");
  
// Define test parameters
const DAI = "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063"; // DAI address on Polygon
const amountToLoan = ethers.utils.parseEther("1000"); // 1000 DAI
  
  // Execute a flash loan
  try {
    const tx = await arbitrageFlashLoan.executeFlashLoan(DAI, amountToLoan);
    console.log("Flash loan transaction hash:", tx.hash);
    
    const receipt = await tx.wait();
    console.log("Flash loan executed successfully!");
    
    // Check for events
    const events = receipt.events?.filter((x) => x.event === "ArbitrageExecuted");
    if (events && events.length > 0) {
      console.log("Arbitrage profit:", ethers.utils.formatEther(events[0].args.profit), "ETH");
    }
  } catch (error) {
    console.error("Error executing flash loan:", error.message);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });