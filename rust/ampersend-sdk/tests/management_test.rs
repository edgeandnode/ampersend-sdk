use ampersend_sdk::ampersend::management::{
    AmpersendManagementClient, CreateAgentOptions, SpendConfig,
};

// Deterministic test key (same as TypeScript tests: 0xab repeated 32 times)
const TEST_PRIVATE_KEY: &str = "0xabababababababababababababababababababababababababababababababab";

#[cfg(test)]
mod management_client {
    use super::*;
    use wiremock::matchers::{header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn mock_agent_response() -> serde_json::Value {
        serde_json::json!({
            "address": "0x1111111111111111111111111111111111111111",
            "name": "test-agent",
            "userId": "user-123",
            "balance": "0",
            "initData": {},
            "nonce": "12345",
            "createdAt": 1700000000000u64,
            "updatedAt": 1700000000000u64
        })
    }

    #[tokio::test]
    async fn create_agent_calls_endpoint_with_agent_key_address() {
        let mock_server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/api/v1/sdk/agents"))
            .and(header("Authorization", "Bearer sk_test_123"))
            .respond_with(ResponseTemplate::new(200).set_body_json(mock_agent_response()))
            .expect(1)
            .mount(&mock_server)
            .await;

        let client = AmpersendManagementClient::new(
            "sk_test_123".to_string(),
            Some(mock_server.uri()),
            None,
        );

        let result = client
            .create_agent(CreateAgentOptions {
                name: "test-agent".to_string(),
                private_key: TEST_PRIVATE_KEY.to_string(),
                spend_config: None,
                authorized_sellers: None,
            })
            .await
            .unwrap();

        assert_eq!(result.address, "0x1111111111111111111111111111111111111111");
        assert_eq!(result.name, "test-agent");
    }

    #[tokio::test]
    async fn create_agent_passes_spend_config_and_authorized_sellers() {
        let mock_server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/api/v1/sdk/agents"))
            .respond_with(ResponseTemplate::new(200).set_body_json(mock_agent_response()))
            .expect(1)
            .mount(&mock_server)
            .await;

        let client = AmpersendManagementClient::new(
            "sk_test_123".to_string(),
            Some(mock_server.uri()),
            None,
        );

        let result = client
            .create_agent(CreateAgentOptions {
                name: "test-agent".to_string(),
                private_key: TEST_PRIVATE_KEY.to_string(),
                spend_config: Some(SpendConfig {
                    daily_limit: Some(1000000),
                    per_transaction_limit: Some(50000),
                    monthly_limit: None,
                    auto_topup_allowed: None,
                }),
                authorized_sellers: Some(vec![
                    "0x3333333333333333333333333333333333333333".to_string()
                ]),
            })
            .await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn list_agents_returns_paginated_list() {
        let mock_server = MockServer::start().await;

        let paginated = serde_json::json!({
            "items": [
                mock_agent_response(),
                {
                    "address": "0x2222222222222222222222222222222222222222",
                    "name": "agent-2",
                    "userId": "user-123",
                    "balance": "0",
                    "initData": {},
                    "nonce": "12346",
                    "createdAt": 1700000000000u64,
                    "updatedAt": 1700000000000u64
                }
            ],
            "total": 2,
            "limit": 50,
            "offset": 0
        });

        Mock::given(method("GET"))
            .and(path("/api/v1/sdk/agents"))
            .and(header("Authorization", "Bearer sk_test_123"))
            .respond_with(ResponseTemplate::new(200).set_body_json(paginated))
            .expect(1)
            .mount(&mock_server)
            .await;

        let client = AmpersendManagementClient::new(
            "sk_test_123".to_string(),
            Some(mock_server.uri()),
            None,
        );

        let agents = client.list_agents().await.unwrap();

        assert_eq!(agents.len(), 2);
        assert_eq!(agents[0].name, "test-agent");
        assert_eq!(agents[1].name, "agent-2");
    }

    #[tokio::test]
    async fn throws_on_http_error() {
        let mock_server = MockServer::start().await;

        Mock::given(method("GET"))
            .and(path("/api/v1/sdk/agents"))
            .respond_with(ResponseTemplate::new(401).set_body_string("Unauthorized"))
            .expect(1)
            .mount(&mock_server)
            .await;

        let client =
            AmpersendManagementClient::new("bad_key".to_string(), Some(mock_server.uri()), None);

        let result = client.list_agents().await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.to_string().contains("401"));
    }
}
