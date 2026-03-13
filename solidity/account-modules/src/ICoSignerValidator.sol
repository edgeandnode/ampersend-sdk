// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/**
 * @title ICoSignerValidator
 * @notice Interface for the CoSignerValidator ERC-7579 module
 * @dev Validator requiring dual signatures: agent key + server co-signer
 */
interface ICoSignerValidator {
    // ============ Errors ============

    error CoSignerValidator_AlreadyInitialized();
    error CoSignerValidator_NotInitialized();
    error CoSignerValidator_InvalidAddress();
    error CoSignerValidator_InvalidAgentKey();
    error CoSignerValidator_InvalidCoSigner();

    // ============ Events ============

    event CoSignerAdded(address indexed admin, address indexed coSigner);
    event CoSignerRemoved(address indexed admin, address indexed coSigner);
    event AdminUpdated(address indexed account, address indexed oldAdmin, address indexed newAdmin);
    event AgentKeyAdded(address indexed account, address indexed key);
    event AgentKeyRemoved(address indexed account, address indexed key);

    // ============ Agent Key Management ============

    /**
     * @notice Add an agent key to the account
     * @dev Can only be called by the account itself via UserOp
     * @param key The agent key address to add
     */
    function addAgentKey(address key) external;

    /**
     * @notice Add multiple agent keys to the account
     * @dev Can only be called by the account itself via UserOp
     * @param keys The agent key addresses to add
     */
    function addAgentKeys(address[] calldata keys) external;

    /**
     * @notice Remove an agent key from the account
     * @dev Can only be called by the account itself via UserOp
     * @param key The agent key address to remove
     */
    function removeAgentKey(address key) external;

    /**
     * @notice Remove multiple agent keys from the account
     * @dev Can only be called by the account itself via UserOp
     * @param keys The agent key addresses to remove
     */
    function removeAgentKeys(address[] calldata keys) external;

    /**
     * @notice Get all agent keys for an account
     * @param account The account address
     * @return Array of agent key addresses
     */
    function getAgentKeys(address account) external view returns (address[] memory);

    /**
     * @notice Check if an address is a registered agent key for an account
     * @param account The account address
     * @param key The key address to check
     * @return True if the key is registered
     */
    function isAgentKey(address account, address key) external view returns (bool);

    // ============ Admin Management ============

    /**
     * @notice Add a co-signer to the admin's set
     * @dev Can only be called by an admin
     * @param coSigner The co-signer address to add
     */
    function addCoSigner(address coSigner) external;

    /**
     * @notice Remove a co-signer from the admin's set
     * @dev Can only be called by the admin
     * @param coSigner The co-signer address to remove
     */
    function removeCoSigner(address coSigner) external;

    /**
     * @notice Get all co-signers for an admin
     * @param admin The admin address
     * @return Array of co-signer addresses
     */
    function getCoSigners(address admin) external view returns (address[] memory);

    // ============ Account Admin Management ============

    /**
     * @notice Set the trusted admin for an account
     * @dev Can only be called by the account itself via UserOp
     * @param newAdmin The new admin address
     */
    function setAdmin(address newAdmin) external;

    /**
     * @notice Get the trusted admin for an account
     * @param account The account address
     * @return The admin address
     */
    function getAdmin(address account) external view returns (address);

    /**
     * @notice Check if a co-signer is valid for an account
     * @param account The account address
     * @param coSigner The co-signer address to check
     * @return True if coSigner is valid for this account
     */
    function isValidCoSignerForAccount(address account, address coSigner) external view returns (bool);
}
