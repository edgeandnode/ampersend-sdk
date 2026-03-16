use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use ampersend_sdk::x402::treasurer::{Authorization, PaymentContext, PaymentStatus, X402Treasurer};
use ampersend_sdk::x402::treasurers::NaiveTreasurer;
use ampersend_sdk::x402::types::{PaymentPayload, PaymentRequirements};
use ampersend_sdk::x402::wallet::X402Wallet;
use ampersend_sdk::x402::wallets::AccountWallet;

const TEST_PRIVATE_KEY: &str = "0xabababababababababababababababababababababababababababababababab";

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

#[cfg(test)]
mod naive_treasurer {
    use super::*;

    #[tokio::test]
    async fn approves_payment_with_valid_requirements() {
        let wallet = AccountWallet::from_private_key(TEST_PRIVATE_KEY).unwrap();
        let treasurer = NaiveTreasurer::new(Box::new(wallet));

        let reqs = vec![test_requirements()];
        let result = treasurer.on_payment_required(&reqs, None).await;

        assert!(result.is_some());
        let auth = result.unwrap();
        assert_eq!(auth.payment.scheme, "exact");
        assert!(!auth.authorization_id.is_empty());
    }

    #[tokio::test]
    async fn returns_none_for_empty_requirements() {
        let wallet = AccountWallet::from_private_key(TEST_PRIVATE_KEY).unwrap();
        let treasurer = NaiveTreasurer::new(Box::new(wallet));

        let result = treasurer.on_payment_required(&[], None).await;
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn uses_first_requirement() {
        let wallet = AccountWallet::from_private_key(TEST_PRIVATE_KEY).unwrap();
        let treasurer = NaiveTreasurer::new(Box::new(wallet));

        let mut req1 = test_requirements();
        req1.max_amount_required = "5000".to_string();
        let mut req2 = test_requirements();
        req2.max_amount_required = "20000".to_string();

        let reqs = vec![req1, req2];
        let auth = treasurer.on_payment_required(&reqs, None).await.unwrap();
        let value = auth.payment.payload["authorization"]["value"]
            .as_str()
            .unwrap();
        assert_eq!(value, "5000");
    }

    #[tokio::test]
    async fn on_status_does_not_panic() {
        let wallet = AccountWallet::from_private_key(TEST_PRIVATE_KEY).unwrap();
        let treasurer = NaiveTreasurer::new(Box::new(wallet));

        let auth = Authorization {
            payment: PaymentPayload {
                x402_version: 1,
                scheme: "exact".to_string(),
                network: "base-sepolia".to_string(),
                payload: serde_json::json!({}),
            },
            authorization_id: "test-id".to_string(),
        };

        // Should not panic for any status
        treasurer
            .on_status(PaymentStatus::Sending, &auth, None)
            .await;
        treasurer
            .on_status(PaymentStatus::Accepted, &auth, None)
            .await;
        treasurer
            .on_status(PaymentStatus::Rejected, &auth, None)
            .await;
        treasurer
            .on_status(PaymentStatus::Declined, &auth, None)
            .await;
        treasurer.on_status(PaymentStatus::Error, &auth, None).await;
    }

    #[tokio::test]
    async fn generates_unique_authorization_ids() {
        let wallet = AccountWallet::from_private_key(TEST_PRIVATE_KEY).unwrap();
        let treasurer = NaiveTreasurer::new(Box::new(wallet));
        let reqs = vec![test_requirements()];

        let auth1 = treasurer.on_payment_required(&reqs, None).await.unwrap();
        let auth2 = treasurer.on_payment_required(&reqs, None).await.unwrap();

        assert_ne!(auth1.authorization_id, auth2.authorization_id);
    }
}

/// A mock treasurer for testing that records calls.
struct MockTreasurer {
    should_approve: bool,
    payment_required_count: AtomicU32,
    status_calls: tokio::sync::Mutex<Vec<PaymentStatus>>,
}

impl MockTreasurer {
    fn new(should_approve: bool) -> Self {
        Self {
            should_approve,
            payment_required_count: AtomicU32::new(0),
            status_calls: tokio::sync::Mutex::new(Vec::new()),
        }
    }
}

#[async_trait::async_trait]
impl X402Treasurer for MockTreasurer {
    async fn on_payment_required(
        &self,
        _requirements: &[PaymentRequirements],
        _context: Option<&PaymentContext>,
    ) -> Option<Authorization> {
        self.payment_required_count.fetch_add(1, Ordering::Relaxed);
        if self.should_approve {
            Some(Authorization {
                payment: PaymentPayload {
                    x402_version: 1,
                    scheme: "exact".to_string(),
                    network: "base-sepolia".to_string(),
                    payload: serde_json::json!({"mock": true}),
                },
                authorization_id: uuid::Uuid::new_v4().to_string(),
            })
        } else {
            None
        }
    }

    async fn on_status(
        &self,
        status: PaymentStatus,
        _authorization: &Authorization,
        _context: Option<&PaymentContext>,
    ) {
        self.status_calls.lock().await.push(status);
    }
}

#[cfg(test)]
mod mock_treasurer {
    use super::*;

    #[tokio::test]
    async fn approving_treasurer_returns_authorization() {
        let treasurer = MockTreasurer::new(true);
        let reqs = vec![test_requirements()];
        let result = treasurer.on_payment_required(&reqs, None).await;
        assert!(result.is_some());
        assert_eq!(treasurer.payment_required_count.load(Ordering::Relaxed), 1);
    }

    #[tokio::test]
    async fn declining_treasurer_returns_none() {
        let treasurer = MockTreasurer::new(false);
        let reqs = vec![test_requirements()];
        let result = treasurer.on_payment_required(&reqs, None).await;
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn tracks_status_calls() {
        let treasurer = MockTreasurer::new(true);
        let auth = treasurer
            .on_payment_required(&[test_requirements()], None)
            .await
            .unwrap();

        treasurer
            .on_status(PaymentStatus::Sending, &auth, None)
            .await;
        treasurer
            .on_status(PaymentStatus::Accepted, &auth, None)
            .await;

        let statuses = treasurer.status_calls.lock().await;
        assert_eq!(statuses.len(), 2);
        assert_eq!(statuses[0], PaymentStatus::Sending);
        assert_eq!(statuses[1], PaymentStatus::Accepted);
    }
}
