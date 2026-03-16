//! Tests for the x402 HTTP adapter.
//!
//! Mirrors the TypeScript tests in tests/x402/http/adapter.test.ts
//! and Python tests in tests/unit/x402/http/test_transport.py

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use ampersend_sdk::http::adapter::X402HttpClient;
use ampersend_sdk::x402::treasurer::{Authorization, PaymentContext, PaymentStatus, X402Treasurer};
use ampersend_sdk::x402::types::{PaymentPayload, PaymentRequirements};

// ============================================================================
// Test helpers
// ============================================================================

fn mock_payment() -> PaymentPayload {
    PaymentPayload {
        x402_version: 1,
        scheme: "exact".to_string(),
        network: "base-sepolia".to_string(),
        payload: serde_json::json!({
            "signature": "0xmocksig",
            "authorization": {
                "from": "0x1111111111111111111111111111111111111111",
                "to": "0x2222222222222222222222222222222222222222",
                "value": "1000",
                "validAfter": "0",
                "validBefore": "9999999999",
                "nonce": "0x3333333333333333333333333333333333333333333333333333333333333333"
            }
        }),
    }
}

fn mock_requirements() -> PaymentRequirements {
    PaymentRequirements {
        scheme: "exact".to_string(),
        network: "base-sepolia".to_string(),
        max_amount_required: "1000".to_string(),
        resource: "http://test.com/api".to_string(),
        description: "Test".to_string(),
        mime_type: "application/json".to_string(),
        pay_to: "0x2222222222222222222222222222222222222222".to_string(),
        max_timeout_seconds: 300,
        asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e".to_string(),
        extra: None,
    }
}

struct MockHttpTreasurer {
    should_approve: bool,
    payment_required_count: AtomicU32,
    status_calls: tokio::sync::Mutex<Vec<PaymentStatus>>,
}

impl MockHttpTreasurer {
    fn approving() -> Self {
        Self {
            should_approve: true,
            payment_required_count: AtomicU32::new(0),
            status_calls: tokio::sync::Mutex::new(Vec::new()),
        }
    }

    fn declining() -> Self {
        Self {
            should_approve: false,
            payment_required_count: AtomicU32::new(0),
            status_calls: tokio::sync::Mutex::new(Vec::new()),
        }
    }
}

