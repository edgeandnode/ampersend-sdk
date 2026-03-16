use std::collections::HashMap;

use crate::mcp::types::*;
use crate::x402::treasurer::{Authorization, PaymentContext, PaymentStatus, X402Treasurer};

/// X402 middleware for MCP message-level payment handling.
///
/// Used by the proxy bridge to intercept x402 responses and handle payment
/// authorization at the transport level.
pub struct X402Middleware {
    treasurer: Box<dyn X402Treasurer>,
    /// Track authorizations by payment ID for status updates
    authorizations: HashMap<String, Authorization>,
}

impl X402Middleware {
    pub fn new(treasurer: Box<dyn X402Treasurer>) -> Self {
        Self {
            treasurer,
            authorizations: HashMap::new(),
        }
    }

    /// Process a response message, potentially triggering payment.
    ///
    /// Returns `Some(modified_request)` if payment was approved and the request should
    /// be retried, or `None` if the response should be forwarded as-is.
    pub async fn on_message(
        &mut self,
        request: &JsonRpcRequest,
        response: &JsonRpcResponse,
    ) -> Option<JsonRpcRequest> {
        // Check for x402 payment response in result _meta
        if let Some(ref result) = response.result {
            if let Some(payment_resp) = parse_x402_payment_response(result) {
                // This is a payment response - update status
                let params = request.params.as_ref()?;
                let (_, payment_id) = payment_from_request(params);
                let payment_id = payment_id?;

                if let Some(authorization) = self.authorizations.remove(&payment_id) {
                    let status = if payment_resp.payment_response.success {
                        PaymentStatus::Accepted
                    } else {
                        PaymentStatus::Rejected
                    };
                    self.treasurer.on_status(status, &authorization, None).await;
                }
                return None;
            }
        }

        // Check for x402 error
        let error = response.error.as_ref()?;
        let x402_data = parse_x402_from_error(error)?;

        if is_payment_response(&x402_data) {
            // Payment response in error
            let params = request.params.as_ref()?;
            let (_, payment_id) = payment_from_request(params);
            let payment_id = payment_id?;

            if let Some(authorization) = self.authorizations.remove(&payment_id) {
                let status = if x402_data
                    .payment_response
                    .as_ref()
                    .map(|r| r.success)
                    .unwrap_or(false)
                {
                    PaymentStatus::Accepted
                } else {
                    PaymentStatus::Rejected
                };
                self.treasurer.on_status(status, &authorization, None).await;
            }
            return None;
        }

        // Check if request already includes payment
        if let Some(ref params) = request.params {
            if let Some(meta) = params.get("_meta") {
                if meta.get("x402/payment").is_some() {
                    return None;
                }
            }
        }

        // Payment required — consult treasurer
        let context = PaymentContext {
            method: request.method.clone(),
            params: request.params.clone().unwrap_or(serde_json::Value::Null),
            metadata: Some(serde_json::json!({ "requestId": request.id })),
        };

        let authorization = self
            .treasurer
            .on_payment_required(&x402_data.accepts, Some(&context))
            .await?;

        // Track authorization for later status updates
        self.authorizations.insert(
            authorization.authorization_id.clone(),
            authorization.clone(),
        );

        // Notify treasurer that payment is being sent
        self.treasurer
            .on_status(PaymentStatus::Sending, &authorization, None)
            .await;

        // Build modified request with payment
        let params = request.params.clone().unwrap_or(serde_json::json!({}));
        let params_with_payment = build_params_with_payment(
            &params,
            &authorization.payment,
            &authorization.authorization_id,
        );

        Some(JsonRpcRequest {
            jsonrpc: request.jsonrpc.clone(),
            id: request.id.clone(),
            method: request.method.clone(),
            params: Some(params_with_payment),
        })
    }
}
