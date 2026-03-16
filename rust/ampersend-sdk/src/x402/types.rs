use std::collections::HashMap;

use serde::{Deserialize, Serialize};

/// Payment scheme type.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Scheme {
    Exact,
    Deferred,
}

impl std::fmt::Display for Scheme {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Scheme::Exact => write!(f, "exact"),
            Scheme::Deferred => write!(f, "deferred"),
        }
    }
}

/// Payment requirements from an x402 server.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentRequirements {
    /// Payment scheme (e.g., "exact")
    pub scheme: String,
    /// Blockchain network identifier
    pub network: String,
    /// Maximum payment amount in atomic units (wei)
    pub max_amount_required: String,
    /// Resource identifier for the payment
    pub resource: String,
    /// Human-readable payment description
    pub description: String,
    /// MIME type of the resource
    pub mime_type: String,
    /// Seller address to receive payment
    pub pay_to: String,
    /// Maximum timeout for payment completion
    pub max_timeout_seconds: u64,
    /// Token contract address (e.g., USDC)
    pub asset: String,
    /// Additional payment metadata
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extra: Option<HashMap<String, serde_json::Value>>,
}

/// ERC-3009 authorization details within an exact payment payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExactEvmAuthorization {
    pub from: String,
    pub to: String,
    pub value: String,
    pub valid_after: String,
    pub valid_before: String,
    pub nonce: String,
}

/// Exact EVM payment payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExactEvmPayload {
    pub signature: String,
    pub authorization: ExactEvmAuthorization,
}

/// x402 payment payload ready for submission.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentPayload {
    /// x402 protocol version
    pub x402_version: u32,
    /// Payment scheme (exact/deferred)
    pub scheme: String,
    /// Blockchain network
    pub network: String,
    /// Scheme-specific payload
    pub payload: serde_json::Value,
}

/// Settlement response from a server after processing payment.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettleResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tx_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_reason: Option<String>,
}

/// x402 response structure (from 402 errors).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct X402Response {
    pub x402_version: u32,
    pub accepts: Vec<PaymentRequirements>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Network name to chain ID mapping.
pub fn network_to_chain_id(network: &str) -> Option<u64> {
    match network {
        "base" => Some(8453),
        "base-sepolia" => Some(84532),
        "ethereum" | "mainnet" => Some(1),
        "sepolia" => Some(11155111),
        "optimism" => Some(10),
        "optimism-sepolia" => Some(11155420),
        "arbitrum" => Some(42161),
        "arbitrum-sepolia" => Some(421614),
        "polygon" => Some(137),
        _ => None,
    }
}

/// Chain ID to network name mapping.
pub fn chain_id_to_network(chain_id: u64) -> Option<&'static str> {
    match chain_id {
        8453 => Some("base"),
        84532 => Some("base-sepolia"),
        1 => Some("ethereum"),
        11155111 => Some("sepolia"),
        10 => Some("optimism"),
        11155420 => Some("optimism-sepolia"),
        42161 => Some("arbitrum"),
        421614 => Some("arbitrum-sepolia"),
        137 => Some("polygon"),
        _ => None,
    }
}
