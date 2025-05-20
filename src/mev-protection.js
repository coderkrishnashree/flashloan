const { ethers } = require("ethers");
require("dotenv").config();

class MevProtection {
  constructor(provider, privateKey) {
    this.provider = provider;
    this.wallet = new ethers.Wallet(privateKey, provider);
    
    // Get gas price multiplier from env or use default
    this.priorityMultiplier = parseFloat(process.env.GAS_PRICE_MULTIPLIER || "1.2");
  }
  
  async calculateOptimalGasPrice() {
    try {
      // Get current gas price
      const baseGasPrice = await this.provider.getGasPrice();
      
      // Add a premium to have higher priority (using multiplier from env)
      const optimalGasPrice = baseGasPrice.mul(Math.floor(this.priorityMultiplier * 100)).div(100);
      
      return optimalGasPrice;
    } catch (error) {
      console.error("Error calculating optimal gas price:", error.message);
      // Return a fallback gas price if there's an error
      return ethers.utils.parseUnits("50", "gwei");
    }
  }
  
  async sendPrivateTransaction(tx) {
    // In a real MEV protection system, you would:
    // 1. Use private RPC endpoints or services like Flashbots
    // 2. Bundle transactions to avoid front-running
    
    // For this learning example, we'll simply sign and send the transaction
    // with optimized gas price
    try {
      // Calculate optimal gas price
      tx.gasPrice = await this.calculateOptimalGasPrice();
      
      // Sign and send the transaction
      const signedTx = await this.wallet.signTransaction(tx);
      const txResponse = await this.provider.sendTransaction(signedTx);
      
      console.log(`Transaction sent with hash: ${txResponse.hash}`);
      return txResponse;
    } catch (error) {
      console.error("Error sending private transaction:", error.message);
      throw error;
    }
  }
}

module.exports = MevProtection;