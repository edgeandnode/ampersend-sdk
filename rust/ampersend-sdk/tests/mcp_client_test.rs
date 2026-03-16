//! Tests for MCP client payment retry flow.
//!
//! Mirrors the TypeScript tests in tests/mcp/client/client.test.ts

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use ampersend_sdk::mcp::types::*;
use ampersend_sdk::x402::treasurer::{Authorization, PaymentContext, PaymentStatus, X402Treasurer};
use ampersend_sdk::x402::types::{PaymentPayload, PaymentRequirements};

// ============================================================================
// Test helpers
// ============================================================================

fn mock_payment_requirements() -> PaymentRequirements {
    PaymentRequirements {
        scheme: "exact".to_string(),
        network: "base-sepolia".to_string(),
        max_amount_required: "1000000000000000000".to_string(),
        resource: "http://test.com".to_string(),
        description: "Test payment".to_string(),
        mime_type: "application/json".to_string(),
        pay_to: "0x1111111111111111111111111111111111111111".to_string(),
        max_timeout_seconds: 300,
        asset: "0x2222222222222222222222222222222222222222".to_string(),
        extra: None,
    }
}

fn mock_payment() -> PaymentPayload {
    PaymentPayload {
        x402_version: 1,
        scheme: "exact".to_string(),
        network: "base-sepolia".to_string(),
        payload: serde_json::json!({
            "signature": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "authorization": {
                "from": "0x1111111111111111111111111111111111111111",
                "to": "0x2222222222222222222222222222222222222222",
                "value": "1000000000000000000",
                "validAfter": "0",
                "validBefore": "9999999999",
                "nonce": "0x3333333333333333333333333333333333333333333333333333333333333333"
            }
        }),
    }
}

fn mock_authorization() -> Authorization {
    Authorization {
        payment: mock_payment(),
        authorization_id: "test-auth-id".to_string(),
    }
}

fn mock_x402_error_data() -> McpX402PaymentRequired {
    McpX402PaymentRequired {
        x402_version: 1,
        accepts: vec![mock_payment_requirements()],
        error: None,
        payment_response: None,
    }
}

/// A configurable mock treasurer for testing.
struct MockTreasurer {
    should_approve: bool,
    should_error: bool,
    payment_required_count: AtomicU32,
    status_calls: tokio::sync::Mutex<Vec<PaymentStatus>>,
}

impl MockTreasurer {
    fn approving() -> Self {
        Self {
            should_approve: true,
            should_error: false,
            payment_required_count: AtomicU32::new(0),
            status_calls: tokio::sync::Mutex::new(Vec::new()),
        }
    }

    fn declining() -> Self {
        Self {
            should_approve: false,
            should_error: false,
            payment_required_count: AtomicU32::new(0),
            status_calls: tokio::sync::Mutex::new(Vec::new()),
        }
    }

    #[allow(dead_code)]
    fn erroring() -> Self {
        Self {
            should_approve: false,
            should_error: true,
            payment_required_count: AtomicU32::new(0),
            status_calls: tokio::sync::Mutex::new(Vec::new()),
        }
    }
}

#[async_trait::async_trait]
impl X402Treasurer for MockTreasurer {
    async fn on_payment_required(
        &self,
        requirements: &[PaymentRequirements],
        _context: Option<&PaymentContext>,
    ) -> Option<Authorization> {
        self.payment_required_count.fetch_add(1, Ordering::Relaxed);
        if self.should_error {
            // In real code this would be a panic/error — we simulate by returning None
            return None;
        }
        if self.should_approve && !requirements.is_empty() {
            Some(mock_authorization())
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
// MCP Client middleware tests (unit-level, no HTTP)
// ============================================================================

#[cfg(test)]
mod mcp_client_middleware {
    use super::*;
    use ampersend_sdk::mcp::client::X402Middleware;

    fn make_request(method: &str, id: u64) -> JsonRpcRequest {
        JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: serde_json::json!(id),
            method: method.to_string(),
            params: Some(serde_json::json!({"name": "test_tool", "arguments": {}})),
        }
    }

    fn make_402_response(id: u64) -> JsonRpcResponse {
        let x402_data = mock_x402_error_data();
        JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            id: serde_json::json!(id),
            result: None,
            error: Some(JsonRpcError {
                code: 402,
                message: "Payment required".to_string(),
                data: Some(serde_json::to_value(x402_data).unwrap()),
            }),
        }
    }

    fn make_success_response(id: u64) -> JsonRpcResponse {
        JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            id: serde_json::json!(id),
            result: Some(serde_json::json!({
                "content": [{"type": "text", "text": "success"}]
            })),
            error: None,
        }
    }

