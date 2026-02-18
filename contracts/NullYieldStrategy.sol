// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "./IYieldStrategy.sol";

/**
 * @title NullYieldStrategy
 * @notice A "do nothing" yield strategy that simply holds USDC.
 *         This is the initial implementation - establishes the interface
 *         without adding yield complexity. Later, BeliefStake can migrate
 *         to AaveYieldStrategy or others.
 *
 * @dev This contract:
 *      - Accepts USDC deposits from BeliefStake (vault)
 *      - Holds USDC idle (no yield generation)
 *      - Returns USDC on withdrawal requests
 *      - Generates zero yield (pendingYield always 0)
 *
 *      Why use this instead of holding USDC directly in BeliefStake?
 *      - Establishes the yield strategy interface from day one
 *      - BeliefStake code doesn't change when switching to real yield
 *      - Migration is a single owner transaction
 *      - Future-proofing without added risk
 */
contract NullYieldStrategy is IYieldStrategy, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /*//////////////////////////////////////////////////////////////
                               IMMUTABLES
    //////////////////////////////////////////////////////////////*/

    /// @notice USDC token contract
    IERC20 private immutable _usdc;

    /// @notice BeliefStake contract (only address that can deposit/withdraw)
    address private immutable _vault;

    /*//////////////////////////////////////////////////////////////
                                 STATE
    //////////////////////////////////////////////////////////////*/

    /// @notice Total principal deposited
    uint256 private _principal;

    /*//////////////////////////////////////////////////////////////
                                 EVENTS
    //////////////////////////////////////////////////////////////*/

    event Deposited(uint256 amount);
    event Withdrawn(uint256 amount);
    event TokensRescued(address indexed token, address indexed to, uint256 amount);

    /*//////////////////////////////////////////////////////////////
                                 ERRORS
    //////////////////////////////////////////////////////////////*/

    error OnlyVault();
    error InvalidAddress();
    error InsufficientBalance();

    /*//////////////////////////////////////////////////////////////
                               MODIFIERS
    //////////////////////////////////////////////////////////////*/

    modifier onlyVault() {
        if (msg.sender != _vault) revert OnlyVault();
        _;
    }

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    /**
     * @param usdcAddress Address of USDC token
     * @param vaultAddress Address of BeliefStake contract
     */
    constructor(address usdcAddress, address vaultAddress) Ownable(msg.sender) {
        if (usdcAddress == address(0)) revert InvalidAddress();
        if (vaultAddress == address(0)) revert InvalidAddress();
        _usdc = IERC20(usdcAddress);
        _vault = vaultAddress;
    }

    /*//////////////////////////////////////////////////////////////
                           VAULT FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /// @inheritdoc IYieldStrategy
    function deposit(uint256 amount) external override onlyVault nonReentrant {
        _usdc.safeTransferFrom(msg.sender, address(this), amount);
        _principal += amount;
        emit Deposited(amount);
    }

    /// @inheritdoc IYieldStrategy
    function withdraw(uint256 amount) external override onlyVault nonReentrant {
        if (amount > _principal) revert InsufficientBalance();
        _principal -= amount;
        _usdc.safeTransfer(msg.sender, amount);
        emit Withdrawn(amount);
    }

    /// @inheritdoc IYieldStrategy
    function withdrawAll() external override onlyVault nonReentrant returns (uint256 amount) {
        amount = _principal;
        _principal = 0;
        _usdc.safeTransfer(msg.sender, amount);
        emit Withdrawn(amount);
    }

    /// @inheritdoc IYieldStrategy
    function harvestYield(address) external pure override returns (uint256) {
        // Null strategy generates no yield
        return 0;
    }

    /*//////////////////////////////////////////////////////////////
                            VIEW FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /// @inheritdoc IYieldStrategy
    function totalValue() external view override returns (uint256) {
        return _principal;
    }

    /// @inheritdoc IYieldStrategy
    function principal() external view override returns (uint256) {
        return _principal;
    }

    /// @inheritdoc IYieldStrategy
    function pendingYield() external pure override returns (uint256) {
        return 0;
    }

    /// @inheritdoc IYieldStrategy
    function usdc() external view override returns (address) {
        return address(_usdc);
    }

    /// @inheritdoc IYieldStrategy
    function vault() external view override returns (address) {
        return _vault;
    }

    /*//////////////////////////////////////////////////////////////
                           OWNER FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Emergency rescue for tokens accidentally sent to this contract
     * @param token Token to rescue
     * @param to Recipient address
     * @dev For USDC: only rescues amounts above principal (shouldn't exist normally)
     *      For other tokens: rescues entire balance
     */
    function rescueTokens(address token, address to) external onlyOwner {
        if (to == address(0)) revert InvalidAddress();

        uint256 amount;
        if (token == address(_usdc)) {
            uint256 balance = _usdc.balanceOf(address(this));
            // Only rescue excess beyond principal
            if (balance > _principal) {
                amount = balance - _principal;
                _usdc.safeTransfer(to, amount);
            }
        } else {
            amount = IERC20(token).balanceOf(address(this));
            if (amount > 0) {
                IERC20(token).safeTransfer(to, amount);
            }
        }

        if (amount > 0) {
            emit TokensRescued(token, to, amount);
        }
    }
}
