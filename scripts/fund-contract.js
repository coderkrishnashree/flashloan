// scripts/fund-contract.js
const { ethers } = require("hardhat");
require("dotenv").config();

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("Using account:", signer.address);
  
  const contractAddress = process.env.ADVANCED_ARBITRAGE_BOT_ADDRESS_MAINNET;
  console.log("Contract address:", contractAddress);
  
  // Define DAI token address and ABI
  const DAI = "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063";
  const tokenAbi = [
    "function transfer(address to, uint256 amount) external returns (bool)",
    "function balanceOf(address account) external view returns (uint256)",
    "function decimals() external view returns (uint8)",
    "function approve(address spender, uint256 amount) external returns (bool)"
  ];
  
  // Connect to DAI contract
  const daiContract = await ethers.getContractAt(tokenAbi, DAI);
  
  // Check balance
  const balance = await daiContract.balanceOf(signer.address);
  const decimals = await daiContract.decimals();
  console.log(`DAI balance: ${ethers.utils.formatUnits(balance, decimals)} DAI`);
  
  if (balance.eq(0)) {
    console.error("No DAI available. Please acquire some DAI first.");
    return;
  }
  
  // Amount to transfer - 0.1 DAI (more than enough for several attempts)
  const transferAmount = ethers.utils.parseUnits("0.1", decimals);
  
  // Check if we have enough
  if (balance.lt(transferAmount)) {
    console.warn(`Insufficient DAI. You have ${ethers.utils.formatUnits(balance, decimals)} but trying to transfer ${ethers.utils.formatUnits(transferAmount, decimals)}`);
    console.log("Transferring all available DAI instead.");
    transferAmount = balance;
  }
  
  console.log(`Transferring ${ethers.utils.formatUnits(transferAmount, decimals)} DAI to contract...`);
  
  // Send DAI to contract
  const tx = await daiContract.transfer(contractAddress, transferAmount);
  console.log("Transaction sent:", tx.hash);
  
  // Wait for confirmation
  console.log("Waiting for confirmation...");
  await tx.wait();
  
  // Check new balances
  const newContractBalance = await daiContract.balanceOf(contractAddress);
  const newSignerBalance = await daiContract.balanceOf(signer.address);
  
  console.log(`Transfer complete!`);
  console.log(`Contract DAI balance: ${ethers.utils.formatUnits(newContractBalance, decimals)} DAI`);
  console.log(`Your DAI balance: ${ethers.utils.formatUnits(newSignerBalance, decimals)} DAI`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error funding contract:", error);
    process.exit(1);
  });