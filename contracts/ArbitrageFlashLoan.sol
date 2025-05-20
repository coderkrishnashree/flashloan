// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@aave/protocol-v2/contracts/flashloan/base/FlashLoanReceiverBase.sol";
import "@aave/protocol-v2/contracts/interfaces/ILendingPoolAddressesProvider.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract ArbitrageFlashLoan is FlashLoanReceiverBase, Ownable, ReentrancyGuard {
    using SafeMath for uint256;

    // Addresses for Mainnet DEX Routers
    address private constant UNISWAP_ROUTER = 0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D;
    address private constant SUSHISWAP_ROUTER = 0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F;
    
    // Strategy parameters
    uint256 public minProfitThreshold = 0.01 ether; // 0.01 ETH minimum profit
    
    // Events
    event ArbitrageExecuted(address indexed tokenBorrowed, uint256 amount, uint256 profit);
    
    constructor(address _addressProvider) 
        FlashLoanReceiverBase(ILendingPoolAddressesProvider(_addressProvider)) 
        public 
    {}
    
    function executeFlashLoan(address _asset, uint256 _amount) external onlyOwner nonReentrant {
        address[] memory assets = new address[](1);
        assets[0] = _asset;
        
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = _amount;
        
        uint256[] memory modes = new uint256[](1);
        modes[0] = 0; // 0 = no debt, 1 = stable, 2 = variable
        
        address onBehalfOf = address(this);
        bytes memory params = "";
        uint16 referralCode = 0;
        
        LENDING_POOL.flashLoan(
            address(this),
            assets,
            amounts,
            modes,
            onBehalfOf,
            params,
            referralCode
        );
    }
    
    function executeOperation(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        // Make sure this is called by the lending pool
        require(msg.sender == address(LENDING_POOL), "Not called by lending pool");
        
        // The asset we're borrowing
        address borrowedAsset = assets[0];
        uint256 borrowedAmount = amounts[0];
        uint256 fee = premiums[0];
        uint256 amountOwing = borrowedAmount.add(fee);
        
        // Record initial balance to calculate profit
        uint256 initialBalance = IERC20(borrowedAsset).balanceOf(address(this));
        
        // This is where you would implement your arbitrage logic
        // For example, you could trade on Uniswap, then Sushiswap
        // This is a placeholder for your custom trading logic
        
        // *** Arbitrage implementation would go here ***
        
        // Calculate profit
        uint256 finalBalance = IERC20(borrowedAsset).balanceOf(address(this));
        
        // Make sure we have enough to repay
        require(finalBalance >= amountOwing, "Insufficient funds to repay flash loan");
        
        // Check if we made enough profit
        uint256 profit = finalBalance.sub(amountOwing);
        require(profit >= minProfitThreshold, "Profit below threshold");
        
        // Approve the LendingPool contract to pull the owed amount + fee
        IERC20(borrowedAsset).approve(address(LENDING_POOL), amountOwing);
        
        // Emit an event
        emit ArbitrageExecuted(borrowedAsset, borrowedAmount, profit);
        
        return true;
    }
    
    // Function to withdraw all tokens of a specific ERC20 from this contract
    function withdrawToken(address _token) external onlyOwner {
        IERC20 token = IERC20(_token);
        uint256 balance = token.balanceOf(address(this));
        token.transfer(owner(), balance);
    }
    
    // Function to withdraw ETH that might be sent to this contract
    function withdrawETH() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }
    
    // Update the minimum profit threshold
    function setMinProfitThreshold(uint256 _threshold) external onlyOwner {
        minProfitThreshold = _threshold;
    }
    
    // Function to receive ETH when sent from other contracts
    receive() external payable {}
}