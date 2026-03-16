//! JSON-RPC and MCP protocol types.
//!
//! Defines the core JSON-RPC message types used by the MCP protocol,
//! along with x402 payment extensions.

use serde::{Deserialize, Serialize};

use crate::x402::types::{PaymentPayload, PaymentRequirements, SettleResponse};

// ============ JSON-RPC Core Types ============

/// JSON-RPC request message.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub id: serde_json::Value,
    pub method: String,
    #[serde(default)]
    pub params: Option<serde_json::Value>,
}

/// JSON-RPC success response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    pub id: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
}

/// JSON-RPC error object.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcError {
    pub code: i32,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

/// A JSON-RPC message (either request or response).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum JsonRpcMessage {
    Request(JsonRpcRequest),
    Response(JsonRpcResponse),
}

impl JsonRpcMessage {
    pub fn is_request(&self) -> bool {
        matches!(self, JsonRpcMessage::Request(_))
    }

    pub fn is_response(&self) -> bool {
        matches!(self, JsonRpcMessage::Response(_))
    }

    pub fn as_request(&self) -> Option<&JsonRpcRequest> {
        match self {
            JsonRpcMessage::Request(r) => Some(r),
            _ => None,
        }
    }

    pub fn as_response(&self) -> Option<&JsonRpcResponse> {
        match self {
            JsonRpcMessage::Response(r) => Some(r),
            _ => None,
        }
    }

    pub fn id(&self) -> Option<&serde_json::Value> {
        match self {
            JsonRpcMessage::Request(r) => Some(&r.id),
            JsonRpcMessage::Response(r) => Some(&r.id),
        }
    }
}

// ============ MCP-specific Types ============

/// MCP client/server implementation info.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Implementation {
    pub name: String,
    pub version: String,
}

/// MCP tool call request parameters.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CallToolParams {
    pub name: String,
    #[serde(default)]
    pub arguments: serde_json::Value,
    #[serde(default, rename = "_meta")]
    pub meta: Option<serde_json::Value>,
}

/// MCP tool call result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CallToolResult {
    #[serde(default)]
    pub content: Vec<ContentItem>,
    #[serde(default, rename = "_meta")]
    pub meta: Option<serde_json::Value>,
    #[serde(default, rename = "isError")]
    pub is_error: Option<bool>,
}

/// Content item in a tool result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ContentItem {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "image")]
    Image { data: String, mime_type: String },
    #[serde(rename = "resource")]
    Resource { resource: serde_json::Value },
}

/// MCP resource read request parameters.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadResourceParams {
    pub uri: String,
    #[serde(default, rename = "_meta")]
    pub meta: Option<serde_json::Value>,
}

// ============ x402 MCP Extensions ============

/// x402 payment response in MCP _meta.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpX402PaymentResponse {
    #[serde(rename = "x402/payment-response")]
    pub payment_response: SettleResponse,
}

/// x402 payment required data (from 402 error).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpX402PaymentRequired {
    #[serde(rename = "x402Version")]
    pub x402_version: u32,
    pub accepts: Vec<PaymentRequirements>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(
        skip_serializing_if = "Option::is_none",
        rename = "x402/payment-response"
    )]
    pub payment_response: Option<SettleResponse>,
}

/// Extract payment from request _meta.
pub fn payment_from_request(
    params: &serde_json::Value,
) -> (Option<PaymentPayload>, Option<String>) {
    let meta = params.get("_meta");
    let payment = meta
        .and_then(|m| m.get("x402/payment"))
        .and_then(|p| serde_json::from_value(p.clone()).ok());
    let payment_id = meta
        .and_then(|m| m.get("ampersend/paymentId"))
        .and_then(|p| p.as_str())
        .map(|s| s.to_string());
    (payment, payment_id)
}

/// Build request params with payment attached in _meta.
pub fn build_params_with_payment(
    params: &serde_json::Value,
    payment: &PaymentPayload,
    payment_id: &str,
) -> serde_json::Value {
    let mut params = params.clone();
    let meta = params
        .as_object_mut()
        .and_then(|obj| {
            if !obj.contains_key("_meta") {
                obj.insert("_meta".to_string(), serde_json::json!({}));
            }
            obj.get_mut("_meta")
        })
        .and_then(|m| m.as_object_mut());

    if let Some(meta) = meta {
        meta.insert(
            "x402/payment".to_string(),
            serde_json::to_value(payment).unwrap_or_default(),
        );
        meta.insert(
            "ampersend/paymentId".to_string(),
            serde_json::Value::String(payment_id.to_string()),
        );
    }

    params
}

/// Check if a JSON-RPC error is an x402 payment required error.
pub fn is_x402_error(error: &JsonRpcError) -> bool {
    error.code == 402
}

/// Parse x402 data from a JSON-RPC error.
pub fn parse_x402_from_error(error: &JsonRpcError) -> Option<McpX402PaymentRequired> {
    if error.code != 402 {
        return None;
    }
    error
        .data
        .as_ref()
        .and_then(|d| serde_json::from_value(d.clone()).ok())
}

/// Parse x402 payment response from a JSON-RPC result _meta.
pub fn parse_x402_payment_response(result: &serde_json::Value) -> Option<McpX402PaymentResponse> {
    result
        .get("_meta")
        .and_then(|m| serde_json::from_value(m.clone()).ok())
}

/// Check if x402 data contains a payment response (vs payment required).
pub fn is_payment_response(data: &McpX402PaymentRequired) -> bool {
    data.payment_response.is_some()
}
