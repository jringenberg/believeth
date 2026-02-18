// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";

import "./IYieldStrategy.sol";

/**
 * @title BeliefStake
 * @notice Holds USDC stakes for belief attestations. Fixed $2 stake amount per belief.
 *         Idle USDC is deposited into a yield strategy; principal returns to users,
 *         yield accrues to protocol treasury.
 *
 * @dev Security model:
 *      - Users can always unstake their $2 (assuming strategy has liquidity)
 *      - Owner can migrate between yield strategies (atomic, no user action needed)
 *      - Owner can harvest yield to treasury
 *      - Owner can update treasury address
 *      - Owner CANNOT access user principal
 *
 *      Upgrade path:
 *      1. Deploy with NullYieldStrategy (holds USDC, no yield)
 *      2. Deploy AaveYieldStrategy when ready
 *      3. Call migrateYieldStrategy() - users unaffected
 */
contract BeliefStake is ReentrancyGuard, Ownable2Step {
    using SafeERC20 for IERC20;

    /*//////////////////////////////////////////////////////////////
                                 CONSTANTS
    //////////////////////////////////////////////////////////////*/

    /// @notice Fixed stake amount: $2 USDC (6 decimals)
    uint256 public constant STAKE_AMOUNT = 2_000_000;

    /*//////////////////////////////////////////////////////////////
                                 IMMUTABLES
    //////////////////////////////////////////////////////////////*/

    /// @notice USDC token contract
    IERC20 public immutable usdc;

    /*//////////////////////////////////////////////////////////////
                                 STATE
    //////////////////////////////////////////////////////////////*/

    /// @notice Current yield strategy
    IYieldStrategy public yieldStrategy;

    /// @notice Treasury address for harvested yield
    address public treasury;

    /// @notice Stake information for each user's stake on an attestation
    struct StakeInfo {
        uint256 amount;
        uint256 timestamp;
    }

    /// @notice Maps attestation UID => staker address => stake info
    mapping(bytes32 => mapping(address => StakeInfo)) public stakes;

    /// @notice Maps attestation UID => total staked amount
    mapping(bytes32 => uint256) public totalStaked;

    /// @notice Maps attestation UID => number of stakers
    mapping(bytes32 => uint256) public stakerCount;

    /// @notice Total principal across all stakes (for invariant checking)
    uint256 public totalPrincipal;

    /*//////////////////////////////////////////////////////////////
                                 EVENTS
    //////////////////////////////////////////////////////////////*/

    event Staked(bytes32 indexed attestationUID, address indexed staker, uint256 amount, uint256 timestamp);
    event Unstaked(bytes32 indexed attestationUID, address indexed staker, uint256 amount);
    event StrategyMigrated(address indexed oldStrategy, address indexed newStrategy, uint256 amount);
    event YieldHarvested(uint256 amount, address indexed treasury);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);

    /*//////////////////////////////////////////////////////////////
                                 ERRORS
    //////////////////////////////////////////////////////////////*/

    error InvalidAddress();
    error InvalidAttestationUID();
    error AlreadyStaked();
    error NoStakeFound();
    error StrategyMismatch();

    /*//////////////////////////////////////////////////////////////
                               CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    /**
     * @param _usdc Address of the USDC token contract
     * @param _yieldStrategy Address of the initial yield strategy
     * @param _treasury Address to receive harvested yield
     */
    constructor(
        address _usdc,
        address _yieldStrategy,
        address _treasury
    ) Ownable(msg.sender) {
        if (_usdc == address(0)) revert InvalidAddress();
        if (_yieldStrategy == address(0)) revert InvalidAddress();
        if (_treasury == address(0)) revert InvalidAddress();

        usdc = IERC20(_usdc);
        yieldStrategy = IYieldStrategy(_yieldStrategy);
        treasury = _treasury;

        // Verify strategy is configured for this contract and same USDC
        if (yieldStrategy.vault() != address(this)) revert StrategyMismatch();
        if (yieldStrategy.usdc() != _usdc) revert StrategyMismatch();
    }

    /*//////////////////////////////////////////////////////////////
                            USER FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Stake $2 USDC on a belief attestation
     * @param attestationUID The EAS attestation UID for the belief
     */
    function stake(bytes32 attestationUID) external nonReentrant {
        if (attestationUID == bytes32(0)) revert InvalidAttestationUID();
        if (stakes[attestationUID][msg.sender].amount != 0) revert AlreadyStaked();

        // Transfer USDC from user to this contract
        usdc.safeTransferFrom(msg.sender, address(this), STAKE_AMOUNT);

        // Deposit to yield strategy
        usdc.forceApprove(address(yieldStrategy), STAKE_AMOUNT);
        yieldStrategy.deposit(STAKE_AMOUNT);

        // Record the stake
        stakes[attestationUID][msg.sender] = StakeInfo({
            amount: STAKE_AMOUNT,
            timestamp: block.timestamp
        });

        // Update totals
        totalStaked[attestationUID] += STAKE_AMOUNT;
        stakerCount[attestationUID]++;
        totalPrincipal += STAKE_AMOUNT;

        emit Staked(attestationUID, msg.sender, STAKE_AMOUNT, block.timestamp);
    }

    /**
     * @notice Unstake $2 USDC from a belief attestation
     * @param attestationUID The EAS attestation UID for the belief
     */
    function unstake(bytes32 attestationUID) external nonReentrant {
        StakeInfo storage stakeInfo = stakes[attestationUID][msg.sender];
        if (stakeInfo.amount == 0) revert NoStakeFound();

        uint256 amount = stakeInfo.amount;

        // Clear the stake (before external calls)
        delete stakes[attestationUID][msg.sender];

        // Update totals (before external calls)
        totalStaked[attestationUID] -= amount;
        stakerCount[attestationUID]--;
        totalPrincipal -= amount;

        // Withdraw from yield strategy
        yieldStrategy.withdraw(amount);

        // Return USDC to user
        usdc.safeTransfer(msg.sender, amount);

        emit Unstaked(attestationUID, msg.sender, amount);
    }

    /*//////////////////////////////////////////////////////////////
                            VIEW FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Get stake information for a user on an attestation
     * @param attestationUID The EAS attestation UID
     * @param staker The staker address
     * @return amount The staked amount
     * @return timestamp The timestamp when the stake was made
     */
    function getStake(bytes32 attestationUID, address staker) external view returns (uint256 amount, uint256 timestamp) {
        StakeInfo memory info = stakes[attestationUID][staker];
        return (info.amount, info.timestamp);
    }

    /**
     * @notice Get the number of stakers for an attestation
     * @param attestationUID The EAS attestation UID
     * @return count The number of stakers
     */
    function getStakerCount(bytes32 attestationUID) external view returns (uint256 count) {
        return stakerCount[attestationUID];
    }

    /**
     * @notice Get total value held in yield strategy (principal + yield)
     */
    function totalValue() external view returns (uint256) {
        return yieldStrategy.totalValue();
    }

    /**
     * @notice Get pending yield available for harvest
     */
    function pendingYield() external view returns (uint256) {
        return yieldStrategy.pendingYield();
    }

    /*//////////////////////////////////////////////////////////////
                            OWNER FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Migrate to a new yield strategy
     * @param newStrategy Address of the new yield strategy
     * @dev Atomic migration: withdraws all from old strategy, deposits to new.
     *      New strategy must be pre-deployed with this contract as vault.
     *
     *      IMPORTANT: Announce migrations in advance so users can unstake if
     *      they don't trust the new strategy.
     */
    function migrateYieldStrategy(IYieldStrategy newStrategy) external onlyOwner nonReentrant {
        if (address(newStrategy) == address(0)) revert InvalidAddress();
        if (newStrategy.vault() != address(this)) revert StrategyMismatch();
        if (newStrategy.usdc() != address(usdc)) revert StrategyMismatch();

        IYieldStrategy oldStrategy = yieldStrategy;

        // Withdraw everything from old strategy (includes any yield)
        uint256 withdrawn = oldStrategy.withdrawAll();

        // Update strategy pointer BEFORE deposit (reentrancy safety)
        yieldStrategy = newStrategy;

        // Deposit principal to new strategy
        // Note: withdrawn may include yield, but we only deposit principal
        // Any excess stays in this contract and can be swept to treasury
        usdc.forceApprove(address(newStrategy), totalPrincipal);
        newStrategy.deposit(totalPrincipal);

        // If there was yield in the old strategy, send to treasury
        uint256 excess = withdrawn - totalPrincipal;
        if (excess > 0) {
            usdc.safeTransfer(treasury, excess);
            emit YieldHarvested(excess, treasury);
        }

        emit StrategyMigrated(address(oldStrategy), address(newStrategy), totalPrincipal);
    }

    /**
     * @notice Harvest yield from current strategy to treasury
     * @dev Anyone can call this - it only moves yield, not principal
     */
    function harvestYield() external nonReentrant {
        uint256 harvested = yieldStrategy.harvestYield(treasury);
        if (harvested > 0) {
            emit YieldHarvested(harvested, treasury);
        }
    }

    /**
     * @notice Update treasury address
     * @param newTreasury New treasury address
     */
    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert InvalidAddress();
        address oldTreasury = treasury;
        treasury = newTreasury;
        emit TreasuryUpdated(oldTreasury, newTreasury);
    }

    /**
     * @notice Rescue tokens accidentally sent to this contract
     * @param token Token to rescue
     * @param to Recipient
     * @dev Cannot rescue USDC (should all be in strategy). For USDC rescue,
     *      use strategy's rescue function or migrate strategies.
     */
    function rescueTokens(address token, address to) external onlyOwner {
        if (token == address(usdc)) {
            // USDC should be in strategy, not here. But if some is stuck,
            // only allow rescuing amounts beyond what's needed for pending operations
            uint256 balance = usdc.balanceOf(address(this));
            // In normal operation, balance should be 0 (all in strategy)
            // Only rescue if there's genuinely stuck USDC
            if (balance > 0) {
                usdc.safeTransfer(to, balance);
            }
        } else {
            uint256 balance = IERC20(token).balanceOf(address(this));
            IERC20(token).safeTransfer(to, balance);
        }
    }
}
