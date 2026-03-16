use serde::{Deserialize, Serialize};

use crate::x402::types::PaymentRequirements;

// ============ SIWE Authentication ============

#[derive(Debug, Deserialize)]
pub struct SiweNonceResponse {
    pub nonce: String,
    #[serde(rename = "sessionId")]
    pub session_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SiweLoginRequest {
    pub signature: String,
    pub message: String,
    pub session_id: String,
    pub agent_address: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SiweLoginResponse {
    pub token: String,
    pub agent_address: String,
    pub expires_at: String,
}

// ============ Agent Payment Authorization ============

#[derive(Debug, Serialize)]
pub struct AgentPaymentAuthRequest {
    pub requirements: Vec<PaymentRequirements>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<AuthRequestContext>,
}

#[derive(Debug, Serialize, Clone)]
pub struct AuthRequestContext {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct AgentPaymentAuthResponse {
    pub authorized: AuthorizedPayments,
    pub rejected: Vec<RejectedPayment>,
}

#[derive(Debug, Deserialize)]
pub struct AuthorizedPayments {
    pub recommended: Option<usize>,
    pub requirements: Vec<AuthorizedRequirement>,
}

#[derive(Debug, Deserialize)]
pub struct AuthorizedRequirement {
    pub requirement: PaymentRequirements,
    pub limits: SpendLimits,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpendLimits {
    pub daily_remaining: String,
    pub monthly_remaining: String,
}

#[derive(Debug, Deserialize)]
pub struct RejectedPayment {
    pub requirement: PaymentRequirements,
    pub reason: String,
}

// ============ Payment Events ============

#[derive(Debug, Serialize)]
#[serde(tag = "type")]
#[serde(rename_all = "lowercase")]
pub enum PaymentEventType {
    Sending,
    Accepted,
    Rejected { reason: String },
    Error { reason: String },
}

#[derive(Debug, Serialize)]
pub struct AgentPaymentEventReport {
    pub id: String,
    pub payment: crate::x402::types::PaymentPayload,
    pub event: PaymentEventType,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPaymentEventResponse {
    pub received: bool,
    #[serde(default)]
    pub payment_id: Option<String>,
}

// ============ SDK-specific types ============

/// Options for the API client.
#[derive(Debug, Clone)]
pub struct ApiClientOptions {
    pub base_url: String,
    pub session_key_private_key: Option<String>,
    pub agent_address: String,
    pub timeout_ms: u64,
}

/// Internal authentication state.
#[derive(Default)]
pub(crate) struct AuthenticationState {
    pub token: Option<String>,
    pub expires_at: Option<chrono::DateTime<chrono::Utc>>,
}
