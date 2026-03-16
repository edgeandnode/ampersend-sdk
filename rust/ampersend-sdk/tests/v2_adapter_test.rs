use ampersend_sdk::http::{
    caip2_to_v1_network, v1_network_to_caip2, v1_payload_to_v2, v2_requirements_to_v1,
    V2PaymentContext, V2PaymentRequirements, V2Resource,
};
use ampersend_sdk::x402::types::PaymentPayload;

#[cfg(test)]
mod v2_adapter {
    use super::*;

    mod v1_network_to_caip2_tests {
        use super::*;

        #[test]
        fn converts_base_sepolia() {
            assert_eq!(v1_network_to_caip2("base-sepolia").unwrap(), "eip155:84532");
        }

        #[test]
        fn converts_base() {
            assert_eq!(v1_network_to_caip2("base").unwrap(), "eip155:8453");
        }

        #[test]
        fn throws_for_unknown_network() {
            let result = v1_network_to_caip2("unknown-network");
            assert!(result.is_err());
            assert!(result.unwrap_err().contains("Unknown v1 network"));
        }
    }

    mod parse_caip2_chain_id_tests {
        use ampersend_sdk::http::v2_adapter::parse_caip2_chain_id;

        #[test]
        fn extracts_chain_id_from_caip2() {
            assert_eq!(parse_caip2_chain_id("eip155:8453").unwrap(), 8453);
            assert_eq!(parse_caip2_chain_id("eip155:84532").unwrap(), 84532);
        }

        #[test]
        fn handles_plain_chain_id_string() {
            assert_eq!(parse_caip2_chain_id("8453").unwrap(), 8453);
        }
    }

    mod caip2_to_v1_network_tests {
        use super::*;

        #[test]
        fn converts_eip155_84532_to_base_sepolia() {
            assert_eq!(caip2_to_v1_network("eip155:84532").unwrap(), "base-sepolia");
        }

        #[test]
        fn converts_eip155_8453_to_base() {
            assert_eq!(caip2_to_v1_network("eip155:8453").unwrap(), "base");
        }

        #[test]
        fn throws_for_unknown_chain_id() {
            let result = caip2_to_v1_network("eip155:999999");
            assert!(result.is_err());
            assert!(result.unwrap_err().contains("Unknown chain ID"));
        }
    }

    mod v2_requirements_to_v1_tests {
        use super::*;

        fn test_v2_requirements() -> V2PaymentRequirements {
            V2PaymentRequirements {
                scheme: "exact".to_string(),
                network: "eip155:84532".to_string(),
                amount: "1000000".to_string(),
                asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e".to_string(),
                pay_to: "0x1234567890123456789012345678901234567890".to_string(),
                max_timeout_seconds: Some(300),
                extra: Some(serde_json::json!({ "customField": "value" })),
            }
        }

        fn test_v2_resource() -> V2Resource {
            V2Resource {
                url: "https://api.example.com/resource".to_string(),
                description: Some("Test resource".to_string()),
                mime_type: Some("application/json".to_string()),
            }
        }

        #[test]
        fn converts_network_from_caip2_to_v1() {
            let v1 = v2_requirements_to_v1(&test_v2_requirements(), &test_v2_resource()).unwrap();
            assert_eq!(v1.network, "base-sepolia");
        }

        #[test]
        fn maps_amount_to_max_amount_required() {
            let v1 = v2_requirements_to_v1(&test_v2_requirements(), &test_v2_resource()).unwrap();
            assert_eq!(v1.max_amount_required, "1000000");
        }

        #[test]
        fn extracts_resource_url_from_resource_object() {
            let v1 = v2_requirements_to_v1(&test_v2_requirements(), &test_v2_resource()).unwrap();
            assert_eq!(v1.resource, "https://api.example.com/resource");
        }

        #[test]
        fn uses_description_from_resource() {
            let v1 = v2_requirements_to_v1(&test_v2_requirements(), &test_v2_resource()).unwrap();
            assert_eq!(v1.description, "Test resource");
        }

        #[test]
        fn preserves_extra_fields() {
            let v1 = v2_requirements_to_v1(&test_v2_requirements(), &test_v2_resource()).unwrap();
            let extra = v1.extra.unwrap();
            assert_eq!(extra.get("customField").unwrap().as_str().unwrap(), "value");
        }

        #[test]
        fn uses_default_timeout_when_not_specified() {
            let mut req = test_v2_requirements();
            req.max_timeout_seconds = None;
            let v1 = v2_requirements_to_v1(&req, &test_v2_resource()).unwrap();
            assert_eq!(v1.max_timeout_seconds, 300);
        }
    }

    mod v1_payload_to_v2_tests {
        use super::*;

        fn test_v1_payload() -> PaymentPayload {
            PaymentPayload {
                x402_version: 1,
                scheme: "exact".to_string(),
                network: "base-sepolia".to_string(),
                payload: serde_json::json!({
                    "signature": "0xmocksignature",
                    "authorization": {
                        "from": "0xfrom",
                        "to": "0xto",
                        "value": "1000000",
                    }
                }),
            }
        }

        fn test_v2_context() -> V2PaymentContext {
            V2PaymentContext {
                resource: V2Resource {
                    url: "https://api.example.com/resource".to_string(),
                    description: Some("Test resource".to_string()),
                    mime_type: Some("application/json".to_string()),
                },
                original_requirements: V2PaymentRequirements {
                    scheme: "exact".to_string(),
                    network: "eip155:84532".to_string(),
                    amount: "1000000".to_string(),
                    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e".to_string(),
                    pay_to: "0x1234567890123456789012345678901234567890".to_string(),
                    max_timeout_seconds: Some(300),
                    extra: Some(serde_json::json!({})),
                },
            }
        }

        #[test]
        fn sets_x402_version_to_2() {
            let v2 = v1_payload_to_v2(&test_v1_payload(), &test_v2_context());
            assert_eq!(v2.x402_version, 2);
        }

        #[test]
        fn includes_resource_from_context() {
            let ctx = test_v2_context();
            let v2 = v1_payload_to_v2(&test_v1_payload(), &ctx);
            assert_eq!(v2.resource.url, ctx.resource.url);
        }

        #[test]
        fn includes_accepted_from_context() {
            let ctx = test_v2_context();
            let v2 = v1_payload_to_v2(&test_v1_payload(), &ctx);
            assert_eq!(v2.accepted.scheme, ctx.original_requirements.scheme);
            assert_eq!(v2.accepted.network, ctx.original_requirements.network);
        }

        #[test]
        fn preserves_payload_from_v1() {
            let v1 = test_v1_payload();
            let v2 = v1_payload_to_v2(&v1, &test_v2_context());
            assert_eq!(v2.payload, v1.payload);
        }
    }
}
