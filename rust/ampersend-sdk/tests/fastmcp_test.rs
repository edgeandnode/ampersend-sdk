use ampersend_sdk::mcp::server::fastmcp::{
    execute_with_x402_payment, ExecuteContext, PaymentCheckContext, ToolResult,
    WithX402PaymentOptions,
};
use ampersend_sdk::x402::types::{PaymentPayload, PaymentRequirements, SettleResponse};

fn test_requirements() -> PaymentRequirements {
    PaymentRequirements {
        scheme: "exact".to_string(),
        network: "base-sepolia".to_string(),
        max_amount_required: "0.001".to_string(),
        resource: "test-operation".to_string(),
        description: "test".to_string(),
        mime_type: "application/json".to_string(),
        pay_to: "0x0000000000000000000000000000000000000000".to_string(),
        max_timeout_seconds: 300,
        asset: "USDC".to_string(),
        extra: None,
    }
}

fn stub_payment_payload() -> PaymentPayload {
    PaymentPayload {
        x402_version: 1,
        scheme: "exact".to_string(),
        network: "base-sepolia".to_string(),
        payload: serde_json::json!({
            "signature": "0x2d6a7588d6acca505cbf0d9a4a227e0c52c6c34008c8e8986a1283259764173608a2ce6496642e377d6da8dbbf5836e9bd15092f9ecab05ded3d6293af148b571c",
            "authorization": {
                "from": "0x857b06519E91e3A54538791bDbb0E22373e36b66",
                "to": "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
                "value": "10000",
                "validAfter": "0",
                "validBefore": "99999999999999999999999999999999",
                "nonce": "0xf3746613c2d920b5fdabc0856f2aeb2d4f88ee6037b8cc5d04a71a4462f13480"
            }
        }),
    }
}

#[cfg(test)]
mod fastmcp_middleware {
    use super::*;

    #[tokio::test]
    async fn returns_402_error_when_no_payment_provided() {
        let reqs = test_requirements();
        let reqs_clone = reqs.clone();

        let options = WithX402PaymentOptions {
            on_execute: Box::new(move |_ctx: ExecuteContext| {
                let r = reqs_clone.clone();
                Box::pin(async move { Some(r) })
            }),
            on_payment: Box::new(|_ctx: PaymentCheckContext| Box::pin(async { Ok(None) })),
        };

        let result = execute_with_x402_payment(
            &options,
            serde_json::json!({}),
            None, // no payment in meta
            |_args| async {
                Ok(ToolResult {
                    content: vec![serde_json::json!({"type": "text", "text": "ok"})],
                    meta: None,
                })
            },
        )
        .await;

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.data.code, 402);
        assert_eq!(err.data.x402_version, 1);
        assert!(!err.data.accepts.is_empty());
        assert_eq!(err.data.accepts[0].scheme, "exact");
    }

    #[tokio::test]
    async fn returns_402_error_when_payment_validation_fails() {
        let reqs = test_requirements();
        let reqs_clone = reqs.clone();

        let options = WithX402PaymentOptions {
            on_execute: Box::new(move |_ctx: ExecuteContext| {
                let r = reqs_clone.clone();
                Box::pin(async move { Some(r) })
            }),
            on_payment: Box::new(|_ctx: PaymentCheckContext| {
                Box::pin(async { Err("This tool will always throw".to_string()) })
            }),
        };

        let payment = stub_payment_payload();
        let meta = serde_json::json!({
            "x402/payment": payment,
        });

        let result = execute_with_x402_payment(
            &options,
            serde_json::json!({}),
            Some(&meta),
            |_args| async {
                Ok(ToolResult {
                    content: vec![],
                    meta: None,
                })
            },
        )
        .await;

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.data.code, 402);
        assert_eq!(
            err.data.error.as_deref(),
            Some("This tool will always throw")
        );
    }

    #[tokio::test]
    async fn returns_success_with_settlement_when_payment_valid() {
        let reqs = test_requirements();
        let reqs_clone = reqs.clone();

        let settle_response = SettleResponse {
            success: true,
            tx_hash: Some("0xsettletransactionhash".to_string()),
            error_reason: None,
        };
        let settle_clone = settle_response.clone();

        let options = WithX402PaymentOptions {
            on_execute: Box::new(move |_ctx: ExecuteContext| {
                let r = reqs_clone.clone();
                Box::pin(async move { Some(r) })
            }),
            on_payment: Box::new(move |_ctx: PaymentCheckContext| {
                let s = settle_clone.clone();
                Box::pin(async move { Ok(Some(s)) })
            }),
        };

        let payment = stub_payment_payload();
        let meta = serde_json::json!({
            "x402/payment": payment,
        });

        let result = execute_with_x402_payment(
            &options,
            serde_json::json!({}),
            Some(&meta),
            |_args| async {
                Ok(ToolResult {
                    content: vec![serde_json::json!({"type": "text", "text": "success"})],
                    meta: None,
                })
            },
        )
        .await;

        assert!(result.is_ok());
        let tool_result = result.unwrap();
        assert_eq!(tool_result.content.len(), 1);
        assert_eq!(tool_result.content[0]["text"], "success");

        // Verify settlement response in _meta
        let meta = tool_result.meta.unwrap();
        let payment_response = &meta["x402/payment-response"];
        assert_eq!(payment_response["success"], true);
        assert_eq!(payment_response["txHash"], "0xsettletransactionhash");
    }

    #[tokio::test]
    async fn executes_normally_when_no_payment_required() {
        let options = WithX402PaymentOptions {
            on_execute: Box::new(|_ctx: ExecuteContext| {
                Box::pin(async { None }) // no payment required
            }),
            on_payment: Box::new(|_ctx: PaymentCheckContext| Box::pin(async { Ok(None) })),
        };

        let result = execute_with_x402_payment(
            &options,
            serde_json::json!({"key": "value"}),
            None,
            |_args| async {
                Ok(ToolResult {
                    content: vec![serde_json::json!({"type": "text", "text": "free result"})],
                    meta: None,
                })
            },
        )
        .await;

        assert!(result.is_ok());
        let tool_result = result.unwrap();
        assert_eq!(tool_result.content[0]["text"], "free result");
    }
}
