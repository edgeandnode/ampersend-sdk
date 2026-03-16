use ampersend_sdk::x402::types::*;

#[cfg(test)]
mod types {
    use super::*;

    mod network_conversion {
        use super::*;

        #[test]
        fn base_maps_to_8453() {
            assert_eq!(network_to_chain_id("base"), Some(8453));
        }

        #[test]
        fn base_sepolia_maps_to_84532() {
            assert_eq!(network_to_chain_id("base-sepolia"), Some(84532));
        }

        #[test]
        fn ethereum_maps_to_1() {
            assert_eq!(network_to_chain_id("ethereum"), Some(1));
        }

        #[test]
        fn unknown_returns_none() {
            assert_eq!(network_to_chain_id("unknown"), None);
        }

        #[test]
        fn chain_id_8453_maps_to_base() {
            assert_eq!(chain_id_to_network(8453), Some("base"));
        }

        #[test]
        fn chain_id_84532_maps_to_base_sepolia() {
            assert_eq!(chain_id_to_network(84532), Some("base-sepolia"));
        }

        #[test]
        fn unknown_chain_id_returns_none() {
            assert_eq!(chain_id_to_network(999999), None);
        }
    }

    mod payment_requirements_serde {
        use super::*;

        #[test]
        fn deserializes_from_json() {
            let json = r#"{
                "scheme": "exact",
                "network": "base-sepolia",
                "maxAmountRequired": "1000000",
                "resource": "https://example.com/api",
                "description": "Test payment",
                "mimeType": "application/json",
                "payTo": "0x1234567890123456789012345678901234567890",
                "maxTimeoutSeconds": 300,
                "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
            }"#;

            let req: PaymentRequirements = serde_json::from_str(json).unwrap();
            assert_eq!(req.scheme, "exact");
            assert_eq!(req.network, "base-sepolia");
            assert_eq!(req.max_amount_required, "1000000");
            assert_eq!(req.pay_to, "0x1234567890123456789012345678901234567890");
            assert_eq!(req.max_timeout_seconds, 300);
        }

        #[test]
        fn serializes_to_json() {
            let req = PaymentRequirements {
                scheme: "exact".to_string(),
                network: "base-sepolia".to_string(),
                max_amount_required: "1000000".to_string(),
                resource: "https://example.com".to_string(),
                description: "Test".to_string(),
                mime_type: "application/json".to_string(),
                pay_to: "0x1234567890123456789012345678901234567890".to_string(),
                max_timeout_seconds: 300,
                asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e".to_string(),
                extra: None,
            };

            let json = serde_json::to_value(&req).unwrap();
            assert_eq!(json["scheme"], "exact");
            assert_eq!(json["maxAmountRequired"], "1000000");
            assert_eq!(json["maxTimeoutSeconds"], 300);
        }

        #[test]
        fn roundtrips_with_extra() {
            let req = PaymentRequirements {
                scheme: "exact".to_string(),
                network: "base-sepolia".to_string(),
                max_amount_required: "1000000".to_string(),
                resource: "https://example.com".to_string(),
                description: "Test".to_string(),
                mime_type: "application/json".to_string(),
                pay_to: "0x0000000000000000000000000000000000000000".to_string(),
                max_timeout_seconds: 300,
                asset: "0x0000000000000000000000000000000000000000".to_string(),
                extra: Some(
                    [
                        ("name".to_string(), serde_json::json!("USDC")),
                        ("version".to_string(), serde_json::json!("2")),
                    ]
                    .into_iter()
                    .collect(),
                ),
            };

            let json = serde_json::to_string(&req).unwrap();
            let deserialized: PaymentRequirements = serde_json::from_str(&json).unwrap();
            assert_eq!(deserialized.extra.as_ref().unwrap()["name"], "USDC");
            assert_eq!(deserialized.extra.as_ref().unwrap()["version"], "2");
        }
    }

    mod payment_payload_serde {
        use super::*;

        #[test]
        fn deserializes_from_json() {
            let json = r#"{
                "x402Version": 1,
                "scheme": "exact",
                "network": "base-sepolia",
                "payload": {
                    "signature": "0xabc",
                    "authorization": {
                        "from": "0x1111111111111111111111111111111111111111",
                        "to": "0x2222222222222222222222222222222222222222",
                        "value": "1000000"
                    }
                }
            }"#;

            let payload: PaymentPayload = serde_json::from_str(json).unwrap();
            assert_eq!(payload.x402_version, 1);
            assert_eq!(payload.scheme, "exact");
            assert_eq!(payload.network, "base-sepolia");
            assert_eq!(payload.payload["signature"], "0xabc");
        }

        #[test]
        fn serializes_to_json() {
            let payload = PaymentPayload {
                x402_version: 1,
                scheme: "exact".to_string(),
                network: "base-sepolia".to_string(),
                payload: serde_json::json!({
                    "signature": "0xdef",
                    "authorization": { "from": "0x1", "to": "0x2", "value": "500" }
                }),
            };

            let json = serde_json::to_value(&payload).unwrap();
            assert_eq!(json["x402Version"], 1);
            assert_eq!(json["scheme"], "exact");
        }
    }

    mod payment_status {
        use ampersend_sdk::x402::treasurer::PaymentStatus;

        #[test]
        fn displays_correctly() {
            assert_eq!(PaymentStatus::Sending.to_string(), "sending");
            assert_eq!(PaymentStatus::Accepted.to_string(), "accepted");
            assert_eq!(PaymentStatus::Rejected.to_string(), "rejected");
            assert_eq!(PaymentStatus::Declined.to_string(), "declined");
            assert_eq!(PaymentStatus::Error.to_string(), "error");
        }

        #[test]
        fn serializes_to_json() {
            let json = serde_json::to_value(PaymentStatus::Sending).unwrap();
            assert_eq!(json, "sending");
        }
    }

    mod settle_response {
        use super::*;

        #[test]
        fn deserializes_success() {
            let json = r#"{"success": true, "txHash": "0xabc123"}"#;
            let resp: SettleResponse = serde_json::from_str(json).unwrap();
            assert!(resp.success);
            assert_eq!(resp.tx_hash.unwrap(), "0xabc123");
        }

        #[test]
        fn deserializes_failure() {
            let json = r#"{"success": false, "errorReason": "Insufficient funds"}"#;
            let resp: SettleResponse = serde_json::from_str(json).unwrap();
            assert!(!resp.success);
            assert_eq!(resp.error_reason.unwrap(), "Insufficient funds");
        }
    }
}
