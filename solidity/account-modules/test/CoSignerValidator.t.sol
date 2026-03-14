// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test, console2} from "forge-std/Test.sol";
import {CoSignerValidator} from "../src/CoSignerValidator.sol";
import {ICoSignerValidator} from "../src/ICoSignerValidator.sol";
import {PackedUserOperation} from "modulekit/src/external/ERC4337.sol";
import {ERC7579ValidatorBase} from "modulekit/src/module-bases/ERC7579ValidatorBase.sol";

contract CoSignerValidatorTest is Test {
    CoSignerValidator public validator;

    // Test addresses
    address public admin1;
    address public admin2;
    address public coSigner1;
    address public coSigner2;
    address public account1;
    address public account2;
    address public agentKey1;
    address public agentKey2;

    // Private keys for signing
    uint256 public agentKey1Pk;
    uint256 public agentKey2Pk;
    uint256 public coSigner1Pk;
    uint256 public coSigner2Pk;

    // Events to test
    event CoSignerValidatorInstalled(address indexed account);
    event CoSignerValidatorUninstalled(address indexed account);
    event CoSignerAdded(address indexed admin, address indexed coSigner);
    event CoSignerRemoved(address indexed admin, address indexed coSigner);
    event AdminUpdated(address indexed account, address indexed oldAdmin, address indexed newAdmin);
    event AgentKeyAdded(address indexed account, address indexed key);
    event AgentKeyRemoved(address indexed account, address indexed key);

    function setUp() public {
        // Deploy validator as singleton
        validator = new CoSignerValidator();

        // Set up test accounts
        admin1 = makeAddr("admin1");
        admin2 = makeAddr("admin2");
        account1 = makeAddr("account1");
        account2 = makeAddr("account2");

        // Generate keys with private keys for signing
        agentKey1Pk = 0xA11CE;
        agentKey1 = vm.addr(agentKey1Pk);

        agentKey2Pk = 0xB0B;
        agentKey2 = vm.addr(agentKey2Pk);

        coSigner1Pk = 0xC051;
        coSigner1 = vm.addr(coSigner1Pk);

        coSigner2Pk = 0xC052;
        coSigner2 = vm.addr(coSigner2Pk);

        // Admin1 registers coSigner1
        vm.prank(admin1);
        validator.addCoSigner(coSigner1);
    }

    // ============ Module Installation Tests ============

    function test_OnInstall_WithAgentKeys() public {
        address[] memory keys = new address[](2);
        keys[0] = agentKey1;
        keys[1] = agentKey2;

        bytes memory initData = abi.encode(admin1, keys);

        vm.expectEmit(true, true, false, false);
        emit AgentKeyAdded(account1, agentKey1);
        vm.expectEmit(true, true, false, false);
        emit AgentKeyAdded(account1, agentKey2);
        vm.expectEmit(true, false, false, false);
        emit CoSignerValidatorInstalled(account1);

        vm.prank(account1);
        validator.onInstall(initData);

        assertTrue(validator.isInitialized(account1));
        assertEq(validator.getAdmin(account1), admin1);
        assertTrue(validator.isAgentKey(account1, agentKey1));
        assertTrue(validator.isAgentKey(account1, agentKey2));

        address[] memory registeredKeys = validator.getAgentKeys(account1);
        assertEq(registeredKeys.length, 2);
    }

    function test_OnInstall_EmptyAgentKeys() public {
        address[] memory keys = new address[](0);
        bytes memory initData = abi.encode(admin1, keys);

        vm.expectEmit(true, false, false, false);
        emit CoSignerValidatorInstalled(account1);

        vm.prank(account1);
        validator.onInstall(initData);

        assertTrue(validator.isInitialized(account1));
        assertEq(validator.getAdmin(account1), admin1);

        address[] memory registeredKeys = validator.getAgentKeys(account1);
        assertEq(registeredKeys.length, 0);
    }

    function test_OnInstall_RevertsIfAlreadyInitialized() public {
        address[] memory keys = new address[](1);
        keys[0] = agentKey1;
        bytes memory initData = abi.encode(admin1, keys);

        vm.prank(account1);
        validator.onInstall(initData);

        // Try to install again
        vm.prank(account1);
        vm.expectRevert(ICoSignerValidator.CoSignerValidator_AlreadyInitialized.selector);
        validator.onInstall(initData);
    }

    function test_OnInstall_RevertsIfInvalidAdmin() public {
        address[] memory keys = new address[](0);
        bytes memory initData = abi.encode(address(0), keys);

        vm.prank(account1);
        vm.expectRevert(ICoSignerValidator.CoSignerValidator_InvalidAddress.selector);
        validator.onInstall(initData);
    }

    function test_OnInstall_RevertsIfInvalidAgentKey() public {
        address[] memory keys = new address[](2);
        keys[0] = agentKey1;
        keys[1] = address(0); // Invalid
        bytes memory initData = abi.encode(admin1, keys);

        vm.prank(account1);
        vm.expectRevert(ICoSignerValidator.CoSignerValidator_InvalidAddress.selector);
        validator.onInstall(initData);
    }

    // ============ Module Uninstallation Tests ============

    function test_OnUninstall_ClearsAllData() public {
        // Install first
        address[] memory keys = new address[](2);
        keys[0] = agentKey1;
        keys[1] = agentKey2;
        bytes memory initData = abi.encode(admin1, keys);

        vm.prank(account1);
        validator.onInstall(initData);

        // Uninstall
        vm.prank(account1);
        validator.onUninstall("");

        assertFalse(validator.isInitialized(account1));
        assertEq(validator.getAdmin(account1), address(0));
        assertFalse(validator.isAgentKey(account1, agentKey1));
        assertFalse(validator.isAgentKey(account1, agentKey2));

        address[] memory registeredKeys = validator.getAgentKeys(account1);
        assertEq(registeredKeys.length, 0);
    }

    function test_OnUninstall_DoesNotAffectCoSigners() public {
        // Install account
        address[] memory keys = new address[](1);
        keys[0] = agentKey1;
        bytes memory initData = abi.encode(admin1, keys);

        vm.prank(account1);
        validator.onInstall(initData);

        // Verify coSigner exists for admin1
        address[] memory coSigners = validator.getCoSigners(admin1);
        assertEq(coSigners.length, 1);
        assertEq(coSigners[0], coSigner1);

        // Uninstall account
        vm.prank(account1);
        validator.onUninstall("");

        // CoSigners should still exist (they're global per admin)
        coSigners = validator.getCoSigners(admin1);
        assertEq(coSigners.length, 1);
        assertEq(coSigners[0], coSigner1);
    }

    function test_OnUninstall_RevertsIfNotInitialized() public {
        vm.prank(account1);
        vm.expectRevert(ICoSignerValidator.CoSignerValidator_NotInitialized.selector);
        validator.onUninstall("");
    }

    function test_UninstallReinstall_Flow() public {
        // Install with keys
        address[] memory keys = new address[](1);
        keys[0] = agentKey1;
        vm.prank(account1);
        validator.onInstall(abi.encode(admin1, keys));

        assertTrue(validator.isInitialized(account1));
        assertTrue(validator.isAgentKey(account1, agentKey1));

        // Uninstall
        vm.prank(account1);
        validator.onUninstall("");

        assertFalse(validator.isInitialized(account1));
        assertFalse(validator.isAgentKey(account1, agentKey1));

        // Reinstall with different keys and admin
        address[] memory keys2 = new address[](1);
        keys2[0] = agentKey2;
        vm.prank(account1);
        validator.onInstall(abi.encode(admin2, keys2));

        assertTrue(validator.isInitialized(account1));
        assertEq(validator.getAdmin(account1), admin2);
        assertFalse(validator.isAgentKey(account1, agentKey1)); // Old key gone
        assertTrue(validator.isAgentKey(account1, agentKey2)); // New key present
    }

    function test_OnInstall_DuplicateAgentKey_NoDuplicateInSet() public {
        // Install with the same key twice
        address[] memory keys = new address[](2);
        keys[0] = agentKey1;
        keys[1] = agentKey1; // duplicate

        vm.prank(account1);
        validator.onInstall(abi.encode(admin1, keys));

        // Should only have one key in the set (EnumerableSet deduplicates)
        address[] memory registeredKeys = validator.getAgentKeys(account1);
        assertEq(registeredKeys.length, 1);
        assertEq(registeredKeys[0], agentKey1);
    }

    function test_AddAgentKey_DuplicateDoesNotEmit() public {
        // Install with key
        address[] memory keys = new address[](1);
        keys[0] = agentKey1;
        vm.prank(account1);
        validator.onInstall(abi.encode(admin1, keys));

        // Add same key again - should not emit since already present
        vm.prank(account1);
        // We can't easily assert "no event emitted" in Foundry,
        // but we verify the set size doesn't change
        validator.addAgentKey(agentKey1);

        address[] memory registeredKeys = validator.getAgentKeys(account1);
        assertEq(registeredKeys.length, 1);
    }

    function test_AddCoSigner_DuplicateDoesNotEmit() public {
        // coSigner1 already added in setUp
        address[] memory coSigners = validator.getCoSigners(admin1);
        assertEq(coSigners.length, 1);

        // Add same coSigner again
        vm.prank(admin1);
        validator.addCoSigner(coSigner1);

        // Set size should not change
        coSigners = validator.getCoSigners(admin1);
        assertEq(coSigners.length, 1);
    }

    // ============ Module Type Tests ============

    function test_IsModuleType_Validator() public {
        assertTrue(validator.isModuleType(1)); // 1 = validator
    }

    function test_IsModuleType_NotExecutor() public {
        assertFalse(validator.isModuleType(2)); // 2 = executor
    }

    // ============ Agent Key Management Tests ============

    function test_AddAgentKey() public {
        // Install first
        address[] memory keys = new address[](0);
        bytes memory initData = abi.encode(admin1, keys);

        vm.prank(account1);
        validator.onInstall(initData);

        // Add agent key
        vm.expectEmit(true, true, false, false);
        emit AgentKeyAdded(account1, agentKey1);

        vm.prank(account1);
        validator.addAgentKey(agentKey1);

        assertTrue(validator.isAgentKey(account1, agentKey1));
    }

    function test_AddAgentKey_RevertsIfNotInitialized() public {
        vm.prank(account1);
        vm.expectRevert(ICoSignerValidator.CoSignerValidator_NotInitialized.selector);
        validator.addAgentKey(agentKey1);
    }

    function test_AddAgentKey_RevertsIfInvalidAddress() public {
        // Install first
        address[] memory keys = new address[](0);
        bytes memory initData = abi.encode(admin1, keys);

        vm.prank(account1);
        validator.onInstall(initData);

        vm.prank(account1);
        vm.expectRevert(ICoSignerValidator.CoSignerValidator_InvalidAddress.selector);
        validator.addAgentKey(address(0));
    }

    function test_RemoveAgentKey() public {
        // Install with key
        address[] memory keys = new address[](1);
        keys[0] = agentKey1;
        bytes memory initData = abi.encode(admin1, keys);

        vm.prank(account1);
        validator.onInstall(initData);

        // Remove key
        vm.expectEmit(true, true, false, false);
        emit AgentKeyRemoved(account1, agentKey1);

        vm.prank(account1);
        validator.removeAgentKey(agentKey1);

        assertFalse(validator.isAgentKey(account1, agentKey1));
    }

    function test_RemoveAgentKey_RevertsIfNotInitialized() public {
        vm.prank(account1);
        vm.expectRevert(ICoSignerValidator.CoSignerValidator_NotInitialized.selector);
        validator.removeAgentKey(agentKey1);
    }

    function test_AddAgentKeys_Batched() public {
        // Install with no keys
        address[] memory keys = new address[](0);
        vm.prank(account1);
        validator.onInstall(abi.encode(admin1, keys));

        // Add multiple keys at once
        address[] memory keysToAdd = new address[](2);
        keysToAdd[0] = agentKey1;
        keysToAdd[1] = agentKey2;

        vm.expectEmit(true, true, false, false);
        emit AgentKeyAdded(account1, agentKey1);
        vm.expectEmit(true, true, false, false);
        emit AgentKeyAdded(account1, agentKey2);

        vm.prank(account1);
        validator.addAgentKeys(keysToAdd);

        assertTrue(validator.isAgentKey(account1, agentKey1));
        assertTrue(validator.isAgentKey(account1, agentKey2));
    }

    function test_RemoveAgentKeys_Batched() public {
        // Install with keys
        address[] memory keys = new address[](2);
        keys[0] = agentKey1;
        keys[1] = agentKey2;
        vm.prank(account1);
        validator.onInstall(abi.encode(admin1, keys));

        // Remove multiple keys at once
        address[] memory keysToRemove = new address[](2);
        keysToRemove[0] = agentKey1;
        keysToRemove[1] = agentKey2;

        vm.expectEmit(true, true, false, false);
        emit AgentKeyRemoved(account1, agentKey1);
        vm.expectEmit(true, true, false, false);
        emit AgentKeyRemoved(account1, agentKey2);

        vm.prank(account1);
        validator.removeAgentKeys(keysToRemove);

        assertFalse(validator.isAgentKey(account1, agentKey1));
        assertFalse(validator.isAgentKey(account1, agentKey2));
    }

    // ============ CoSigner Management Tests ============

    function test_AddCoSigner() public {
        vm.expectEmit(true, true, false, false);
        emit CoSignerAdded(admin2, coSigner2);

        vm.prank(admin2);
        validator.addCoSigner(coSigner2);

        address[] memory coSigners = validator.getCoSigners(admin2);
        assertEq(coSigners.length, 1);
        assertEq(coSigners[0], coSigner2);
    }

    function test_AddCoSigner_RevertsIfInvalidAddress() public {
        vm.prank(admin1);
        vm.expectRevert(ICoSignerValidator.CoSignerValidator_InvalidAddress.selector);
        validator.addCoSigner(address(0));
    }

    function test_RemoveCoSigner() public {
        // coSigner1 already added in setUp for admin1
        address[] memory coSigners = validator.getCoSigners(admin1);
        assertEq(coSigners.length, 1);

        vm.expectEmit(true, true, false, false);
        emit CoSignerRemoved(admin1, coSigner1);

        vm.prank(admin1);
        validator.removeCoSigner(coSigner1);

        coSigners = validator.getCoSigners(admin1);
        assertEq(coSigners.length, 0);
    }

    function test_MultipleCoSigners_ForGracefulRotation() public {
        // Admin can have multiple coSigners active (for rotation)
        vm.prank(admin1);
        validator.addCoSigner(coSigner2);

        address[] memory coSigners = validator.getCoSigners(admin1);
        assertEq(coSigners.length, 2);

        // Both should be valid
        assertTrue(_arrayContains(coSigners, coSigner1));
        assertTrue(_arrayContains(coSigners, coSigner2));
    }

    // ============ Admin Management Tests ============

    function test_SetAdmin() public {
        // Install account
        address[] memory keys = new address[](1);
        keys[0] = agentKey1;
        bytes memory initData = abi.encode(admin1, keys);

        vm.prank(account1);
        validator.onInstall(initData);

        // Change admin
        vm.expectEmit(true, true, true, false);
        emit AdminUpdated(account1, admin1, admin2);

        vm.prank(account1);
        validator.setAdmin(admin2);

        assertEq(validator.getAdmin(account1), admin2);
    }

    function test_SetAdmin_RevertsIfNotInitialized() public {
        vm.prank(account1);
        vm.expectRevert(ICoSignerValidator.CoSignerValidator_NotInitialized.selector);
        validator.setAdmin(admin2);
    }

    function test_SetAdmin_RevertsIfInvalidAddress() public {
        // Install first
        address[] memory keys = new address[](0);
        bytes memory initData = abi.encode(admin1, keys);

        vm.prank(account1);
        validator.onInstall(initData);

        vm.prank(account1);
        vm.expectRevert(ICoSignerValidator.CoSignerValidator_InvalidAddress.selector);
        validator.setAdmin(address(0));
    }

    // ============ Signature Validation Tests ============

    function test_IsValidSignatureWithSender_ValidDualSignature() public {
        // Install account with agent key
        address[] memory keys = new address[](1);
        keys[0] = agentKey1;
        bytes memory initData = abi.encode(admin1, keys);

        vm.prank(account1);
        validator.onInstall(initData);

        // Create a message hash to sign
        bytes32 hash = keccak256("test message");

        // Sign with agent key (NO Ethereum prefix for ERC-1271)
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(agentKey1Pk, hash);
        bytes memory agentSig = abi.encodePacked(r1, s1, v1);

        // Sign with coSigner (NO Ethereum prefix for ERC-1271)
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(coSigner1Pk, hash);
        bytes memory coSignerSig = abi.encodePacked(r2, s2, v2);

        // Combine signatures
        bytes memory signature = abi.encode(agentSig, coSignerSig);

        // Validate
        bytes4 result = validator.isValidSignatureWithSender(account1, hash, signature);
        assertEq(result, bytes4(0x1626ba7e)); // EIP1271_SUCCESS
    }

    function test_IsValidSignatureWithSender_InvalidAgentKey() public {
        // Install account with agent key
        address[] memory keys = new address[](1);
        keys[0] = agentKey1;
        bytes memory initData = abi.encode(admin1, keys);

        vm.prank(account1);
        validator.onInstall(initData);

        bytes32 hash = keccak256("test message");

        // Sign with agentKey2 (NOT registered)
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(agentKey2Pk, hash);
        bytes memory agentSig = abi.encodePacked(r1, s1, v1);

        // Sign with valid coSigner
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(coSigner1Pk, hash);
        bytes memory coSignerSig = abi.encodePacked(r2, s2, v2);

        bytes memory signature = abi.encode(agentSig, coSignerSig);

        bytes4 result = validator.isValidSignatureWithSender(account1, hash, signature);
        assertEq(result, bytes4(0xFFFFFFFF)); // EIP1271_FAILED
    }

    function test_IsValidSignatureWithSender_InvalidCoSigner() public {
        // Install account
        address[] memory keys = new address[](1);
        keys[0] = agentKey1;
        bytes memory initData = abi.encode(admin1, keys);

        vm.prank(account1);
        validator.onInstall(initData);

        bytes32 hash = keccak256("test message");

        // Sign with valid agent key
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(agentKey1Pk, hash);
        bytes memory agentSig = abi.encodePacked(r1, s1, v1);

        // Sign with coSigner2 (NOT in admin1's set)
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(coSigner2Pk, hash);
        bytes memory coSignerSig = abi.encodePacked(r2, s2, v2);

        bytes memory signature = abi.encode(agentSig, coSignerSig);

        bytes4 result = validator.isValidSignatureWithSender(account1, hash, signature);
        assertEq(result, bytes4(0xFFFFFFFF)); // EIP1271_FAILED
    }

    function test_IsValidSignatureWithSender_WrongAdminsCoSigner() public {
        // Install account1 trusting admin1
        address[] memory keys = new address[](1);
        keys[0] = agentKey1;
        bytes memory initData = abi.encode(admin1, keys);

        vm.prank(account1);
        validator.onInstall(initData);

        // Admin2 registers their own coSigner
        vm.prank(admin2);
        validator.addCoSigner(coSigner2);

        bytes32 hash = keccak256("test message");

        // Sign with valid agent key
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(agentKey1Pk, hash);
        bytes memory agentSig = abi.encodePacked(r1, s1, v1);

        // Sign with admin2's coSigner (account1 trusts admin1, not admin2)
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(coSigner2Pk, hash);
        bytes memory coSignerSig = abi.encodePacked(r2, s2, v2);

        bytes memory signature = abi.encode(agentSig, coSignerSig);

        bytes4 result = validator.isValidSignatureWithSender(account1, hash, signature);
        assertEq(result, bytes4(0xFFFFFFFF)); // Should fail - wrong admin's coSigner
    }

    function test_ValidateUserOp_ValidDualSignature() public {
        // Install account
        address[] memory keys = new address[](1);
        keys[0] = agentKey1;
        bytes memory initData = abi.encode(admin1, keys);

        vm.prank(account1);
        validator.onInstall(initData);

        // Create a UserOp hash
        bytes32 userOpHash = keccak256("userOp");

        // Apply Ethereum signed message prefix (as per ERC-4337 pattern)
        bytes32 messageHash = _toEthSignedMessageHash(userOpHash);

        // Sign with agent key
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(agentKey1Pk, messageHash);
        bytes memory agentSig = abi.encodePacked(r1, s1, v1);

        // Sign with coSigner
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(coSigner1Pk, messageHash);
        bytes memory coSignerSig = abi.encodePacked(r2, s2, v2);

        // Combine signatures
        bytes memory signature = abi.encode(agentSig, coSignerSig);

        // Create PackedUserOperation
        PackedUserOperation memory userOp = PackedUserOperation({
            sender: account1,
            nonce: 0,
            initCode: "",
            callData: "",
            accountGasLimits: bytes32(0),
            preVerificationGas: 0,
            gasFees: bytes32(0),
            paymasterAndData: "",
            signature: signature
        });

        // Validate (called as account)
        vm.prank(account1);
        uint256 result = ERC7579ValidatorBase.ValidationData.unwrap(validator.validateUserOp(userOp, userOpHash));

        assertEq(result, 0); // VALIDATION_SUCCESS
    }

    function test_ValidateUserOp_InvalidAgentKey() public {
        // Install account
        address[] memory keys = new address[](1);
        keys[0] = agentKey1;
        bytes memory initData = abi.encode(admin1, keys);

        vm.prank(account1);
        validator.onInstall(initData);

        bytes32 userOpHash = keccak256("userOp");
        bytes32 messageHash = _toEthSignedMessageHash(userOpHash);

        // Sign with wrong agent key
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(agentKey2Pk, messageHash);
        bytes memory agentSig = abi.encodePacked(r1, s1, v1);

        // Valid coSigner
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(coSigner1Pk, messageHash);
        bytes memory coSignerSig = abi.encodePacked(r2, s2, v2);

        bytes memory signature = abi.encode(agentSig, coSignerSig);

        PackedUserOperation memory userOp = PackedUserOperation({
            sender: account1,
            nonce: 0,
            initCode: "",
            callData: "",
            accountGasLimits: bytes32(0),
            preVerificationGas: 0,
            gasFees: bytes32(0),
            paymasterAndData: "",
            signature: signature
        });

        vm.prank(account1);
        uint256 result = ERC7579ValidatorBase.ValidationData.unwrap(validator.validateUserOp(userOp, userOpHash));

        assertEq(result, 1); // VALIDATION_FAILED (unwrapped)
    }

    function test_ValidateUserOp_InvalidCoSigner() public {
        // Install account
        address[] memory keys = new address[](1);
        keys[0] = agentKey1;
        bytes memory initData = abi.encode(admin1, keys);

        vm.prank(account1);
        validator.onInstall(initData);

        bytes32 userOpHash = keccak256("userOp");
        bytes32 messageHash = _toEthSignedMessageHash(userOpHash);

        // Valid agent key
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(agentKey1Pk, messageHash);
        bytes memory agentSig = abi.encodePacked(r1, s1, v1);

        // Invalid coSigner
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(coSigner2Pk, messageHash);
        bytes memory coSignerSig = abi.encodePacked(r2, s2, v2);

        bytes memory signature = abi.encode(agentSig, coSignerSig);

        PackedUserOperation memory userOp = PackedUserOperation({
            sender: account1,
            nonce: 0,
            initCode: "",
            callData: "",
            accountGasLimits: bytes32(0),
            preVerificationGas: 0,
            gasFees: bytes32(0),
            paymasterAndData: "",
            signature: signature
        });

        vm.prank(account1);
        uint256 result = ERC7579ValidatorBase.ValidationData.unwrap(validator.validateUserOp(userOp, userOpHash));

        assertEq(result, 1); // VALIDATION_FAILED (unwrapped)
    }

    // ============ Admin Rotation Tests ============

    function test_CoSignerRotation_BothKeysValidDuringGracePeriod() public {
        // Install account
        address[] memory keys = new address[](1);
        keys[0] = agentKey1;
        bytes memory initData = abi.encode(admin1, keys);

        vm.prank(account1);
        validator.onInstall(initData);

        // Admin adds new coSigner (old one still valid)
        vm.prank(admin1);
        validator.addCoSigner(coSigner2);

        bytes32 hash = keccak256("test message");

        // Test with OLD coSigner
        bytes memory signature1 = _createDualSignature(agentKey1Pk, coSigner1Pk, hash);
        bytes4 result1 = validator.isValidSignatureWithSender(account1, hash, signature1);
        assertEq(result1, bytes4(0x1626ba7e)); // Should succeed

        // Test with NEW coSigner
        bytes memory signature2 = _createDualSignature(agentKey1Pk, coSigner2Pk, hash);
        bytes4 result2 = validator.isValidSignatureWithSender(account1, hash, signature2);
        assertEq(result2, bytes4(0x1626ba7e)); // Should also succeed
    }

    function test_MultipleAccountsSameAdmin_RotationAffectsBoth() public {
        // Install account1 with admin1
        address[] memory keys1 = new address[](1);
        keys1[0] = agentKey1;

        vm.prank(account1);
        validator.onInstall(abi.encode(admin1, keys1));

        // Install account2 with same admin1
        address[] memory keys2 = new address[](1);
        keys2[0] = agentKey2;

        vm.prank(account2);
        validator.onInstall(abi.encode(admin1, keys2));

        // Both accounts should work with coSigner1
        bytes32 hash = keccak256("test");

        // Test account1 with coSigner1
        bytes memory sig1 = _createDualSignature(agentKey1Pk, coSigner1Pk, hash);
        assertEq(validator.isValidSignatureWithSender(account1, hash, sig1), bytes4(0x1626ba7e));

        // Test account2 with coSigner1
        bytes memory sig2 = _createDualSignature(agentKey2Pk, coSigner1Pk, hash);
        assertEq(validator.isValidSignatureWithSender(account2, hash, sig2), bytes4(0x1626ba7e));

        // Admin rotates coSigner
        vm.prank(admin1);
        validator.addCoSigner(coSigner2);
        vm.prank(admin1);
        validator.removeCoSigner(coSigner1);

        // Now both accounts should ONLY work with coSigner2
        // Old coSigner1 should fail for both
        bytes4 result1Old = validator.isValidSignatureWithSender(account1, hash, sig1);
        assertEq(result1Old, bytes4(0xFFFFFFFF)); // FAILED

        bytes4 result2Old = validator.isValidSignatureWithSender(account2, hash, sig2);
        assertEq(result2Old, bytes4(0xFFFFFFFF)); // FAILED

        // New coSigner2 should work for both
        bytes memory sig1New = _createDualSignature(agentKey1Pk, coSigner2Pk, hash);
        assertEq(validator.isValidSignatureWithSender(account1, hash, sig1New), bytes4(0x1626ba7e));

        bytes memory sig2New = _createDualSignature(agentKey2Pk, coSigner2Pk, hash);
        assertEq(validator.isValidSignatureWithSender(account2, hash, sig2New), bytes4(0x1626ba7e));
    }

    // ============ Helper Functions Tests ============

    function test_IsValidCoSignerForAccount() public {
        // Install account trusting admin1
        address[] memory keys = new address[](1);
        keys[0] = agentKey1;
        vm.prank(account1);
        validator.onInstall(abi.encode(admin1, keys));

        // coSigner1 is registered for admin1 (in setUp)
        assertTrue(validator.isValidCoSignerForAccount(account1, coSigner1));

        // coSigner2 is not registered
        assertFalse(validator.isValidCoSignerForAccount(account1, coSigner2));

        // Add coSigner2
        vm.prank(admin1);
        validator.addCoSigner(coSigner2);

        // Now coSigner2 should be valid
        assertTrue(validator.isValidCoSignerForAccount(account1, coSigner2));
    }

    // ============ Edge Cases ============

    function test_EmptyCoSigners_ValidationFails() public {
        // Install account (admin1 has coSigner1)
        address[] memory keys = new address[](1);
        keys[0] = agentKey1;

        vm.prank(account1);
        validator.onInstall(abi.encode(admin1, keys));

        // Remove all coSigners
        vm.prank(admin1);
        validator.removeCoSigner(coSigner1);

        // Validation should fail (no valid coSigners)
        bytes32 hash = keccak256("test");
        bytes memory sig = _createDualSignature(agentKey1Pk, coSigner1Pk, hash);

        bytes4 result = validator.isValidSignatureWithSender(account1, hash, sig);
        assertEq(result, bytes4(0xFFFFFFFF)); // Should fail
    }

    function test_EmptyAgentKeys_ValidationFails() public {
        // Install account with no keys
        address[] memory keys = new address[](0);

        vm.prank(account1);
        validator.onInstall(abi.encode(admin1, keys));

        // Validation should fail (no registered agent keys)
        bytes32 hash = keccak256("test");
        bytes memory sig = _createDualSignature(agentKey1Pk, coSigner1Pk, hash);

        bytes4 result = validator.isValidSignatureWithSender(account1, hash, sig);
        assertEq(result, bytes4(0xFFFFFFFF)); // Should fail
    }

    // ============ Helper Functions ============

    function _arrayContains(address[] memory arr, address item) internal pure returns (bool) {
        for (uint256 i = 0; i < arr.length; i++) {
            if (arr[i] == item) return true;
        }
        return false;
    }

    function _toEthSignedMessageHash(bytes32 hash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
    }

    function _createDualSignature(uint256 agentPk, uint256 coSignerPk, bytes32 hash)
        internal
        pure
        returns (bytes memory)
    {
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(agentPk, hash);
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(coSignerPk, hash);
        return abi.encode(abi.encodePacked(r1, s1, v1), abi.encodePacked(r2, s2, v2));
    }
}
