//! FastMCP-style server middleware for x402 payment handling.
//!
//! Provides middleware that wraps tool execution with payment requirement
//! checking and settlement response handling.

use std::future::Future;
use std::pin::Pin;

use crate::x402::types::{PaymentPayload, PaymentRequirements, SettleResponse};

/// Context passed to the `on_execute` callback.
pub struct ExecuteContext {
    pub args: serde_json::Value,
}

/// Context passed to the `on_payment` callback.
pub struct PaymentCheckContext {
    pub payment: PaymentPayload,
    pub requirements: PaymentRequirements,
}

/// Callback to determine if payment is required for tool execution.
pub type OnExecuteFn = Box<
    dyn Fn(ExecuteContext) -> Pin<Box<dyn Future<Output = Option<PaymentRequirements>> + Send>>
        + Send
        + Sync,
>;

/// Callback when payment is provided.
pub type OnPaymentFn = Box<
    dyn Fn(
            PaymentCheckContext,
        ) -> Pin<Box<dyn Future<Output = Result<Option<SettleResponse>, String>> + Send>>
        + Send
        + Sync,
>;

/// Options for the x402 payment middleware.
pub struct WithX402PaymentOptions {
    pub on_execute: OnExecuteFn,
    pub on_payment: OnPaymentFn,
}

/// x402 payment error data.
#[derive(Debug, serde::Serialize)]
pub struct PaymentErrorData {
    pub message: String,
    pub code: i32,
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

/// Error returned when payment is required.
#[derive(Debug)]
pub struct X402PaymentError {
    pub data: PaymentErrorData,
}

impl std::fmt::Display for X402PaymentError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Payment required: {}", self.data.message)
    }
}

impl std::error::Error for X402PaymentError {}

fn create_payment_error(
    requirements: &PaymentRequirements,
    error_reason: Option<&str>,
    payment_response: Option<SettleResponse>,
) -> X402PaymentError {
    X402PaymentError {
        data: PaymentErrorData {
            message: "Payment required for tool execution".to_string(),
            code: 402,
            x402_version: 1,
            accepts: vec![requirements.clone()],
            error: error_reason.map(|s| s.to_string()),
            payment_response,
        },
    }
}

/// Tool execution result that may include x402 _meta.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ToolResult {
    pub content: Vec<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "_meta")]
    pub meta: Option<serde_json::Value>,
}

/// Execute a tool with x402 payment middleware.
///
/// This function wraps tool execution with payment requirement checking.
/// If payment is required but not provided, returns a 402 error.
/// If payment is provided, validates it and proceeds with execution.
pub async fn execute_with_x402_payment<F, Fut>(
    options: &WithX402PaymentOptions,
    args: serde_json::Value,
    request_meta: Option<&serde_json::Value>,
    execute: F,
) -> Result<ToolResult, X402PaymentError>
where
    F: FnOnce(serde_json::Value) -> Fut,
    Fut: Future<Output = Result<ToolResult, Box<dyn std::error::Error + Send + Sync>>>,
{
    // Extract payment from request metadata
    let payment: Option<PaymentPayload> = request_meta
        .and_then(|m| m.get("x402/payment"))
        .and_then(|p| serde_json::from_value(p.clone()).ok());

    // Check if payment is required
    let requirements = (options.on_execute)(ExecuteContext { args: args.clone() }).await;

    let requirements = match requirements {
        Some(r) => r,
        None => {
            // No payment required - execute normally
            return execute(args).await.map_err(|e| {
                create_payment_error(
                    &PaymentRequirements {
                        scheme: "exact".to_string(),
                        network: String::new(),
                        max_amount_required: String::new(),
                        resource: String::new(),
                        description: String::new(),
                        mime_type: String::new(),
                        pay_to: String::new(),
                        max_timeout_seconds: 0,
                        asset: String::new(),
                        extra: None,
                    },
                    Some(&e.to_string()),
                    None,
                )
            });
        }
    };

    // Payment is required
    let payment = match payment {
        Some(p) => p,
        None => {
            // No payment provided - return error with requirements
            return Err(create_payment_error(&requirements, None, None));
        }
    };

    // Payment provided — validate it
    let settle_response = match (options.on_payment)(PaymentCheckContext {
        payment,
        requirements: requirements.clone(),
    })
    .await
    {
        Ok(resp) => resp,
        Err(reason) => {
            return Err(create_payment_error(&requirements, Some(&reason), None));
        }
    };

    if let Some(ref resp) = settle_response {
        if !resp.success {
            return Err(create_payment_error(
                &requirements,
                resp.error_reason.as_deref(),
                Some(resp.clone()),
            ));
        }
    }

    // Payment valid — execute
    let mut result = execute(args)
        .await
        .map_err(|e| create_payment_error(&requirements, Some(&e.to_string()), None))?;

    // Add settlement response to result _meta
    if let Some(resp) = settle_response {
        let mut meta = result.meta.clone().unwrap_or(serde_json::json!({}));
        if let Some(obj) = meta.as_object_mut() {
            obj.insert(
                "x402/payment-response".to_string(),
                serde_json::to_value(resp).unwrap_or_default(),
            );
        }
        result.meta = Some(meta);
    }

    Ok(result)
}
