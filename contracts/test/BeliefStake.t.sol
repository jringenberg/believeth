// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";

import {BeliefStake} from "../BeliefStake.sol";
import {NullYieldStrategy} from "../NullYieldStrategy.sol";
import {IYieldStrategy} from "../IYieldStrategy.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Mock USDC with 6 decimals
contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Malicious strategy that tries to steal funds
contract MaliciousStrategy is IYieldStrategy {
    address public immutable usdc;
    address public immutable vault;
    address public attacker;

    constructor(address _usdc, address _vault, address _attacker) {
        usdc = _usdc;
        vault = _vault;
        attacker = _attacker;
    }

    function deposit(uint256 amount) external {
        // Steal funds instead of holding them
        ERC20(usdc).transferFrom(msg.sender, attacker, amount);
    }

    function withdraw(uint256) external pure {
        revert("no funds lol");
    }

    function withdrawAll() external pure returns (uint256) {
        return 0;
    }

    function totalValue() external pure returns (uint256) { return 0; }
    function principal() external pure returns (uint256) { return 0; }
    function pendingYield() external pure returns (uint256) { return 0; }
    function harvestYield(address) external pure returns (uint256) { return 0; }
}

contract BeliefStakeTest is Test {
    MockUSDC internal usdc;
    NullYieldStrategy internal strategy;
    BeliefStake internal beliefStake;

    address internal owner;
    address internal treasury;
    address internal user1;
    address internal user2;

    bytes32 internal uid1;
    bytes32 internal uid2;

    uint256 constant STAKE_AMOUNT = 2_000_000; // $2 USDC

    event Staked(bytes32 indexed attestationUID, address indexed staker, uint256 amount, uint256 timestamp);
    event Unstaked(bytes32 indexed attestationUID, address indexed staker, uint256 amount);
    event StrategyMigrated(address indexed oldStrategy, address indexed newStrategy, uint256 amount);
    event YieldHarvested(uint256 amount, address indexed treasury);

    function setUp() public {
        owner = makeAddr("owner");
        treasury = makeAddr("treasury");
        user1 = makeAddr("user1");
        user2 = makeAddr("user2");

        uid1 = keccak256("belief-1");
        uid2 = keccak256("belief-2");

        vm.startPrank(owner);

        // Deploy USDC
        usdc = new MockUSDC();

        // Predict BeliefStake address
        uint64 nonce = vm.getNonce(owner);
        address predictedBeliefStake = vm.computeCreateAddress(owner, nonce + 1);

        // Deploy strategy with predicted address
        strategy = new NullYieldStrategy(address(usdc), predictedBeliefStake);

        // Deploy BeliefStake
        beliefStake = new BeliefStake(address(usdc), address(strategy), treasury);

        require(address(beliefStake) == predictedBeliefStake, "address mismatch");

        vm.stopPrank();

        // Fund users
        usdc.mint(user1, 100_000_000); // $100
        usdc.mint(user2, 100_000_000); // $100

        // Approve BeliefStake
        vm.prank(user1);
        usdc.approve(address(beliefStake), type(uint256).max);
        vm.prank(user2);
        usdc.approve(address(beliefStake), type(uint256).max);
    }

    /*//////////////////////////////////////////////////////////////
                            BASIC STAKING
    //////////////////////////////////////////////////////////////*/

    function test_stake_success() public {
        uint256 balanceBefore = usdc.balanceOf(user1);

        vm.prank(user1);
        vm.expectEmit(true, true, false, true);
        emit Staked(uid1, user1, STAKE_AMOUNT, block.timestamp);
        beliefStake.stake(uid1);

        // User balance decreased
        assertEq(usdc.balanceOf(user1), balanceBefore - STAKE_AMOUNT);

        // Strategy received funds
        assertEq(strategy.principal(), STAKE_AMOUNT);

        // Stake recorded
        (uint256 amount, uint256 timestamp) = beliefStake.getStake(uid1, user1);
        assertEq(amount, STAKE_AMOUNT);
        assertEq(timestamp, block.timestamp);

        // Totals updated
        assertEq(beliefStake.totalStaked(uid1), STAKE_AMOUNT);
        assertEq(beliefStake.stakerCount(uid1), 1);
        assertEq(beliefStake.totalPrincipal(), STAKE_AMOUNT);
    }

    function test_stake_multipleUsersOnSameBelief() public {
        vm.prank(user1);
        beliefStake.stake(uid1);

        vm.prank(user2);
        beliefStake.stake(uid1);

        assertEq(beliefStake.totalStaked(uid1), STAKE_AMOUNT * 2);
        assertEq(beliefStake.stakerCount(uid1), 2);
        assertEq(beliefStake.totalPrincipal(), STAKE_AMOUNT * 2);
        assertEq(strategy.principal(), STAKE_AMOUNT * 2);
    }

    function test_stake_sameUserMultipleBeliefs() public {
        vm.startPrank(user1);
        beliefStake.stake(uid1);
        beliefStake.stake(uid2);
        vm.stopPrank();

        assertEq(beliefStake.totalStaked(uid1), STAKE_AMOUNT);
        assertEq(beliefStake.totalStaked(uid2), STAKE_AMOUNT);
        assertEq(beliefStake.totalPrincipal(), STAKE_AMOUNT * 2);
    }

    function test_stake_revert_zeroUID() public {
        vm.prank(user1);
        vm.expectRevert(BeliefStake.InvalidAttestationUID.selector);
        beliefStake.stake(bytes32(0));
    }

    function test_stake_revert_alreadyStaked() public {
        vm.startPrank(user1);
        beliefStake.stake(uid1);

        vm.expectRevert(BeliefStake.AlreadyStaked.selector);
        beliefStake.stake(uid1);
        vm.stopPrank();
    }

    function test_stake_revert_insufficientBalance() public {
        address poorUser = makeAddr("poor");
        usdc.mint(poorUser, STAKE_AMOUNT - 1);

        vm.startPrank(poorUser);
        usdc.approve(address(beliefStake), type(uint256).max);

        vm.expectRevert(); // SafeERC20 revert
        beliefStake.stake(uid1);
        vm.stopPrank();
    }

    /*//////////////////////////////////////////////////////////////
                            UNSTAKING
    //////////////////////////////////////////////////////////////*/

    function test_unstake_success() public {
        vm.prank(user1);
        beliefStake.stake(uid1);

        uint256 balanceBefore = usdc.balanceOf(user1);

        vm.prank(user1);
        vm.expectEmit(true, true, false, true);
        emit Unstaked(uid1, user1, STAKE_AMOUNT);
        beliefStake.unstake(uid1);

        // User balance restored
        assertEq(usdc.balanceOf(user1), balanceBefore + STAKE_AMOUNT);

        // Strategy balance decreased
        assertEq(strategy.principal(), 0);

        // Stake cleared
        (uint256 amount,) = beliefStake.getStake(uid1, user1);
        assertEq(amount, 0);

        // Totals updated
        assertEq(beliefStake.totalStaked(uid1), 0);
        assertEq(beliefStake.stakerCount(uid1), 0);
        assertEq(beliefStake.totalPrincipal(), 0);
    }

    function test_unstake_partialFromMultiple() public {
        // Both users stake
        vm.prank(user1);
        beliefStake.stake(uid1);
        vm.prank(user2);
        beliefStake.stake(uid1);

        // User1 unstakes
        vm.prank(user1);
        beliefStake.unstake(uid1);

        // User2's stake unaffected
        (uint256 amount,) = beliefStake.getStake(uid1, user2);
        assertEq(amount, STAKE_AMOUNT);

        assertEq(beliefStake.totalStaked(uid1), STAKE_AMOUNT);
        assertEq(beliefStake.stakerCount(uid1), 1);
        assertEq(beliefStake.totalPrincipal(), STAKE_AMOUNT);
    }

    function test_unstake_revert_noStake() public {
        vm.prank(user1);
        vm.expectRevert(BeliefStake.NoStakeFound.selector);
        beliefStake.unstake(uid1);
    }

    function test_unstake_revert_alreadyUnstaked() public {
        vm.startPrank(user1);
        beliefStake.stake(uid1);
        beliefStake.unstake(uid1);

        vm.expectRevert(BeliefStake.NoStakeFound.selector);
        beliefStake.unstake(uid1);
        vm.stopPrank();
    }

    /*//////////////////////////////////////////////////////////////
                         STRATEGY MIGRATION
    //////////////////////////////////////////////////////////////*/

    function test_migrateStrategy_success() public {
        // Users stake
        vm.prank(user1);
        beliefStake.stake(uid1);
        vm.prank(user2);
        beliefStake.stake(uid2);

        uint256 totalBefore = beliefStake.totalPrincipal();

        // Deploy new strategy
        vm.startPrank(owner);
        NullYieldStrategy newStrategy = new NullYieldStrategy(address(usdc), address(beliefStake));

        vm.expectEmit(true, true, false, true);
        emit StrategyMigrated(address(strategy), address(newStrategy), totalBefore);
        beliefStake.migrateYieldStrategy(newStrategy);
        vm.stopPrank();

        // New strategy has funds
        assertEq(newStrategy.principal(), totalBefore);

        // Old strategy empty
        assertEq(strategy.principal(), 0);

        // Users can still unstake
        vm.prank(user1);
        beliefStake.unstake(uid1);
        assertEq(usdc.balanceOf(user1), 100_000_000); // Full balance restored
    }

    function test_migrateStrategy_revert_notOwner() public {
        vm.startPrank(owner);
        NullYieldStrategy newStrategy = new NullYieldStrategy(address(usdc), address(beliefStake));
        vm.stopPrank();

        vm.prank(user1);
        vm.expectRevert();
        beliefStake.migrateYieldStrategy(newStrategy);
    }

    function test_migrateStrategy_revert_wrongVault() public {
        vm.startPrank(owner);
        NullYieldStrategy badStrategy = new NullYieldStrategy(address(usdc), address(0xdead));

        vm.expectRevert(BeliefStake.StrategyMismatch.selector);
        beliefStake.migrateYieldStrategy(badStrategy);
        vm.stopPrank();
    }

    function test_migrateStrategy_revert_wrongUsdc() public {
        MockUSDC fakeUsdc = new MockUSDC();

        vm.startPrank(owner);
        NullYieldStrategy badStrategy = new NullYieldStrategy(address(fakeUsdc), address(beliefStake));

        vm.expectRevert(BeliefStake.StrategyMismatch.selector);
        beliefStake.migrateYieldStrategy(badStrategy);
        vm.stopPrank();
    }

    function test_migrateStrategy_revert_zeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(BeliefStake.InvalidAddress.selector);
        beliefStake.migrateYieldStrategy(IYieldStrategy(address(0)));
    }

    /*//////////////////////////////////////////////////////////////
                            VIEW FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function test_totalValue() public {
        vm.prank(user1);
        beliefStake.stake(uid1);

        assertEq(beliefStake.totalValue(), STAKE_AMOUNT);
    }

    function test_pendingYield() public {
        // NullYieldStrategy always returns 0
        assertEq(beliefStake.pendingYield(), 0);
    }

    /*//////////////////////////////////////////////////////////////
                            OWNER FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function test_setTreasury() public {
        address newTreasury = makeAddr("newTreasury");

        vm.prank(owner);
        beliefStake.setTreasury(newTreasury);

        assertEq(beliefStake.treasury(), newTreasury);
    }

    function test_setTreasury_revert_notOwner() public {
        vm.prank(user1);
        vm.expectRevert();
        beliefStake.setTreasury(makeAddr("newTreasury"));
    }

    function test_setTreasury_revert_zeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(BeliefStake.InvalidAddress.selector);
        beliefStake.setTreasury(address(0));
    }

    function test_harvestYield_noYield() public {
        vm.prank(user1);
        beliefStake.stake(uid1);

        uint256 treasuryBefore = usdc.balanceOf(treasury);

        // Anyone can call
        beliefStake.harvestYield();

        // No yield to harvest from NullYieldStrategy
        assertEq(usdc.balanceOf(treasury), treasuryBefore);
    }

    function test_rescueTokens_otherToken() public {
        // Send random token to contract
        MockUSDC randomToken = new MockUSDC();
        randomToken.mint(address(beliefStake), 1000);

        vm.prank(owner);
        beliefStake.rescueTokens(address(randomToken), treasury);

        assertEq(randomToken.balanceOf(treasury), 1000);
    }

    /*//////////////////////////////////////////////////////////////
                            INVARIANT CHECKS
    //////////////////////////////////////////////////////////////*/

    function test_invariant_totalPrincipalMatchesStakes() public {
        // Multiple stakes
        vm.prank(user1);
        beliefStake.stake(uid1);
        vm.prank(user2);
        beliefStake.stake(uid1);
        vm.prank(user1);
        beliefStake.stake(uid2);

        assertEq(beliefStake.totalPrincipal(), STAKE_AMOUNT * 3);

        // Unstake one
        vm.prank(user1);
        beliefStake.unstake(uid1);

        assertEq(beliefStake.totalPrincipal(), STAKE_AMOUNT * 2);

        // Invariant: totalPrincipal == strategy.principal()
        assertEq(beliefStake.totalPrincipal(), strategy.principal());
    }

    function test_invariant_strategyPrincipalMatchesTotalPrincipal() public {
        // Many operations
        vm.prank(user1);
        beliefStake.stake(uid1);

        vm.prank(user2);
        beliefStake.stake(uid1);

        vm.prank(user1);
        beliefStake.unstake(uid1);

        vm.prank(user1);
        beliefStake.stake(uid2);

        // Invariant holds
        assertEq(strategy.principal(), beliefStake.totalPrincipal());
    }

    /*//////////////////////////////////////////////////////////////
                          OWNERSHIP TESTS
    //////////////////////////////////////////////////////////////*/

    function test_ownership_twoStep() public {
        address newOwner = makeAddr("newOwner");

        // Start transfer
        vm.prank(owner);
        beliefStake.transferOwnership(newOwner);

        // Owner unchanged until accepted
        assertEq(beliefStake.owner(), owner);

        // Accept
        vm.prank(newOwner);
        beliefStake.acceptOwnership();

        assertEq(beliefStake.owner(), newOwner);
    }

    /*//////////////////////////////////////////////////////////////
                           GAS BENCHMARKS
    //////////////////////////////////////////////////////////////*/

    function test_gas_stake() public {
        vm.prank(user1);
        uint256 gasBefore = gasleft();
        beliefStake.stake(uid1);
        uint256 gasUsed = gasBefore - gasleft();

        // Log for reference (will show in -vvv output)
        emit log_named_uint("Gas used for stake()", gasUsed);
    }

    function test_gas_unstake() public {
        vm.prank(user1);
        beliefStake.stake(uid1);

        vm.prank(user1);
        uint256 gasBefore = gasleft();
        beliefStake.unstake(uid1);
        uint256 gasUsed = gasBefore - gasleft();

        emit log_named_uint("Gas used for unstake()", gasUsed);
    }
}
