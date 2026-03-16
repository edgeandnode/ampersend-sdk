use ampersend_sdk::mcp::types::*;
use ampersend_sdk::x402::types::PaymentPayload;

#[cfg(test)]
mod json_rpc {
    use super::*;

    #[test]
    fn deserializes_request() {
        let json = r#"{
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": "test_tool", "arguments": {}}
        }"#;

        let req: JsonRpcRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.method, "tools/call");
        assert_eq!(req.id, serde_json::json!(1));
    }

    #[test]
    fn deserializes_success_response() {
        let json = r#"{
            "jsonrpc": "2.0",
            "id": 1,
            "result": {"content": [{"type": "text", "text": "hello"}]}
        }"#;

        let resp: JsonRpcResponse = serde_json::from_str(json).unwrap();
        assert!(resp.result.is_some());
        assert!(resp.error.is_none());
    }

    #[test]
    fn deserializes_error_response() {
        let json = r#"{
            "jsonrpc": "2.0",
            "id": 1,
            "error": {
                "code": 402,
                "message": "Payment required",
                "data": {"x402Version": 1, "accepts": []}
            }
        }"#;

        let resp: JsonRpcResponse = serde_json::from_str(json).unwrap();
        assert!(resp.error.is_some());
        let error = resp.error.unwrap();
        assert_eq!(error.code, 402);
        assert!(is_x402_error(&error));
    }

    #[test]
    fn non_402_error_is_not_x402() {
        let error = JsonRpcError {
            code: 500,
            message: "Internal error".to_string(),
            data: None,
        };
        assert!(!is_x402_error(&error));
    }
}

#[cfg(test)]
mod x402_extensions {
    use super::*;

    #[test]
    fn parses_x402_from_error_data() {
        let error = JsonRpcError {
            code: 402,
            message: "Payment required".to_string(),
            data: Some(serde_json::json!({
                "x402Version": 1,
                "accepts": [{
                    "scheme": "exact",
                    "network": "base-sepolia",
                    "maxAmountRequired": "1000000",
                    "resource": "http://test.com",
                    "description": "Test",
                    "mimeType": "application/json",
                    "payTo": "0x1111111111111111111111111111111111111111",
                    "maxTimeoutSeconds": 300,
                    "asset": "0x2222222222222222222222222222222222222222"
                }]
            })),
        };

        let x402_data = parse_x402_from_error(&error).unwrap();
        assert_eq!(x402_data.x402_version, 1);
        assert_eq!(x402_data.accepts.len(), 1);
        assert_eq!(x402_data.accepts[0].scheme, "exact");
    }

    #[test]
    fn returns_none_for_non_402_error() {
        let error = JsonRpcError {
            code: 500,
            message: "Server error".to_string(),
            data: None,
        };

        assert!(parse_x402_from_error(&error).is_none());
    }

    #[test]
    fn build_params_with_payment_adds_meta() {
        let params = serde_json::json!({
            "name": "test_tool",
            "arguments": {},
            "_meta": {}
        });

        let payment = PaymentPayload {
            x402_version: 1,
            scheme: "exact".to_string(),
            network: "base-sepolia".to_string(),
            payload: serde_json::json!({"mock": true}),
        };

        let result = build_params_with_payment(&params, &payment, "payment-123");

        let meta = &result["_meta"];
        assert!(meta.get("x402/payment").is_some());
        assert_eq!(meta["ampersend/paymentId"], "payment-123");
    }

    #[test]
    fn payment_from_request_extracts_payment() {
        let params = serde_json::json!({
            "name": "test_tool",
            "_meta": {
                "x402/payment": {
                    "x402Version": 1,
                    "scheme": "exact",
                    "network": "base-sepolia",
                    "payload": {}
                },
                "ampersend/paymentId": "pay-456"
            }
        });

        let (payment, payment_id) = payment_from_request(&params);
        assert!(payment.is_some());
        assert_eq!(payment.unwrap().scheme, "exact");
        assert_eq!(payment_id.unwrap(), "pay-456");
    }

    #[test]
    fn payment_from_request_returns_none_when_no_meta() {
        let params = serde_json::json!({
            "name": "test_tool"
        });

        let (payment, payment_id) = payment_from_request(&params);
        assert!(payment.is_none());
        assert!(payment_id.is_none());
    }
}