#[async_trait::async_trait]
impl X402Treasurer for MockHttpTreasurer {
    async fn on_payment_required(
        &self,
        _requirements: &[PaymentRequirements],
        _context: Option<&PaymentContext>,
    ) -> Option<Authorization> {
        self.payment_required_count.fetch_add(1, Ordering::Relaxed);
        if self.should_approve {
            Some(Authorization {
                payment: mock_payment(),
                authorization_id: "http-auth-id".to_string(),
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

// ============================================================================
// HTTP adapter tests using wiremock
// ============================================================================

#[cfg(test)]
mod http_adapter {
    use super::*;
    use wiremock::matchers::{header_exists, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[tokio::test]
    async fn non_402_passes_through() {
        let mock_server = MockServer::start().await;

        Mock::given(method("GET"))
            .and(path("/api/data"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(serde_json::json!({"result": "ok"})),
            )
            .expect(1)
            .mount(&mock_server)
            .await;

        let treasurer = Arc::new(MockHttpTreasurer::approving());
        let client = X402HttpClient::new(treasurer.clone());

        let request = reqwest::Client::new()
            .get(format!("{}/api/data", mock_server.uri()))
            .build()
            .unwrap();

        let response = client.execute(request).await.unwrap();
        assert_eq!(response.status(), 200);

        // Treasurer should NOT have been called
        assert_eq!(
            treasurer.payment_required_count.load(Ordering::Relaxed),
            0
        );
        let statuses = treasurer.status_calls.lock().await;
        assert!(statuses.is_empty());
    }

    #[tokio::test]
    async fn retries_402_with_payment_header() {
        let mock_server = MockServer::start().await;

        // Register success mock FIRST — wiremock matches in reverse order,
        // but header_exists constraint makes it only match the retry.
        Mock::given(method("GET"))
            .and(path("/api/paid"))
            .and(header_exists("X-PAYMENT"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(serde_json::json!({"result": "paid"})),
            )
            .expect(1)
            .named("success after payment")
            .mount(&mock_server)
            .await;

        // 402 mock matches requests WITHOUT X-PAYMENT header
        Mock::given(method("GET"))
            .and(path("/api/paid"))
            .respond_with(ResponseTemplate::new(402).set_body_json(serde_json::json!({
                "x402Version": 1,
                "accepts": [mock_requirements()]
            })))
            .up_to_n_times(1)
            .expect(1)
            .named("402 response")
            .mount(&mock_server)
            .await;

        let treasurer = Arc::new(MockHttpTreasurer::approving());
        let client = X402HttpClient::new(treasurer.clone());

        let request = reqwest::Client::new()
            .get(format!("{}/api/paid", mock_server.uri()))
            .build()
            .unwrap();

        let response = client.execute(request).await.unwrap();
        assert_eq!(response.status(), 200);

        // Treasurer should have been called once
        assert_eq!(
            treasurer.payment_required_count.load(Ordering::Relaxed),
            1
        );

        // Status should track sending → accepted
        let statuses = treasurer.status_calls.lock().await;
        assert!(statuses.contains(&PaymentStatus::Sending));
        assert!(statuses.contains(&PaymentStatus::Accepted));
    }

    #[tokio::test]
    async fn returns_error_when_treasurer_declines() {
        let mock_server = MockServer::start().await;

        Mock::given(method("GET"))
            .and(path("/api/paid"))
            .respond_with(ResponseTemplate::new(402).set_body_json(serde_json::json!({
                "x402Version": 1,
                "accepts": [mock_requirements()]
            })))
            .expect(1)
            .mount(&mock_server)
            .await;

        let treasurer = Arc::new(MockHttpTreasurer::declining());
        let client = X402HttpClient::new(treasurer.clone());

        let request = reqwest::Client::new()
            .get(format!("{}/api/paid", mock_server.uri()))
            .build()
            .unwrap();

        let result = client.execute(request).await;
        assert!(result.is_err());

        let err = result.unwrap_err();
        assert!(
            err.to_string().contains("declined"),
            "Error should mention declined: {}",
            err
        );

        // Treasurer was called but no status tracking (declined path)
        assert_eq!(
            treasurer.payment_required_count.load(Ordering::Relaxed),
            1
        );
        let statuses = treasurer.status_calls.lock().await;
        assert!(statuses.is_empty(), "No status should be tracked on decline");
    }

    #[tokio::test]
    async fn tracks_rejected_when_retry_returns_402() {
        let mock_server = MockServer::start().await;

        // Both requests return 402 (payment rejected on retry)
        Mock::given(method("GET"))
            .and(path("/api/rejected"))
            .respond_with(ResponseTemplate::new(402).set_body_json(serde_json::json!({
                "x402Version": 1,
                "accepts": [mock_requirements()]
            })))
            .expect(2)
            .mount(&mock_server)
            .await;

        let treasurer = Arc::new(MockHttpTreasurer::approving());
        let client = X402HttpClient::new(treasurer.clone());

        let request = reqwest::Client::new()
            .get(format!("{}/api/rejected", mock_server.uri()))
            .build()
            .unwrap();

        let response = client.execute(request).await.unwrap();
        assert_eq!(response.status(), 402);

        // Status should track sending → rejected
        let statuses = treasurer.status_calls.lock().await;
        assert!(statuses.contains(&PaymentStatus::Sending));
        assert!(statuses.contains(&PaymentStatus::Rejected));
    }

    #[tokio::test]
    async fn tracks_error_on_non_402_retry_failure() {
        let mock_server = MockServer::start().await;

        // First returns 402, second returns 500
        Mock::given(method("GET"))
            .and(path("/api/error"))
            .respond_with(ResponseTemplate::new(402).set_body_json(serde_json::json!({
                "x402Version": 1,
                "accepts": [mock_requirements()]
            })))
            .up_to_n_times(1)
            .expect(1)
            .mount(&mock_server)
            .await;

        Mock::given(method("GET"))
            .and(path("/api/error"))
            .and(header_exists("X-PAYMENT"))
            .respond_with(ResponseTemplate::new(500).set_body_string("Server error"))
            .expect(1)
            .mount(&mock_server)
            .await;

        let treasurer = Arc::new(MockHttpTreasurer::approving());
        let client = X402HttpClient::new(treasurer.clone());

        let request = reqwest::Client::new()
            .get(format!("{}/api/error", mock_server.uri()))
            .build()
            .unwrap();

        let response = client.execute(request).await.unwrap();
        assert_eq!(response.status(), 500);

        // Status should track sending → error
        let statuses = treasurer.status_calls.lock().await;
        assert!(statuses.contains(&PaymentStatus::Sending));
        assert!(statuses.contains(&PaymentStatus::Error));
    }

    #[tokio::test]
    async fn handles_non_json_402_body() {
        let mock_server = MockServer::start().await;

        Mock::given(method("GET"))
            .and(path("/api/bad402"))
            .respond_with(ResponseTemplate::new(402).set_body_string("Payment Required"))
            .expect(1)
            .mount(&mock_server)
            .await;

        let treasurer = Arc::new(MockHttpTreasurer::approving());
        let client = X402HttpClient::new(treasurer.clone());

        let request = reqwest::Client::new()
            .get(format!("{}/api/bad402", mock_server.uri()))
            .build()
            .unwrap();

        let result = client.execute(request).await;
        assert!(result.is_err(), "Should fail on non-JSON 402 body");

        // Treasurer should NOT have been called (couldn't parse requirements)
        assert_eq!(
            treasurer.payment_required_count.load(Ordering::Relaxed),
            0
        );
    }

    #[tokio::test]
    async fn handles_non_x402_json_402_body() {
        let mock_server = MockServer::start().await;

        Mock::given(method("GET"))
            .and(path("/api/non-x402"))
            .respond_with(
                ResponseTemplate::new(402)
                    .set_body_json(serde_json::json!({"error": "Need subscription"})),
            )
            .expect(1)
            .mount(&mock_server)
            .await;

        let treasurer = Arc::new(MockHttpTreasurer::approving());
        let client = X402HttpClient::new(treasurer.clone());

        let request = reqwest::Client::new()
            .get(format!("{}/api/non-x402", mock_server.uri()))
            .build()
            .unwrap();

        let result = client.execute(request).await;
        assert!(result.is_err(), "Should fail on non-x402 JSON 402 body");

        assert_eq!(
            treasurer.payment_required_count.load(Ordering::Relaxed),
            0
        );
    }

    #[tokio::test]
    async fn preserves_request_body_on_retry() {
        let mock_server = MockServer::start().await;

        // First returns 402
        Mock::given(method("POST"))
            .and(path("/api/post-paid"))
            .respond_with(ResponseTemplate::new(402).set_body_json(serde_json::json!({
                "x402Version": 1,
                "accepts": [mock_requirements()]
            })))
            .up_to_n_times(1)
            .expect(1)
            .mount(&mock_server)
            .await;

        // Second returns 200
        Mock::given(method("POST"))
            .and(path("/api/post-paid"))
            .and(header_exists("X-PAYMENT"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(serde_json::json!({"saved": true})),
            )
            .expect(1)
            .mount(&mock_server)
            .await;

        let treasurer = Arc::new(MockHttpTreasurer::approving());
        let client = X402HttpClient::new(treasurer.clone());

        let request = reqwest::Client::new()
            .post(format!("{}/api/post-paid", mock_server.uri()))
            .json(&serde_json::json!({"data": "important"}))
            .build()
            .unwrap();

        let response = client.execute(request).await.unwrap();
        assert_eq!(response.status(), 200);
    }

    #[tokio::test]
    async fn payment_header_is_base64_encoded() {
        let mock_server = MockServer::start().await;

        Mock::given(method("GET"))
            .and(path("/api/check-header"))
            .respond_with(ResponseTemplate::new(402).set_body_json(serde_json::json!({
                "x402Version": 1,
                "accepts": [mock_requirements()]
            })))
            .up_to_n_times(1)
            .expect(1)
            .mount(&mock_server)
            .await;

        // Capture the X-PAYMENT header in the retry
        Mock::given(method("GET"))
            .and(path("/api/check-header"))
            .and(header_exists("X-PAYMENT"))
            .respond_with(ResponseTemplate::new(200))
            .expect(1)
            .mount(&mock_server)
            .await;

        let treasurer = Arc::new(MockHttpTreasurer::approving());
        let client = X402HttpClient::new(treasurer.clone());

        let request = reqwest::Client::new()
            .get(format!("{}/api/check-header", mock_server.uri()))
            .build()
            .unwrap();

        let response = client.execute(request).await.unwrap();
        assert_eq!(response.status(), 200);

        // Verify the payment was approved and sent
        assert_eq!(
            treasurer.payment_required_count.load(Ordering::Relaxed),
            1
        );
    }
}
