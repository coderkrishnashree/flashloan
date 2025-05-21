const { ethers } = require("ethers");

class MevProtection {
  constructor(provider, privateKey) {
    this.provider = provider;
    
    // Handle private key formatting
    const formattedKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
    this.wallet = new ethers.Wallet(formattedKey, provider);
    
    this.flashbotsEndpoint = "https://relay.flashbots.net";
    
    // For Polygon we can't use the same MEV protection as Ethereum
    console.log("MEV Protection initialized - Note: Full Flashbots protection is not available on Polygon");
    console.log("Using standard transaction methods with appropriate gas pricing");
  }
  
  // Get the optimal gas price with a small bonus to ensure quick inclusion
  async getOptimalGasPrice() {
    const gasPrice = await this.provider.getGasPrice();
    return gasPrice.mul(110).div(100); // 10% bonus
  }
  
  // For Polygon, we use a standard transaction with proper gas price
  async sendProtectedTransaction(transaction) {
    try {
      const gasPrice = await this.getOptimalGasPrice();
      const tx = {
        ...transaction,
        gasPrice
      };
      
      return await this.wallet.sendTransaction(tx);
    } catch (error) {
      throw new Error(`MEV Protection error: ${error.message}`);
    }
  }
}

module.exports = MevProtection;