//! Tests for ERC-3009 signing and ERC-1271 signature encoding.
//!
//! Mirrors the Python tests in tests/unit/smart_account/test_encode_1271_signature.py
//! and tests/unit/x402/wallets/smart_account/test_sign_erc3009.py

use alloy_primitives::{Address, FixedBytes, U256};
use ampersend_sdk::smart_account::signing::sign_erc3009_authorization;
use ampersend_sdk::smart_account::types::ERC3009AuthorizationData;

const TEST_PRIVATE_KEY: &str = "0xabababababababababababababababababababababababababababababababab";

fn test_auth_data() -> ERC3009AuthorizationData {
    ERC3009AuthorizationData {
        from: "0x857b06519E91e3A54538791bDbb0E22373e36b66"
            .parse()
            .unwrap(),
        to: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C"
            .parse()
            .unwrap(),
        value: U256::from(10000u64),
        valid_after: U256::from(0u64),
        valid_before: U256::from(9999999999u64),
        nonce: FixedBytes::from([0xABu8; 32]),
    }
}

#[cfg(test)]
mod erc3009_signing {
    use super::*;

    #[tokio::test]
    async fn produces_valid_signature() {
        let token_address: Address = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
            .parse()
            .unwrap();
        let smart_account: Address = "0x857b06519E91e3A54538791bDbb0E22373e36b66"
            .parse()
            .unwrap();
        let validator: Address = "0x000000000013fdB5234E4E3162a810F54d9f7E98"
            .parse()
            .unwrap();

        let signature = sign_erc3009_authorization(
            TEST_PRIVATE_KEY,
            smart_account,
            &test_auth_data(),
            token_address,
            84532,
            validator,
            "USD Coin",
            "2",
        )
        .await
        .unwrap();

        // Signature should not be empty
        assert!(!signature.is_empty(), "Signature should not be empty");

        // Signature should start with the validator address (20 bytes)
        let sig_bytes = signature.as_ref();
        assert!(
            sig_bytes.len() > 20,
            "Signature should be longer than 20 bytes"
        );

        // First 20 bytes should be the validator address
        let validator_prefix = &sig_bytes[..20];
        assert_eq!(
            validator_prefix,
            validator.as_slice(),
            "Signature should be prefixed with validator address"
        );
    }

    #[tokio::test]
    async fn signature_has_correct_structure() {
        let token_address: Address = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
            .parse()
            .unwrap();
        let smart_account: Address = "0x857b06519E91e3A54538791bDbb0E22373e36b66"
            .parse()
            .unwrap();
        let validator: Address = "0x000000000013fdB5234E4E3162a810F54d9f7E98"
            .parse()
            .unwrap();

        let signature = sign_erc3009_authorization(
            TEST_PRIVATE_KEY,
            smart_account,
            &test_auth_data(),
            token_address,
            84532,
            validator,
            "USD Coin",
            "2",
        )
        .await
        .unwrap();

        let sig_bytes = signature.as_ref();

        // Structure: validator address (20 bytes) + EOA signature (65 bytes)
        assert_eq!(
            sig_bytes.len(),
            85,
            "Signature should be 85 bytes (20 validator + 65 EOA sig)"
        );

        // The EOA signature part (last 65 bytes) should have valid v value
        let v = sig_bytes[84]; // last byte is v
        assert!(v == 27 || v == 28, "v value should be 27 or 28, got {v}");
    }

    #[tokio::test]
    async fn different_nonces_produce_different_signatures() {
        let token_address: Address = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
            .parse()
            .unwrap();
        let smart_account: Address = "0x857b06519E91e3A54538791bDbb0E22373e36b66"
            .parse()
            .unwrap();
        let validator: Address = "0x000000000013fdB5234E4E3162a810F54d9f7E98"
            .parse()
            .unwrap();

        let mut auth1 = test_auth_data();
        auth1.nonce = FixedBytes::from([0x01u8; 32]);

        let mut auth2 = test_auth_data();
        auth2.nonce = FixedBytes::from([0x02u8; 32]);

        let sig1 = sign_erc3009_authorization(
            TEST_PRIVATE_KEY,
            smart_account,
            &auth1,
            token_address,
            84532,
            validator,
            "USD Coin",
            "2",
        )
        .await
        .unwrap();

        let sig2 = sign_erc3009_authorization(
            TEST_PRIVATE_KEY,
            smart_account,
            &auth2,
            token_address,
            84532,
            validator,
            "USD Coin",
            "2",
        )
        .await
        .unwrap();

        assert_ne!(
            sig1, sig2,
            "Different nonces should produce different signatures"
        );
    }

    #[tokio::test]
    async fn rejects_invalid_session_key() {
        let token_address: Address = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
            .parse()
            .unwrap();
        let smart_account: Address = "0x857b06519E91e3A54538791bDbb0E22373e36b66"
            .parse()
            .unwrap();
        let validator: Address = "0x000000000013fdB5234E4E3162a810F54d9f7E98"
            .parse()
            .unwrap();

        let result = sign_erc3009_authorization(
            "0xinvalid",
            smart_account,
            &test_auth_data(),
            token_address,
            84532,
            validator,
            "USD Coin",
            "2",
        )
        .await;

        assert!(result.is_err(), "Should reject invalid session key");
    }
}
