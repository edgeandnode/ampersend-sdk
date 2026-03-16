use std::time::Duration;

use alloy_primitives::FixedBytes;
use alloy_signer_local::PrivateKeySigner;
use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::error::ApiError;

const DEFAULT_API_URL: &str = "https://api.ampersend.ai";

// ============ Response Types ============

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInitData {
    #[serde(default)]
    pub address: Option<String>,
    #[serde(default)]
    pub factory: Option<String>,
    #[serde(default)]
    pub factory_data: Option<String>,
    #[serde(default)]
    pub intent_executor_installed: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentResponse {
    pub address: String,
    pub name: String,
    pub user_id: String,
    pub balance: String,
    pub init_data: AgentInitData,
    pub nonce: String,
    pub created_at: u64,
    pub updated_at: u64,
}

// ============ Request Types ============

/// Spend configuration for agent creation.
#[derive(Debug, Clone)]
pub struct SpendConfig {
    pub auto_topup_allowed: Option<bool>,
    pub daily_limit: Option<u128>,
    pub monthly_limit: Option<u128>,
    pub per_transaction_limit: Option<u128>,
}

/// Options for creating an agent.
#[derive(Debug, Clone)]
pub struct CreateAgentOptions {
    pub name: String,
    /// Hex-encoded private key (with 0x prefix)
    pub private_key: String,
    pub spend_config: Option<SpendConfig>,
    pub authorized_sellers: Option<Vec<String>>,
}

#[derive(Serialize)]
struct CreateAgentPayload {
    agent_key_address: String,
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    spend_config: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    authorized_sellers: Option<Vec<String>>,
}

/// Client for managing agents via API key authentication.
///
/// The private key is used only locally to derive the agent key address;
/// it is never sent to the server.
pub struct AmpersendManagementClient {
    api_key: String,
    base_url: String,
    timeout: Duration,
    http: Client,
}

impl AmpersendManagementClient {
    pub fn new(api_key: String, api_url: Option<String>, timeout_ms: Option<u64>) -> Self {
        let base_url = api_url
            .unwrap_or_else(|| DEFAULT_API_URL.to_string())
            .trim_end_matches('/')
            .to_string();
        let timeout = Duration::from_millis(timeout_ms.unwrap_or(30000));
        let http = Client::builder()
            .timeout(timeout)
            .build()
            .expect("Failed to create HTTP client");

        Self {
            api_key,
            base_url,
            timeout,
            http,
        }
    }

    /// Create and deploy a new agent on-chain.
    pub async fn create_agent(
        &self,
        options: CreateAgentOptions,
    ) -> Result<AgentResponse, ApiError> {
        let key = options
            .private_key
            .strip_prefix("0x")
            .unwrap_or(&options.private_key);
        let key_bytes: FixedBytes<32> = key
            .parse()
            .map_err(|e| ApiError::Auth(format!("Invalid private key: {e}")))?;
        let signer = PrivateKeySigner::from_bytes(&key_bytes)
            .map_err(|e| ApiError::Auth(format!("Invalid private key: {e}")))?;
        let agent_key_address = format!("{}", signer.address());

        let spend_config_json = options.spend_config.map(|sc| {
            serde_json::json!({
                "auto_topup_allowed": sc.auto_topup_allowed.unwrap_or(false),
                "daily_limit": sc.daily_limit.map(|v| v.to_string()),
                "monthly_limit": sc.monthly_limit.map(|v| v.to_string()),
                "per_transaction_limit": sc.per_transaction_limit.map(|v| v.to_string()),
            })
        });

        let payload = CreateAgentPayload {
            agent_key_address,
            name: options.name,
            spend_config: spend_config_json,
            authorized_sellers: options.authorized_sellers,
        };

        self.fetch_json("POST", "/api/v1/sdk/agents", Some(&payload))
            .await
    }

    /// List all agents belonging to the authenticated user.
    pub async fn list_agents(&self) -> Result<Vec<AgentResponse>, ApiError> {
        #[derive(Deserialize)]
        struct PaginatedResponse {
            items: Vec<AgentResponse>,
        }

        let resp: PaginatedResponse = self
            .fetch_json("GET", "/api/v1/sdk/agents", None::<&()>)
            .await?;
        Ok(resp.items)
    }

    async fn fetch_json<T: serde::de::DeserializeOwned>(
        &self,
        method: &str,
        path: &str,
        body: Option<&(impl Serialize + ?Sized)>,
    ) -> Result<T, ApiError> {
        let url = format!("{}{}", self.base_url, path);

        let mut request = match method {
            "GET" => self.http.get(&url),
            "POST" => self.http.post(&url),
            "PUT" => self.http.put(&url),
            "DELETE" => self.http.delete(&url),
            _ => return Err(ApiError::Request(format!("Unsupported method: {method}"))),
        };

        request = request.header("Authorization", format!("Bearer {}", self.api_key));

        if let Some(body) = body {
            request = request
                .header("Content-Type", "application/json")
                .json(body);
        }

        let response = request.send().await.map_err(|e| {
            if e.is_timeout() {
                ApiError::Timeout(self.timeout.as_millis() as u64)
            } else {
                ApiError::Request(e.to_string())
            }
        })?;

        if !response.status().is_success() {
            let status = response.status().as_u16();
            let body = response.text().await.unwrap_or_default();
            return Err(ApiError::Http {
                status,
                message: body,
            });
        }

        response
            .json::<T>()
            .await
            .map_err(|e| ApiError::Validation(e.to_string()))
    }
}
