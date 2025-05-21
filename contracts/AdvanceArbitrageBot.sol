// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@aave/protocol-v2/contracts/flashloan/base/FlashLoanReceiverBase.sol";
import "@aave/protocol-v2/contracts/interfaces/ILendingPoolAddressesProvider.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./StringUtils.sol";

// Interface for ArbitrageLogger contract
interface IArbitrageLogger {
    function startExecution() external returns (uint256);
    function logStep(uint256 id, string calldata step, string calldata details) external;
    function logError(uint256 id, string calldata step, string calldata error) external;
    function logSwap(uint256 id, string calldata exchange, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut) external;
    function logBalance(uint256 id, string calldata point, address token, uint256 balance) external;
    function logProfit(uint256 id, address token, uint256 initialBalance, uint256 finalBalance, uint256 profit, bool isSuccess) external;
    function setAuthorizedBot(address _bot, bool _status) external;
}

// Interface for Uniswap V2 Router (reduced)
interface IUniswapV2Router {
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);
}

// Interface for ERC20 tokens (reduced)
interface IERC20Extended {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

contract AdvancedArbitrageBot is FlashLoanReceiverBase, Ownable, ReentrancyGuard {
    using SafeMath for uint256;
    using StringUtils for address;
    using StringUtils for uint256;
    
    // DEX Routers
    address public immutable uniswapRouter;
    address public immutable sushiswapRouter;
    
    // Strategy parameters
    uint256 public minProfitThreshold;
    uint256 public slippageTolerance;
    
    // Security measures
    mapping(address => bool) public authorizedCallers;
    bool public emergencyStop;
    
    // Logging contract
    IArbitrageLogger public logger;
    
    // Current execution ID
    uint256 private currentExecutionId;
    
    // Events
    event ArbitrageExecuted(address indexed tokenBorrowed, uint256 amount, uint256 profit);
    event EmergencyWithdrawal(address token, uint256 amount);
    
    // Strategy types
    uint8 private constant STRATEGY_SIMPLE = 1;
    uint8 private constant STRATEGY_MULTI_DEX = 2;
    
    constructor(
        address _addressProvider,
        address _uniswapRouter,
        address _sushiswapRouter,
        address _logger
    ) 
        FlashLoanReceiverBase(ILendingPoolAddressesProvider(_addressProvider)) 
        public 
    {
        uniswapRouter = _uniswapRouter;
        sushiswapRouter = _sushiswapRouter;
        minProfitThreshold = 0;
        slippageTolerance = 50;
        authorizedCallers[msg.sender] = true;
        logger = IArbitrageLogger(_logger);
        // Removed external calls
    }
    
    // Initialize logger - call after deployment
    function initializeLogger() external onlyOwner {
        logger.setAuthorizedBot(address(this), true);
        uint256 logId = logger.startExecution();
        logger.logStep(logId, "INIT", "Bot initialized successfully");
    }
    
    modifier onlyAuthorized() {
        require(authorizedCallers[msg.sender], "Not authorized");
        _;
    }
    
    modifier whenNotStopped() {
        require(!emergencyStop, "Stopped");
        _;
    }
    
    // Execute a flash loan with strategy data
    function executeArbitrage(
        address _asset,
        uint256 _amount,
        bytes calldata _strategyData,
        bytes32 _secretHash
    ) external onlyAuthorized whenNotStopped nonReentrant {
        currentExecutionId = logger.startExecution();
        logger.logStep(currentExecutionId, "INIT", StringUtils.concatAddressInfo("Asset: ", _asset, ""));
        
        // Check initial balances
        uint256 initialAssetBalance = IERC20Extended(_asset).balanceOf(address(this));
        logger.logBalance(currentExecutionId, "INITIAL", _asset, initialAssetBalance);
        
        // Validate hash
        require(keccak256(_strategyData) == _secretHash, "Invalid hash");
        logger.logStep(currentExecutionId, "HASH", "Valid");
        
        // Setup flash loan params
        address[] memory assets = new address[](1);
        assets[0] = _asset;
        
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = _amount;
        
        uint256[] memory modes = new uint256[](1);
        modes[0] = 0; // no debt
        
        logger.logStep(currentExecutionId, "LOAN_REQ", "Requesting loan");
        
        // Execute flash loan
        LENDING_POOL.flashLoan(
            address(this),
            assets,
            amounts,
            modes,
            address(this),
            _strategyData,
            0
        );
        
        logger.logStep(currentExecutionId, "LOAN_SUCCESS", "Loan completed");
        
        // Log final result
        uint256 finalBalance = IERC20Extended(_asset).balanceOf(address(this));
        uint256 profit = finalBalance > initialAssetBalance ? finalBalance - initialAssetBalance : 0;
        logger.logProfit(currentExecutionId, _asset, initialAssetBalance, finalBalance, profit, true);
    }
    
    // Flash loan callback
    function executeOperation(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        address,  // initiator - unused
        bytes calldata params
    ) external override returns (bool) {
        logger.logStep(currentExecutionId, "EXECUTE", "Loan received");
        
        // Security check
        require(msg.sender == address(LENDING_POOL), "Invalid caller");
        logger.logStep(currentExecutionId, "SECURITY", "Passed");
        
        // Extract details
        address borrowedAsset = assets[0];
        uint256 borrowedAmount = amounts[0];
        uint256 amountToRepay = borrowedAmount.add(premiums[0]);
        
        logger.logStep(currentExecutionId, "LOAN_DETAILS", 
            StringUtils.concatUintInfo("Borrowed: ", borrowedAmount, ""));
        
        // Log balance
        uint256 currentBalance = IERC20Extended(borrowedAsset).balanceOf(address(this));
        logger.logBalance(currentExecutionId, "AFTER_LOAN", borrowedAsset, currentBalance);
        
        // Check premium
        uint256 initialBalanceForPremium = currentBalance.sub(borrowedAmount);
        require(initialBalanceForPremium >= premiums[0], "Insufficient premium");
        logger.logStep(currentExecutionId, "PREMIUM", "Sufficient funds");
        
        // Execute strategy with error handling
        bool strategySuccess = false;
        string memory errorMsg = "";
        
        try this.executeStrategyExternal(borrowedAsset, borrowedAmount, params) {
            strategySuccess = true;
            logger.logStep(currentExecutionId, "STRATEGY", "Success");
        } catch Error(string memory reason) {
            errorMsg = reason;
            logger.logError(currentExecutionId, "STRATEGY", reason);
        } catch {
            errorMsg = "Unknown error";
            logger.logError(currentExecutionId, "STRATEGY", "Unknown error");
        }
        
        // Handle strategy failure
        if (!strategySuccess) {
            uint256 balanceAfterError = IERC20Extended(borrowedAsset).balanceOf(address(this));
            logger.logBalance(currentExecutionId, "ERROR", borrowedAsset, balanceAfterError);
            revert(errorMsg);
        }
        
        // Calculate profit
        uint256 finalBalance = IERC20Extended(borrowedAsset).balanceOf(address(this));
        logger.logBalance(currentExecutionId, "FINAL", borrowedAsset, finalBalance);
        
        // Check repayment
        require(finalBalance >= amountToRepay, "Insufficient to repay");
        
        uint256 profit = finalBalance.sub(amountToRepay);
        logger.logStep(currentExecutionId, "PROFIT", StringUtils.uintToString(profit));
        
        // Check profit threshold
        require(profit >= minProfitThreshold, "Profit below threshold");
        logger.logStep(currentExecutionId, "THRESHOLD", "Passed");
        
        // Approve repayment
        IERC20Extended(borrowedAsset).approve(address(LENDING_POOL), amountToRepay);
        logger.logStep(currentExecutionId, "APPROVAL", "Approved for repayment");
        
        // Emit success
        emit ArbitrageExecuted(borrowedAsset, borrowedAmount, profit);
        logger.logProfit(currentExecutionId, borrowedAsset, currentBalance, finalBalance, profit, true);
        
        logger.logStep(currentExecutionId, "COMPLETE", "Success");
        return true;
    }
    
    // External function for try/catch
    function executeStrategyExternal(
        address borrowedAsset,
        uint256 borrowedAmount,
        bytes calldata params
    ) external {
        require(msg.sender == address(this), "Self-call only");
        _executeStrategy(borrowedAsset, borrowedAmount, params);
    }
    
    // Strategy execution
    function _executeStrategy(
        address borrowedAsset,
        uint256 borrowedAmount,
        bytes calldata params
    ) internal {
        logger.logStep(currentExecutionId, "STRATEGY_START", "Decoding");
        
        // Decode strategy type
        (uint8 strategyType,,) = abi.decode(params, (uint8, address[], uint256[]));
        logger.logStep(currentExecutionId, "TYPE", StringUtils.uintToString(strategyType));
        
        if (strategyType == STRATEGY_SIMPLE) {
            logger.logStep(currentExecutionId, "SELECT", "Simple strategy");
            _executeSimpleStrategy(borrowedAsset, borrowedAmount, params);
        } else if (strategyType == STRATEGY_MULTI_DEX) {
            logger.logStep(currentExecutionId, "SELECT", "Multi-DEX strategy");
            _executeMultiStrategy(borrowedAsset, borrowedAmount, params);
        } else {
            logger.logError(currentExecutionId, "SELECT", "Unknown type");
            revert("Unknown strategy type");
        }
    }
    
    // Simple strategy execution - REDUCED FOR BREVITY
    function _executeSimpleStrategy(
        address borrowedAsset,
        uint256 borrowedAmount,
        bytes calldata params
    ) internal {
        // Decode parameters
        (, address[] memory path, uint256[] memory minAmountsOut) = 
            abi.decode(params, (uint8, address[], uint256[]));
        
        // Approve and swap on Uniswap
        IERC20Extended(borrowedAsset).approve(uniswapRouter, borrowedAmount);
        uint256 beforeUniswap = IERC20Extended(path[1]).balanceOf(address(this));
        
        try IUniswapV2Router(uniswapRouter).swapExactTokensForTokens(
            borrowedAmount,
            minAmountsOut[0], 
            path,
            address(this),
            block.timestamp + 300
        ) returns (uint[] memory) {
            uint256 afterBalanceUniswap = IERC20Extended(path[1]).balanceOf(address(this));
            uint256 receivedAmount = afterBalanceUniswap.sub(beforeUniswap);
            logger.logSwap(
                currentExecutionId,
                "Uniswap",
                path[0],
                path[1],
                borrowedAmount,
                receivedAmount
            );
        } catch Error(string memory reason) {
            logger.logError(currentExecutionId, "UNISWAP", reason);
            revert(reason);
        } catch {
            logger.logError(currentExecutionId, "UNISWAP", "Unknown error");
            revert("Uniswap error");
        }
        
        // Swap back on Sushiswap
        address intermediateToken = path[1];
        uint256 intermediateAmount = IERC20Extended(intermediateToken).balanceOf(address(this));
        IERC20Extended(intermediateToken).approve(sushiswapRouter, intermediateAmount);
        
        address[] memory reversePath = new address[](2);
        reversePath[0] = path[1];
        reversePath[1] = path[0];
        
        uint256 beforeSushi = IERC20Extended(path[0]).balanceOf(address(this));
        
        try IUniswapV2Router(sushiswapRouter).swapExactTokensForTokens(
            intermediateAmount,
            minAmountsOut[1],
            reversePath,
            address(this),
            block.timestamp + 300
        ) returns (uint[] memory) {
            uint256 afterBalanceSushi = IERC20Extended(path[0]).balanceOf(address(this));
            uint256 receivedAmount = afterBalanceSushi.sub(beforeSushi);
            logger.logSwap(
                currentExecutionId,
                "Sushiswap",
                reversePath[0],
                reversePath[1],
                intermediateAmount,
                receivedAmount
            );
        } catch Error(string memory reason) {
            logger.logError(currentExecutionId, "SUSHISWAP", reason);
            revert(reason);
        } catch {
            logger.logError(currentExecutionId, "SUSHISWAP", "Unknown error");
            revert("Sushiswap error");
        }
    }
    
    // Multi-DEX strategy execution - HEAVILY SIMPLIFIED
    function _executeMultiStrategy(
        address borrowedAsset,
        uint256 borrowedAmount,
        bytes calldata params
    ) internal {
        // Just a simplified placeholder to reduce contract size
        (, address[] memory path, uint256[] memory minAmountsOut) = 
            abi.decode(params, (uint8, address[], uint256[]));
            
        (,,, address[] memory routers) = 
            abi.decode(params, (uint8, address[], uint256[], address[]));
        
        require(path.length >= 3, "Path too short");
        require(routers.length >= 2, "Not enough routers");
        
        // Execute first router swap
        uint256 firstPortionAmount = borrowedAmount.mul(70).div(100);
        uint256 secondPortionAmount = borrowedAmount.sub(firstPortionAmount);
        
        // Create path
        address[] memory firstHopPath = new address[](2);
        firstHopPath[0] = path[0];
        firstHopPath[1] = path[1];
        
        // Execute multi-router strategy
        _executeFirstSwap(borrowedAsset, firstPortionAmount, routers[0], firstHopPath, minAmountsOut[0]);
        _executeSecondSwap(borrowedAsset, secondPortionAmount, routers[1], firstHopPath, minAmountsOut[1]);
        _executeSecondHopSimplified(path, minAmountsOut[2], routers[0]);
    }
    
    // Helper for first router swap
    function _executeFirstSwap(
        address asset, 
        uint256 amount,
        address router,
        address[] memory path,
        uint256 minOut
    ) internal {
        IERC20Extended(asset).approve(router, amount);
        uint256 before = IERC20Extended(path[1]).balanceOf(address(this));
        
        IUniswapV2Router(router).swapExactTokensForTokens(
            amount,
            minOut,
            path,
            address(this),
            block.timestamp + 300
        );
        
        uint256 afterBalance = IERC20Extended(path[1]).balanceOf(address(this));
        logger.logSwap(
            currentExecutionId,
            "Router1",
            path[0],
            path[1],
            amount,
            afterBalance.sub(before)
        );
    }
    
    // Helper for second router swap
    function _executeSecondSwap(
        address asset, 
        uint256 amount,
        address router,
        address[] memory path,
        uint256 minOut
    ) internal {
        IERC20Extended(asset).approve(router, amount);
        uint256 before = IERC20Extended(path[1]).balanceOf(address(this));
        
        IUniswapV2Router(router).swapExactTokensForTokens(
            amount,
            minOut,
            path,
            address(this),
            block.timestamp + 300
        );
        
        uint256 afterBalance = IERC20Extended(path[1]).balanceOf(address(this));
        logger.logSwap(
            currentExecutionId,
            "Router2",
            path[0],
            path[1],
            amount,
            afterBalance.sub(before)
        );
    }
    
    // Simplified second hop
    function _executeSecondHopSimplified(
        address[] memory path,
        uint256 minOut,
        address router
    ) internal {
        // Create path for second hop
        address[] memory secondHopPath = new address[](2);
        secondHopPath[0] = path[1]; 
        secondHopPath[1] = path[2];
        
        // Get balance
        address intermediateToken = path[1];
        uint256 intermediateAmount = IERC20Extended(intermediateToken).balanceOf(address(this));
        
        // Approve and swap
        IERC20Extended(intermediateToken).approve(router, intermediateAmount);
        uint256 before = IERC20Extended(path[2]).balanceOf(address(this));
        
        IUniswapV2Router(router).swapExactTokensForTokens(
            intermediateAmount,
            minOut,
            secondHopPath,
            address(this),
            block.timestamp + 300
        );
        
        uint256 afterBalance = IERC20Extended(path[2]).balanceOf(address(this));
        logger.logSwap(
            currentExecutionId,
            "FinalRouter",
            secondHopPath[0],
            secondHopPath[1],
            intermediateAmount,
            afterBalance.sub(before)
        );
    }
    
    // Emergency functions
    function setEmergencyStop(bool _stop) external onlyOwner {
        emergencyStop = _stop;
    }
    
    function emergencyWithdraw(address _token) external onlyOwner {
        uint256 balance = IERC20Extended(_token).balanceOf(address(this));
        IERC20Extended(_token).transfer(owner(), balance);
        emit EmergencyWithdrawal(_token, balance);
    }
    
    // Update parameters
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
    
    // Receive ETH
    receive() external payable {}
}