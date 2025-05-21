// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@aave/protocol-v2/contracts/flashloan/base/FlashLoanReceiverBase.sol";
import "@aave/protocol-v2/contracts/interfaces/ILendingPoolAddressesProvider.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

// Interface for Uniswap V2 Router
interface IUniswapV2Router {
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);
    
    function getAmountsOut(uint amountIn, address[] calldata path) 
        external view returns (uint[] memory amounts);
}

contract AdvancedArbitrageBot is FlashLoanReceiverBase, Ownable, ReentrancyGuard {
    using SafeMath for uint256;
    
    // DEX Routers
    address public immutable uniswapRouter;
    address public immutable sushiswapRouter;
    
    // Strategy parameters
    uint256 public minProfitThreshold;
    uint256 public slippageTolerance;
    
    // Security measures
    mapping(address => bool) public authorizedCallers;
    bool public emergencyStop;
    
    // Events
    event ArbitrageExecuted(address indexed tokenBorrowed, uint256 amount, uint256 profit);
    event EmergencyWithdrawal(address token, uint256 amount);
    
    // Strategy types
    uint8 private constant STRATEGY_SIMPLE = 1;
    uint8 private constant STRATEGY_MULTI_DEX = 2;
    
    constructor(
        address _addressProvider,
        address _uniswapRouter,
        address _sushiswapRouter
    ) 
        FlashLoanReceiverBase(ILendingPoolAddressesProvider(_addressProvider)) 
        public 
    {
        uniswapRouter = _uniswapRouter;
        sushiswapRouter = _sushiswapRouter;
        minProfitThreshold = 0.1 ether; // 0.1 ETH worth of profit minimum
        slippageTolerance = 50; // 0.5% slippage tolerance
        authorizedCallers[msg.sender] = true;
    }
    
    modifier onlyAuthorized() {
        require(authorizedCallers[msg.sender], "Caller not authorized");
        _;
    }
    
    modifier whenNotStopped() {
        require(!emergencyStop, "Contract is paused");
        _;
    }
    
    // Execute a flash loan with strategy data
    function executeArbitrage(
        address _asset,
        uint256 _amount,
        bytes calldata _strategyData,
        bytes32 _secretHash
    ) external onlyAuthorized whenNotStopped nonReentrant {
        // Validate the strategy hash to prevent front-running
        require(keccak256(_strategyData) == _secretHash, "Invalid strategy data");
        
        address[] memory assets = new address[](1);
        assets[0] = _asset;
        
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = _amount;
        
        uint256[] memory modes = new uint256[](1);
        modes[0] = 0; // no debt
        
        LENDING_POOL.flashLoan(
            address(this),
            assets,
            amounts,
            modes,
            address(this),
            _strategyData, // Pass our encrypted strategy data
            0 // referral code
        );
    }
    
    // This is where the magic happens - complex arbitrage execution
    function executeOperation(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        // Security check
        require(msg.sender == address(LENDING_POOL), "Invalid caller");
        
        // Extract borrowed asset and amount details first to reduce stack depth
        address borrowedAsset = assets[0];
        uint256 borrowedAmount = amounts[0];
        uint256 amountToRepay = borrowedAmount.add(premiums[0]);
        
        // Record gas left to ensure we don't run out of gas
        uint256 gasStart = gasleft();
        
        // Execute strategy
        _executeStrategy(borrowedAsset, borrowedAmount, params);
        
        // Check if we have enough gas left for the remaining operations
        require(gasleft() > gasStart.div(4), "Gas running low");
        
        // Calculate profit
        uint256 finalBalance = IERC20(borrowedAsset).balanceOf(address(this));
        require(finalBalance >= amountToRepay, "Insufficient funds to repay");
        uint256 profit = finalBalance.sub(amountToRepay);
        
        // Ensure profit meets minimum threshold
        require(profit >= minProfitThreshold, "Profit below threshold");
        
        // Approve repayment
        IERC20(borrowedAsset).approve(address(LENDING_POOL), amountToRepay);
        
        // Emit success event
        emit ArbitrageExecuted(borrowedAsset, borrowedAmount, profit);
        
        return true;
    }
    
    // Handle strategy execution to reduce stack depth
    function _executeStrategy(
        address borrowedAsset,
        uint256 borrowedAmount,
        bytes calldata params
    ) internal {
        // Decode strategy type first
        (uint8 strategyType,,) = abi.decode(params, (uint8, address[], uint256[]));
        
        if (strategyType == STRATEGY_SIMPLE) {
            _executeSimpleStrategy(borrowedAsset, borrowedAmount, params);
        } else if (strategyType == STRATEGY_MULTI_DEX) {
            _executeMultiStrategy(borrowedAsset, borrowedAmount, params);
        }
    }
    
    // Simple strategy execution
    function _executeSimpleStrategy(
        address borrowedAsset,
        uint256 borrowedAmount,
        bytes calldata params
    ) internal {
        // Split the decoding to avoid stack too deep
        (, address[] memory path, uint256[] memory minAmountsOut) = 
            abi.decode(params, (uint8, address[], uint256[]));
        
        // Approve Uniswap router
        IERC20(borrowedAsset).approve(uniswapRouter, borrowedAmount);
        
        // Swap on Uniswap
        IUniswapV2Router(uniswapRouter).swapExactTokensForTokens(
            borrowedAmount,
            minAmountsOut[0], 
            path,
            address(this),
            block.timestamp.add(300)
        );
        
        // Approve Sushiswap router
        address intermediateToken = path[1];
        uint256 intermediateAmount = IERC20(intermediateToken).balanceOf(address(this));
        IERC20(intermediateToken).approve(sushiswapRouter, intermediateAmount);
        
        // Create reverse path
        address[] memory reversePath = new address[](2);
        reversePath[0] = path[1];
        reversePath[1] = path[0];
        
        // Swap back on Sushiswap
        IUniswapV2Router(sushiswapRouter).swapExactTokensForTokens(
            intermediateAmount,
            minAmountsOut[1],
            reversePath,
            address(this),
            block.timestamp.add(300)
        );
    }
    
    // Multi-DEX strategy execution
    function _executeMultiStrategy(
        address borrowedAsset,
        uint256 borrowedAmount,
        bytes calldata params
    ) internal {
        // Split the decoding to avoid stack too deep
        (, address[] memory path, uint256[] memory minAmountsOut) = 
            abi.decode(params, (uint8, address[], uint256[]));
            
        // Get routers from another field
        (,,, address[] memory routers) = 
            abi.decode(params, (uint8, address[], uint256[], address[]));
        
        require(path.length >= 3, "Path too short for multi-dex strategy");
        require(routers.length >= 2, "Not enough routers provided");
        
        // Calculate optimal split for the first trade
        uint256 firstPortionAmount = borrowedAmount.mul(70).div(100);
        uint256 secondPortionAmount = borrowedAmount.sub(firstPortionAmount);
        
        // Create sub-paths
        address[] memory firstHopPath = new address[](2);
        firstHopPath[0] = path[0];
        firstHopPath[1] = path[1];
        
        // Approve first router
        IERC20(borrowedAsset).approve(routers[0], firstPortionAmount);
        
        // Execute first part of trade on first router
        IUniswapV2Router(routers[0]).swapExactTokensForTokens(
            firstPortionAmount,
            minAmountsOut[0],
            firstHopPath,
            address(this),
            block.timestamp.add(300)
        );
        
        // Approve second router
        IERC20(borrowedAsset).approve(routers[1], secondPortionAmount);
        
        // Execute second part of trade on second router
        IUniswapV2Router(routers[1]).swapExactTokensForTokens(
            secondPortionAmount,
            minAmountsOut[1],
            firstHopPath,
            address(this),
            block.timestamp.add(300)
        );
        
        _executeSecondHop(path, minAmountsOut, routers);
    }
    
    // Split the second hop to avoid stack too deep
    function _executeSecondHop(
        address[] memory path,
        uint256[] memory minAmountsOut,
        address[] memory routers
    ) internal {
        // Create second hop path
        address[] memory secondHopPath = new address[](2);
        secondHopPath[0] = path[1]; 
        secondHopPath[1] = path[2];
        
        // Get intermediate token balance
        address intermediateToken = path[1];
        uint256 intermediateAmount = IERC20(intermediateToken).balanceOf(address(this));
        
        // Approve for final swap (use the first router for simplicity)
        IERC20(intermediateToken).approve(routers[0], intermediateAmount);
        
        // Execute final swap back to original token
        IUniswapV2Router(routers[0]).swapExactTokensForTokens(
            intermediateAmount,
            minAmountsOut[2],
            secondHopPath,
            address(this),
            block.timestamp.add(300)
        );
    }
    
    // Emergency functions
    function setEmergencyStop(bool _stop) external onlyOwner {
        emergencyStop = _stop;
    }
    
    function emergencyWithdraw(address _token) external onlyOwner {
        uint256 balance = IERC20(_token).balanceOf(address(this));
        IERC20(_token).transfer(owner(), balance);
        emit EmergencyWithdrawal(_token, balance);
    }
    
    // Update strategy parameters
    function updateParameters(
        uint256 _minProfitThreshold,
        uint256 _slippageTolerance
    ) external onlyOwner {
        minProfitThreshold = _minProfitThreshold;
        slippageTolerance = _slippageTolerance;
    }
    
    // Manage authorized callers
    function setAuthorizedCaller(address _caller, bool _status) external onlyOwner {
        authorizedCallers[_caller] = _status;
    }
    
    // Function to receive ETH
    receive() external payable {}
}