    fn make_non_402_error_response(id: u64) -> JsonRpcResponse {
        JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            id: serde_json::json!(id),
            result: None,
            error: Some(JsonRpcError {
                code: -32603,
                message: "Internal error".to_string(),
                data: None,
            }),
        }
    }

    #[tokio::test]
    async fn returns_retry_request_with_payment_on_402() {
        let treasurer = MockTreasurer::approving();
        let mut middleware = X402Middleware::new(Box::new(treasurer));

        let request = make_request("tools/call", 1);
        let response = make_402_response(1);

        let result = middleware.on_message(&request, &response).await;

        // Should return a modified request with payment in _meta
        assert!(result.is_some(), "Should return retry request");
        let retry = result.unwrap();
        assert_eq!(retry.method, "tools/call");

        let meta = retry.params.as_ref().unwrap().get("_meta").unwrap();
        assert!(
            meta.get("x402/payment").is_some(),
            "Should have x402/payment in _meta"
        );
        assert!(
            meta.get("ampersend/paymentId").is_some(),
            "Should have paymentId in _meta"
        );
    }

    #[tokio::test]
    async fn returns_none_when_treasurer_declines() {
        let treasurer = MockTreasurer::declining();
        let mut middleware = X402Middleware::new(Box::new(treasurer));

        let request = make_request("tools/call", 1);
        let response = make_402_response(1);

        let result = middleware.on_message(&request, &response).await;

        assert!(result.is_none(), "Should return None when declined");
    }

    #[tokio::test]
    async fn does_not_retry_when_payment_already_present() {
        let treasurer = MockTreasurer::approving();
        let mut middleware = X402Middleware::new(Box::new(treasurer));

        // Request already has payment in _meta
        let request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: serde_json::json!(1),
            method: "tools/call".to_string(),
            params: Some(serde_json::json!({
                "name": "test_tool",
                "_meta": {
                    "x402/payment": mock_payment()
                }
            })),
        };
        let response = make_402_response(1);

        let result = middleware.on_message(&request, &response).await;

        assert!(
            result.is_none(),
            "Should not retry when payment already present"
        );
    }

    #[tokio::test]
    async fn forwards_success_responses_unchanged() {
        let treasurer = MockTreasurer::approving();
        let mut middleware = X402Middleware::new(Box::new(treasurer));

        let request = make_request("tools/call", 1);
        let response = make_success_response(1);

        let result = middleware.on_message(&request, &response).await;

        assert!(result.is_none(), "Should return None for success responses");
    }

    #[tokio::test]
    async fn forwards_non_402_errors_unchanged() {
        let treasurer = MockTreasurer::approving();
        let mut middleware = X402Middleware::new(Box::new(treasurer));

        let request = make_request("tools/call", 1);
        let response = make_non_402_error_response(1);

        let result = middleware.on_message(&request, &response).await;

        assert!(
            result.is_none(),
            "Should return None for non-402 errors"
        );
    }

    #[tokio::test]
    async fn tracks_sending_status_on_approval() {
        let treasurer = Arc::new(MockTreasurer::approving());
        let treasurer_clone: Box<dyn X402Treasurer> = Box::new(ArcTreasurer(treasurer.clone()));
        let mut middleware = X402Middleware::new(treasurer_clone);

        let request = make_request("tools/call", 1);
        let response = make_402_response(1);

        let _ = middleware.on_message(&request, &response).await;

        let statuses = treasurer.status_calls.lock().await;
        assert_eq!(statuses.len(), 1);
        assert_eq!(statuses[0], PaymentStatus::Sending);
    }

    #[tokio::test]
    async fn tracks_accepted_status_on_payment_response() {
        let treasurer = Arc::new(MockTreasurer::approving());
        let treasurer_clone: Box<dyn X402Treasurer> = Box::new(ArcTreasurer(treasurer.clone()));
        let mut middleware = X402Middleware::new(treasurer_clone);

        // Step 1: Get payment retry request
        let request = make_request("tools/call", 1);
        let response_402 = make_402_response(1);
        let retry = middleware.on_message(&request, &response_402).await.unwrap();

        // Step 2: Simulate successful payment response with x402/payment-response in result
        let payment_response = JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            id: retry.id.clone(),
            result: Some(serde_json::json!({
                "content": [{"type": "text", "text": "success"}],
                "_meta": {
                    "x402/payment-response": {
                        "success": true,
                        "txHash": "0xabc123"
                    }
                }
            })),
            error: None,
        };

        let _ = middleware.on_message(&retry, &payment_response).await;

        let statuses = treasurer.status_calls.lock().await;
        assert!(statuses.contains(&PaymentStatus::Sending));
        assert!(statuses.contains(&PaymentStatus::Accepted));
    }

    #[tokio::test]
    async fn tracks_rejected_status_on_failed_payment_response() {
        let treasurer = Arc::new(MockTreasurer::approving());
        let treasurer_clone: Box<dyn X402Treasurer> = Box::new(ArcTreasurer(treasurer.clone()));
        let mut middleware = X402Middleware::new(treasurer_clone);

        // Step 1: Get payment retry request
        let request = make_request("tools/call", 1);
        let response_402 = make_402_response(1);
        let retry = middleware.on_message(&request, &response_402).await.unwrap();

        // Step 2: Simulate rejected payment response
        let payment_response = JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            id: retry.id.clone(),
            result: Some(serde_json::json!({
                "_meta": {
                    "x402/payment-response": {
                        "success": false,
                        "errorReason": "Insufficient funds"
                    }
                }
            })),
            error: None,
        };

        let _ = middleware.on_message(&retry, &payment_response).await;

        let statuses = treasurer.status_calls.lock().await;
        assert!(statuses.contains(&PaymentStatus::Sending));
        assert!(statuses.contains(&PaymentStatus::Rejected));
    }

    #[tokio::test]
    async fn calls_on_payment_required_with_context() {
        let treasurer = Arc::new(MockTreasurer::declining());
        let treasurer_clone: Box<dyn X402Treasurer> = Box::new(ArcTreasurer(treasurer.clone()));
        let mut middleware = X402Middleware::new(treasurer_clone);

        let request = make_request("tools/call", 1);
        let response = make_402_response(1);

        let _ = middleware.on_message(&request, &response).await;

        assert_eq!(
            treasurer.payment_required_count.load(Ordering::Relaxed),
            1
        );
    }

    #[tokio::test]
    async fn does_not_call_on_status_when_declined() {
        let treasurer = Arc::new(MockTreasurer::declining());
        let treasurer_clone: Box<dyn X402Treasurer> = Box::new(ArcTreasurer(treasurer.clone()));
        let mut middleware = X402Middleware::new(treasurer_clone);

        let request = make_request("tools/call", 1);
        let response = make_402_response(1);

        let _ = middleware.on_message(&request, &response).await;

        let statuses = treasurer.status_calls.lock().await;
        assert!(
            statuses.is_empty(),
            "Should not call onStatus when declined"
        );
    }

    /// Wrapper to implement X402Treasurer for Arc<MockTreasurer>.
    struct ArcTreasurer(Arc<MockTreasurer>);

    #[async_trait::async_trait]
    impl X402Treasurer for ArcTreasurer {
        async fn on_payment_required(
            &self,
            requirements: &[PaymentRequirements],
            context: Option<&PaymentContext>,
        ) -> Option<Authorization> {
            self.0.on_payment_required(requirements, context).await
        }

        async fn on_status(
            &self,
            status: PaymentStatus,
            authorization: &Authorization,
            context: Option<&PaymentContext>,
        ) {
            self.0.on_status(status, authorization, context).await;
        }
    }
}
