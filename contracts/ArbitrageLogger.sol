// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

/**
 * @title ArbitrageLogger
 * @dev Logger contract for tracking arbitrage bot execution steps
 */
contract ArbitrageLogger {
    // Events for tracking execution
    event ExecutionProgress(uint256 id, string step, string details);
    event ExecutionError(uint256 id, string step, string error);
    event SwapResult(uint256 id, string exchange, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut);
    event BalanceSnapshot(uint256 id, string point, address token, uint256 balance);
    event ProfitReport(uint256 id, address token, uint256 initialBalance, uint256 finalBalance, uint256 profit, bool isSuccess);
    
    // Execution ID counter
    uint256 public executionCount;
    address public owner;
    
    constructor() public {
        owner = msg.sender;
    }
    
    modifier onlyOwnerOrBot() {
        require(msg.sender == owner || authorizedBots[msg.sender], "Not authorized");
        _;
    }
    
    // Authorized bots that can call logging functions
    mapping(address => bool) public authorizedBots;
    
    // Allow owner to authorize bots
    function setAuthorizedBot(address _bot, bool _status) external {
        require(msg.sender == owner, "Only owner");
        authorizedBots[_bot] = _status;
    }
    
    // Create a new execution ID
    function startExecution() public onlyOwnerOrBot returns (uint256) {
        executionCount++;
        emit ExecutionProgress(executionCount, "START", "New execution started");
        return executionCount;
    }
    
    // Log a step
    function logStep(uint256 id, string memory step, string memory details) public onlyOwnerOrBot {
        emit ExecutionProgress(id, step, details);
    }
    
    // Log an error
    function logError(uint256 id, string memory step, string memory error) public onlyOwnerOrBot {
        emit ExecutionError(id, step, error);
    }
    
    // Log a swap result
    function logSwap(uint256 id, string memory exchange, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut) public onlyOwnerOrBot {
        emit SwapResult(id, exchange, tokenIn, tokenOut, amountIn, amountOut);
    }
    
    // Log token balance at a certain point
    function logBalance(uint256 id, string memory point, address token, uint256 balance) public onlyOwnerOrBot {
        emit BalanceSnapshot(id, point, token, balance);
    }
    
    // Log final profit report
    function logProfit(uint256 id, address token, uint256 initialBalance, uint256 finalBalance, uint256 profit, bool isSuccess) public onlyOwnerOrBot {
        emit ProfitReport(id, token, initialBalance, finalBalance, profit, isSuccess);
    }
}