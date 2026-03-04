// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ICoSignerValidator} from "./ICoSignerValidator.sol";
import {ERC7579ValidatorBase} from "modulekit/src/module-bases/ERC7579ValidatorBase.sol";
import {IModule} from "modulekit/src/accounts/common/interfaces/IERC7579Module.sol";
import {PackedUserOperation} from "modulekit/src/external/ERC4337.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {ECDSA} from "solady/utils/ECDSA.sol";

/**
 * @title CoSignerValidator
 * @notice ERC-7579 validator requiring dual signatures (agent key + server co-signer)
 * @dev Provides server-enforced spend limits and programmable policies for agent operations
 */
contract CoSignerValidator is ICoSignerValidator, ERC7579ValidatorBase, ReentrancyGuard {
    using EnumerableSet for EnumerableSet.AddressSet;

    // ============ Storage ============

    /// @dev ERC-7201 namespace for storage
    /// @custom:storage-location erc7201:cosigner.storage.CoSignerValidator
    // keccak256(abi.encode(uint256(keccak256("cosigner.storage.CoSignerValidator")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant STORAGE_NAMESPACE = 0xc5b93a38e6ebc0b4ee4d3a2da637cb24684bca4cf0415eb8ddad595b2705b600;

    /// @custom:storage-namespace CoSignerStorage
    struct CoSignerStorage {
        // Per-account: which admin does this account trust
        mapping(address => address) admin;
        // Per-admin: global co-signer set managed by admin
        mapping(address => EnumerableSet.AddressSet) coSigners;
        // Per-account: registered agent keys
        mapping(address => EnumerableSet.AddressSet) agentKeys;
        // Per-account: initialization status
        mapping(address => bool) accountInitialized;
    }

    // ============ Constructor ============

    constructor() {}

    // ============ Storage Access ============

    function _getStorage() private pure returns (CoSignerStorage storage $) {
        assembly {
            $.slot := STORAGE_NAMESPACE
        }
    }

    // ============ Module Management (ERC-7579) ============

    /**
     * @notice Called when module is installed for an account
     * @param data Encoded as (address trustedAdmin, address[] initialAgentKeys)
     */
    function onInstall(bytes calldata data) external override(IModule) {
        CoSignerStorage storage $ = _getStorage();
        address account = msg.sender;

        // Prevent double initialization
        require(!$.accountInitialized[account], "Already initialized");

        // Decode installation data
        (address trustedAdmin, address[] memory initialAgentKeys) = abi.decode(data, (address, address[]));

        // Validate admin address
        require(trustedAdmin != address(0), "Invalid admin address");

        // Set trusted admin
        $.admin[account] = trustedAdmin;

        // Register initial agent keys
        for (uint256 i = 0; i < initialAgentKeys.length; i++) {
            address key = initialAgentKeys[i];
            require(key != address(0), "Invalid key address");
            $.agentKeys[account].add(key);
            emit AgentKeyAdded(account, key);
        }

        // Mark account as initialized
        $.accountInitialized[account] = true;
    }

    /**
     * @notice Called when module is uninstalled for an account
     */
    function onUninstall(bytes calldata) external override(IModule) {
        CoSignerStorage storage $ = _getStorage();
        address account = msg.sender;

        // Clear admin
        delete $.admin[account];

        // Clear all agent keys
        address[] memory keys = $.agentKeys[account].values();
        for (uint256 i = 0; i < keys.length; i++) {
            $.agentKeys[account].remove(keys[i]);
        }

        // Mark as uninitialized
        $.accountInitialized[account] = false;
    }

    /**
     * @notice Returns whether this module is of a certain type
     * @param typeId The module type ID to check
     * @return True if this module is of the specified type
     */
    function isModuleType(uint256 typeId) external pure override(IModule) returns (bool) {
        return typeId == 1; // 1 = validator
    }

    /**
     * @notice Check if the module is initialized for a smart account
     * @param smartAccount The smart account address
     * @return True if initialized
     */
    function isInitialized(address smartAccount) external view returns (bool) {
        CoSignerStorage storage $ = _getStorage();
        return $.accountInitialized[smartAccount];
    }

    // ============ Validation (ERC-7579) ============

    /**
     * @notice Validates a UserOperation
     * @param userOp The packed user operation
     * @param userOpHash The hash of the user operation
     * @return ValidationData packed validation result (0 = success, 1 = failure)
     */
    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash
    ) external view override returns (ValidationData) {
        CoSignerStorage storage $ = _getStorage();
        address account = msg.sender;

        // Hash with Ethereum signed message prefix (matches ERC-4337 validation pattern)
        bytes32 messageHash = ECDSA.toEthSignedMessageHash(userOpHash);

        // Decode signature as (bytes agentSig, bytes coSignerSig)
        (bytes memory agentSig, bytes memory coSignerSig) = abi.decode(userOp.signature, (bytes, bytes));

        // Recover agent address
        address agentAddress = ECDSA.recover(messageHash, agentSig);
        if (!$.agentKeys[account].contains(agentAddress)) {
            return VALIDATION_FAILED;
        }

        // Recover co-signer address
        address coSignerAddress = ECDSA.recover(messageHash, coSignerSig);

        // Look up trusted admin and verify co-signer
        address trustedAdmin = $.admin[account];
        if (!$.coSigners[trustedAdmin].contains(coSignerAddress)) {
            return VALIDATION_FAILED;
        }

        return VALIDATION_SUCCESS;
    }

    /**
     * @notice Validates a signature using ERC-1271
     * @param sender The account address (not used but required by interface)
     * @param hash The hash to validate
     * @param signature The signature to validate
     * @return Magic value (0x1626ba7e) if valid, 0xffffffff if invalid
     */
    function isValidSignatureWithSender(
        address sender,
        bytes32 hash,
        bytes calldata signature
    ) external view override returns (bytes4) {
        CoSignerStorage storage $ = _getStorage();

        // Decode signature as (bytes agentSig, bytes coSignerSig)
        (bytes memory agentSig, bytes memory coSignerSig) = abi.decode(signature, (bytes, bytes));

        // Recover agent address (NO Ethereum prefix for ERC-1271)
        address agentAddress = ECDSA.recover(hash, agentSig);
        if (!$.agentKeys[sender].contains(agentAddress)) {
            return EIP1271_FAILED;
        }

        // Recover co-signer address
        address coSignerAddress = ECDSA.recover(hash, coSignerSig);

        // Look up trusted admin and verify co-signer
        address trustedAdmin = $.admin[sender];
        if (!$.coSigners[trustedAdmin].contains(coSignerAddress)) {
            return EIP1271_FAILED;
        }

        return EIP1271_SUCCESS;
    }

    // ============ Agent Key Management ============

    /**
     * @notice Add an agent key to the account
     * @dev Can only be called by the account itself
     * @param key The agent key address to add
     */
    function addAgentKey(address key) external {
        CoSignerStorage storage $ = _getStorage();
        address account = msg.sender;

        require($.accountInitialized[account], "Not initialized");
        require(key != address(0), "Invalid key address");

        $.agentKeys[account].add(key);
        emit AgentKeyAdded(account, key);
    }

    /**
     * @notice Remove an agent key from the account
     * @dev Can only be called by the account itself
     * @param key The agent key address to remove
     */
    function removeAgentKey(address key) external {
        CoSignerStorage storage $ = _getStorage();
        address account = msg.sender;

        require($.accountInitialized[account], "Not initialized");

        $.agentKeys[account].remove(key);
        emit AgentKeyRemoved(account, key);
    }

    /**
     * @notice Get all agent keys for an account
     * @param account The account address
     * @return Array of agent key addresses
     */
    function getAgentKeys(address account) external view returns (address[] memory) {
        CoSignerStorage storage $ = _getStorage();
        return $.agentKeys[account].values();
    }

    /**
     * @notice Check if an address is a registered agent key
     * @param account The account address
     * @param key The key address to check
     * @return True if the key is registered
     */
    function isAgentKey(address account, address key) external view returns (bool) {
        CoSignerStorage storage $ = _getStorage();
        return $.agentKeys[account].contains(key);
    }

    // ============ Admin Functions ============

    /**
     * @notice Add a co-signer to the caller's set
     * @dev msg.sender is the admin adding to their own co-signer set
     * @param coSigner The co-signer address to add
     */
    function addCoSigner(address coSigner) external {
        require(coSigner != address(0), "Invalid coSigner address");

        CoSignerStorage storage $ = _getStorage();
        $.coSigners[msg.sender].add(coSigner);
        emit CoSignerAdded(msg.sender, coSigner);
    }

    /**
     * @notice Remove a co-signer from the caller's set
     * @dev msg.sender is the admin removing from their own co-signer set
     * @param coSigner The co-signer address to remove
     */
    function removeCoSigner(address coSigner) external {
        CoSignerStorage storage $ = _getStorage();
        $.coSigners[msg.sender].remove(coSigner);
        emit CoSignerRemoved(msg.sender, coSigner);
    }

    /**
     * @notice Get all co-signers for an admin
     * @param admin The admin address
     * @return Array of co-signer addresses
     */
    function getCoSigners(address admin) external view returns (address[] memory) {
        CoSignerStorage storage $ = _getStorage();
        return $.coSigners[admin].values();
    }

    // ============ Account Admin Management ============

    /**
     * @notice Set the trusted admin for the account
     * @dev Can only be called by the account itself
     * @param newAdmin The new admin address
     */
    function setAdmin(address newAdmin) external {
        CoSignerStorage storage $ = _getStorage();
        address account = msg.sender;

        require($.accountInitialized[account], "Not initialized");
        require(newAdmin != address(0), "Invalid admin address");

        address oldAdmin = $.admin[account];
        $.admin[account] = newAdmin;

        emit AdminUpdated(account, oldAdmin, newAdmin);
    }

    /**
     * @notice Get the trusted admin for an account
     * @param account The account address
     * @return The admin address
     */
    function getAdmin(address account) external view returns (address) {
        CoSignerStorage storage $ = _getStorage();
        return $.admin[account];
    }
}
