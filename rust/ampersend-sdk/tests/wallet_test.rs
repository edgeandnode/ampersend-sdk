use std::collections::HashMap;

use ampersend_sdk::x402::types::PaymentRequirements;
use ampersend_sdk::x402::wallet::X402Wallet;
use ampersend_sdk::x402::wallets::{AccountWallet, SmartAccountConfig, SmartAccountWallet};

fn test_requirements() -> PaymentRequirements {
    let mut extra = HashMap::new();
    extra.insert("name".to_string(), serde_json::json!("USD Coin"));
    extra.insert("version".to_string(), serde_json::json!("2"));

    PaymentRequirements {
        scheme: "exact".to_string(),
        network: "base-sepolia".to_string(),
        max_amount_required: "10000".to_string(),
        resource: "https://example.com/api".to_string(),
        description: "Test payment".to_string(),
        mime_type: "application/json".to_string(),
        pay_to: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C".to_string(),
        max_timeout_seconds: 300,
        asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e".to_string(),
        extra: Some(extra),
    }
}

// Deterministic test key (same as TypeScript tests: 0xab repeated 32 times)
const TEST_PRIVATE_KEY: &str = "0xabababababababababababababababababababababababababababababababab";

#[cfg(test)]
mod account_wallet {
    use super::*;

    #[test]
    fn creates_from_private_key() {
        let wallet = AccountWallet::from_private_key(TEST_PRIVATE_KEY).unwrap();
        // Should have a valid address
        let addr = wallet.address();
        assert!(format!("{addr}").starts_with("0x"));
        assert_eq!(format!("{addr}").len(), 42);
    }

    #[test]
    fn rejects_invalid_private_key() {
        let result = AccountWallet::from_private_key("not-a-key");
        assert!(result.is_err());
    }

    #[test]
    fn rejects_empty_private_key() {
        let result = AccountWallet::from_private_key("");
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn creates_exact_payment() {
        let wallet = AccountWallet::from_private_key(TEST_PRIVATE_KEY).unwrap();
        let payment = wallet.create_payment(&test_requirements()).await.unwrap();

        assert_eq!(payment.x402_version, 1);
        assert_eq!(payment.scheme, "exact");
        assert_eq!(payment.network, "base-sepolia");

        // Verify payload structure
        assert!(payment.payload.get("signature").is_some());
        assert!(payment.payload.get("authorization").is_some());

        let auth = &payment.payload["authorization"];
        assert!(auth["from"].as_str().unwrap().starts_with("0x"));
        assert_eq!(
            auth["to"].as_str().unwrap(),
            "0x209693Bc6afc0C5328bA36FaF03C514EF312287C"
        );
        assert_eq!(auth["value"].as_str().unwrap(), "10000");
    }

    #[tokio::test]
    async fn rejects_unsupported_scheme() {
        let wallet = AccountWallet::from_private_key(TEST_PRIVATE_KEY).unwrap();
        let mut req = test_requirements();
        req.scheme = "deferred".to_string();

        let result = wallet.create_payment(&req).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Unsupported"));
    }

    #[tokio::test]
    async fn rejects_missing_domain_name() {
        let wallet = AccountWallet::from_private_key(TEST_PRIVATE_KEY).unwrap();
        let mut req = test_requirements();
        req.extra = Some(HashMap::new()); // no name/version

        let result = wallet.create_payment(&req).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("name"));
    }
}

#[cfg(test)]
mod smart_account_wallet {
    use super::*;

    fn test_config() -> SmartAccountConfig {
        SmartAccountConfig {
            smart_account_address: "0x857b06519E91e3A54538791bDbb0E22373e36b66"
                .parse()
                .unwrap(),
            session_key_private_key: TEST_PRIVATE_KEY.to_string(),
            chain_id: 84532,
            validator_address: None, // uses default OWNABLE_VALIDATOR
        }
    }

    #[test]
    fn creates_with_default_validator() {
        let wallet = SmartAccountWallet::new(test_config());
        assert_eq!(
            format!("{}", wallet.address()),
            "0x857b06519E91e3A54538791bDbb0E22373e36b66"
        );
    }

    #[tokio::test]
    async fn creates_exact_payment() {
        let wallet = SmartAccountWallet::new(test_config());
        let payment = wallet.create_payment(&test_requirements()).await.unwrap();

        assert_eq!(payment.x402_version, 1);
        assert_eq!(payment.scheme, "exact");
        assert_eq!(payment.network, "base-sepolia");

        let auth = &payment.payload["authorization"];
        assert_eq!(
            auth["from"].as_str().unwrap().to_lowercase(),
            "0x857b06519e91e3a54538791bdbb0e22373e36b66"
        );
        assert_eq!(
            auth["to"].as_str().unwrap(),
            "0x209693Bc6afc0C5328bA36FaF03C514EF312287C"
        );
        assert_eq!(auth["value"].as_str().unwrap(), "10000");
    }

    #[tokio::test]
    async fn rejects_unsupported_scheme() {
        let wallet = SmartAccountWallet::new(test_config());
        let mut req = test_requirements();
        req.scheme = "deferred".to_string();

        let result = wallet.create_payment(&req).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Unsupported"));
    }
}
