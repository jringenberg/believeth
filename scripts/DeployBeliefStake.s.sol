// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";

import {BeliefStake} from "../contracts/BeliefStake.sol";
import {NullYieldStrategy} from "../contracts/NullYieldStrategy.sol";

/**
 * @title DeployBeliefStake
 * @notice Deploys BeliefStake + NullYieldStrategy, handling the circular dependency.
 *
 * @dev The chicken-and-egg problem:
 *      - BeliefStake constructor needs strategy address
 *      - NullYieldStrategy constructor needs BeliefStake (vault) address
 *
 *      Solution: Predict BeliefStake's address using CREATE nonce, deploy strategy
 *      first with predicted address, then deploy BeliefStake.
 *
 * Usage:
 *   # Testnet (Base Sepolia)
 *   forge script scripts/DeployBeliefStake.s.sol \
 *     --rpc-url https://sepolia.base.org \
 *     --broadcast \
 *     --verify
 *
 *   # Mainnet (Base)
 *   forge script scripts/DeployBeliefStake.s.sol \
 *     --rpc-url https://mainnet.base.org \
 *     --broadcast \
 *     --verify
 *
 * Environment variables:
 *   PRIVATE_KEY     - Deployer private key
 *   USDC_ADDRESS    - USDC token address (defaults vary by chain)
 *   TREASURY        - Treasury address for yield (defaults to deployer)
 */
contract DeployBeliefStake is Script {
    // Base mainnet USDC
    address constant BASE_MAINNET_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    // Base Sepolia MockUSDC (from previous deployment)
    address constant BASE_SEPOLIA_USDC = 0xA5c82FCFBe1274166D01B1f3cd9f69Eb79bd74E8;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        // Determine USDC address based on chain or env override
        address usdcAddress = _getUsdcAddress();

        // Treasury defaults to deployer if not set
        address treasury = vm.envOr("TREASURY", deployer);

        console2.log("=== BeliefStake Deployment ===");
        console2.log("Deployer:", deployer);
        console2.log("USDC:", usdcAddress);
        console2.log("Treasury:", treasury);
        console2.log("Chain ID:", block.chainid);

        vm.startBroadcast(deployerKey);

        // Step 1: Predict where BeliefStake will be deployed
        // Strategy deploys at nonce N, BeliefStake at nonce N+1
        uint64 currentNonce = vm.getNonce(deployer);
        address predictedBeliefStake = vm.computeCreateAddress(deployer, currentNonce + 1);

        console2.log("Predicted BeliefStake address:", predictedBeliefStake);

        // Step 2: Deploy NullYieldStrategy with predicted BeliefStake address
        NullYieldStrategy strategy = new NullYieldStrategy(usdcAddress, predictedBeliefStake);
        console2.log("NullYieldStrategy deployed at:", address(strategy));

        // Step 3: Deploy BeliefStake
        BeliefStake beliefStake = new BeliefStake(usdcAddress, address(strategy), treasury);
        console2.log("BeliefStake deployed at:", address(beliefStake));

        // Step 4: Verify prediction was correct
        require(
            address(beliefStake) == predictedBeliefStake,
            "BeliefStake address mismatch! Deployment failed."
        );

        // Step 5: Verify linkage
        require(strategy.vault() == address(beliefStake), "Strategy vault mismatch");
        require(address(beliefStake.yieldStrategy()) == address(strategy), "BeliefStake strategy mismatch");

        vm.stopBroadcast();

        // Output deployment info for records
        console2.log("");
        console2.log("=== Deployment Complete ===");
        console2.log("NullYieldStrategy:", address(strategy));
        console2.log("BeliefStake:", address(beliefStake));
        console2.log("USDC:", usdcAddress);
        console2.log("Treasury:", treasury);
        console2.log("");
        console2.log("Next steps:");
        console2.log("1. Verify contracts on block explorer");
        console2.log("2. Update frontend contract addresses");
        console2.log("3. Update subgraph config");
        console2.log("4. Test stake/unstake flow");
    }

    function _getUsdcAddress() internal view returns (address) {
        // Allow explicit override
        address envUsdc = vm.envOr("USDC_ADDRESS", address(0));
        if (envUsdc != address(0)) {
            return envUsdc;
        }

        // Default based on chain ID
        if (block.chainid == 8453) {
            // Base mainnet
            return BASE_MAINNET_USDC;
        } else if (block.chainid == 84532) {
            // Base Sepolia
            return BASE_SEPOLIA_USDC;
        } else {
            revert("Unknown chain - set USDC_ADDRESS env var");
        }
    }
}
