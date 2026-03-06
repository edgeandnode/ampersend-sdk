// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {SafeSingletonDeployer} from "safe-singleton-deployer/SafeSingletonDeployer.sol";
import {CoSignerValidator} from "../src/CoSignerValidator.sol";

contract DeployCoSignerValidator is Script {
    // Use meaningful salt for deterministic address across chains
    bytes32 constant COSIGNER_VALIDATOR_SALT = keccak256("CoSignerValidator.v1");

    function run() external returns (address coSignerValidator) {
        // Get deployer from environment
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        console.log("=== Deploying CoSignerValidator ===");
        console.log("Deployer:", vm.addr(deployerPrivateKey));
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // Deploy CoSignerValidator using Safe Singleton Factory
        console.log("Deploying CoSignerValidator...");
        coSignerValidator = _deploySingleton(
            type(CoSignerValidator).creationCode,
            "", // No constructor args
            COSIGNER_VALIDATOR_SALT,
            "CoSignerValidator"
        );

        vm.stopBroadcast();

        // Log deployment summary
        console.log("");
        console.log("=== Deployment Summary ===");
        console.log("CoSignerValidator:", coSignerValidator);
        console.log("");
        console.log("This address will be consistent across all chains!");
        console.log("");
        console.log("Next steps:");
        console.log("1. Verify contract on Basescan");
        console.log("2. Admin must call addCoSigner() to register the server key");
        console.log("3. Update VALIDATORS.COSIGNER_VALIDATOR in accounts-sdk/constants.ts");
        console.log("=========================");
    }

    function _deploySingleton(
        bytes memory creationCode,
        bytes memory constructorArgs,
        bytes32 salt,
        string memory contractName
    ) internal returns (address deployed) {
        // Use SafeSingletonDeployer.deploy (not broadcastDeploy) since we're already broadcasting
        deployed = SafeSingletonDeployer.deploy(creationCode, constructorArgs, salt);

        console.log(string.concat(contractName, " deployed at:"), deployed);

        // Verify deployment
        require(deployed.code.length > 0, string.concat(contractName, " deployment failed"));
    }

    // Helper function to predict address without deploying
    function predict() external view {
        console.log("=== Predicted CoSignerValidator Address ===");

        address predictedAddress =
            SafeSingletonDeployer.computeAddress(type(CoSignerValidator).creationCode, COSIGNER_VALIDATOR_SALT);
        console.log("CoSignerValidator:", predictedAddress);

        console.log("");
        console.log("Use this address in:");
        console.log("- packages/accounts-sdk/src/constants.ts (VALIDATORS.COSIGNER_VALIDATOR)");
        console.log("===========================================");
    }
}
