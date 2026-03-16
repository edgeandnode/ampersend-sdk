//! v2 ↔ v1 protocol adapter for x402.
//!
//! The x402 v2 protocol uses CAIP-2 network identifiers, a different field
//! layout (amount vs maxAmountRequired), and the same underlying ERC-3009
//! signatures. Internally the SDK speaks v1 everywhere (treasurer, wallet,
//! types), so this module converts at the protocol boundary.

use serde::{Deserialize, Serialize};

use crate::x402::types::{
    chain_id_to_network, network_to_chain_id, PaymentPayload, PaymentRequirements,
};

const DEFAULT_MAX_TIMEOUT_SECONDS: u64 = 300;

// ============ v2 Types ============

/// v2 payment requirements (CAIP-2 format).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct V2PaymentRequirements {
    pub scheme: String,
    /// CAIP-2 network (e.g., "eip155:84532")
    pub network: String,
    /// Payment amount in atomic units
    pub amount: String,
    pub pay_to: String,
    pub asset: String,
    #[serde(default)]
    pub max_timeout_seconds: Option<u64>,
    #[serde(default)]
    pub extra: Option<serde_json::Value>,
}

/// v2 resource descriptor.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct V2Resource {
    pub url: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default, rename = "mimeType")]
    pub mime_type: Option<String>,
}

/// v2 payment required envelope.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct V2PaymentRequired {
    pub resource: V2Resource,
    pub accepted: Vec<V2PaymentRequirements>,
}

/// v2 payment payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct V2PaymentPayload {
    pub x402_version: u32,
    pub resource: V2Resource,
    pub accepted: V2PaymentRequirements,
    pub payload: serde_json::Value,
}

/// Original v2 data preserved for building the outbound payment.
#[derive(Debug, Clone)]
pub struct V2PaymentContext {
    pub resource: V2Resource,
    pub original_requirements: V2PaymentRequirements,
}

// ============ Network Conversion ============

/// Convert a v1 network name to CAIP-2 format.
///
/// ```
/// # use ampersend_sdk::http::v2_adapter::v1_network_to_caip2;
/// assert_eq!(v1_network_to_caip2("base-sepolia").unwrap(), "eip155:84532");
/// assert_eq!(v1_network_to_caip2("base").unwrap(), "eip155:8453");
/// ```
pub fn v1_network_to_caip2(network: &str) -> Result<String, String> {
    let chain_id =
        network_to_chain_id(network).ok_or_else(|| format!("Unknown v1 network: {network}"))?;
    Ok(format!("eip155:{chain_id}"))
}

/// Extract chain ID from a CAIP-2 identifier.
pub fn parse_caip2_chain_id(network: &str) -> Result<u64, String> {
    let parts: Vec<&str> = network.split(':').collect();
    let chain_id_str = if parts.len() > 1 { parts[1] } else { parts[0] };
    chain_id_str
        .parse()
        .map_err(|_| format!("Invalid chain ID in CAIP-2: {network}"))
}

/// Convert a CAIP-2 network identifier to v1 network name.
pub fn caip2_to_v1_network(network: &str) -> Result<String, String> {
    let chain_id = parse_caip2_chain_id(network)?;
    chain_id_to_network(chain_id)
        .map(|n| n.to_string())
        .ok_or_else(|| format!("Unknown chain ID: {chain_id}"))
}

// ============ Inbound: v2 → v1 Conversion ============

/// Convert v2 PaymentRequirements to v1 format.
pub fn v2_requirements_to_v1(
    v2_req: &V2PaymentRequirements,
    resource: &V2Resource,
) -> Result<PaymentRequirements, String> {
    let v1_network = caip2_to_v1_network(&v2_req.network)?;

    Ok(PaymentRequirements {
        scheme: v2_req.scheme.clone(),
        network: v1_network,
        max_amount_required: v2_req.amount.clone(),
        resource: resource.url.clone(),
        description: resource
            .description
            .clone()
            .unwrap_or_else(|| resource.url.clone()),
        mime_type: resource.mime_type.clone().unwrap_or_default(),
        pay_to: v2_req.pay_to.clone(),
        max_timeout_seconds: v2_req
            .max_timeout_seconds
            .unwrap_or(DEFAULT_MAX_TIMEOUT_SECONDS),
        asset: v2_req.asset.clone(),
        extra: v2_req.extra.as_ref().and_then(|e| {
            if let serde_json::Value::Object(map) = e {
                Some(map.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
            } else {
                None
            }
        }),
    })
}

// ============ Outbound: v1 → v2 Conversion ============

/// Build a v2 PaymentPayload from a v1 payment payload.
pub fn v1_payload_to_v2(
    v1_payload: &PaymentPayload,
    context: &V2PaymentContext,
) -> V2PaymentPayload {
    V2PaymentPayload {
        x402_version: 2,
        resource: context.resource.clone(),
        accepted: context.original_requirements.clone(),
        payload: v1_payload.payload.clone(),
    }
}

/// Detect if requirements are v2 format (has 'amount' field instead of 'maxAmountRequired').
pub fn is_v2_requirements(value: &serde_json::Value) -> bool {
    value.get("amount").is_some() && value.get("maxAmountRequired").is_none()
}
