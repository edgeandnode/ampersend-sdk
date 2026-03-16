//! HTTP adapter for x402 payment integration.
//!
//! Wraps HTTP requests with automatic x402 payment handling using an
//! X402Treasurer for payment authorization decisions.

use std::sync::Arc;

use reqwest::{Client, Request, Response};

use crate::x402::treasurer::{PaymentContext, PaymentStatus, X402Treasurer};
use crate::x402::types::{PaymentPayload, PaymentRequirements};

/// x402 HTTP client that wraps reqwest with automatic payment handling.
///
/// When a request returns 402, the client consults the treasurer for payment
/// authorization, creates a payment, and retries the request with the payment
/// in the `X-PAYMENT` header.
pub struct X402HttpClient {
    http: Client,
    treasurer: Arc<dyn X402Treasurer>,
}

impl X402HttpClient {
    pub fn new(treasurer: Arc<dyn X402Treasurer>) -> Self {
        Self {
            http: Client::new(),
            treasurer,
        }
    }

    pub fn with_client(http: Client, treasurer: Arc<dyn X402Treasurer>) -> Self {
        Self { http, treasurer }
    }

    /// Execute an HTTP request with automatic x402 payment handling.
    ///
    /// If the server returns 402 Payment Required, the client:
    /// 1. Parses payment requirements from the response
    /// 2. Consults the treasurer for authorization
    /// 3. If approved, retries with payment in the `X-PAYMENT` header
    pub async fn execute(&self, request: Request) -> Result<Response, X402HttpError> {
        let url = request.url().to_string();
        let method_str = request.method().to_string();

        // Clone request for potential retry
        let retry_request = request
            .try_clone()
            .ok_or_else(|| X402HttpError::Other("Cannot clone request for retry".to_string()))?;

        let response = self
            .http
            .execute(request)
            .await
            .map_err(X402HttpError::Http)?;

        if response.status().as_u16() != 402 {
            return Ok(response);
        }

        // Parse x402 requirements from response
        let body = response.text().await.map_err(X402HttpError::Http)?;
        let requirements: Vec<PaymentRequirements> = self.parse_requirements(&body)?;

        if requirements.is_empty() {
            return Err(X402HttpError::NoRequirements);
        }

        // Consult treasurer
        let context = PaymentContext {
            method: method_str,
            params: serde_json::json!({ "resource": url }),
            metadata: None,
        };

        let authorization = match self
            .treasurer
            .on_payment_required(&requirements, Some(&context))
            .await
        {
            Some(auth) => auth,
            None => return Err(X402HttpError::PaymentDeclined),
        };

        // Retry with payment
        self.treasurer
            .on_status(PaymentStatus::Sending, &authorization, Some(&context))
            .await;

        let payment_header = encode_payment_header(&authorization.payment)?;
        let mut retry = retry_request;
        retry.headers_mut().insert(
            "X-PAYMENT",
            payment_header
                .parse()
                .map_err(|_| X402HttpError::Other("Invalid payment header value".to_string()))?,
        );

        match self.http.execute(retry).await {
            Ok(resp) => {
                let status = if resp.status().is_success() {
                    PaymentStatus::Accepted
                } else if resp.status().as_u16() == 402 {
                    PaymentStatus::Rejected
                } else {
                    PaymentStatus::Error
                };
                self.treasurer
                    .on_status(status, &authorization, Some(&context))
                    .await;
                Ok(resp)
            }
            Err(e) => {
                self.treasurer
                    .on_status(PaymentStatus::Error, &authorization, Some(&context))
                    .await;
                Err(X402HttpError::Http(e))
            }
        }
    }

    /// Parse payment requirements from a 402 response body.
    fn parse_requirements(&self, body: &str) -> Result<Vec<PaymentRequirements>, X402HttpError> {
        // Try parsing as x402 response envelope
        #[derive(serde::Deserialize)]
        struct X402Envelope {
            accepts: Option<Vec<PaymentRequirements>>,
        }

        if let Ok(envelope) = serde_json::from_str::<X402Envelope>(body) {
            if let Some(accepts) = envelope.accepts {
                return Ok(accepts);
            }
        }

        // Try parsing as direct array
        if let Ok(reqs) = serde_json::from_str::<Vec<PaymentRequirements>>(body) {
            return Ok(reqs);
        }

        Err(X402HttpError::InvalidRequirements(
            "Could not parse payment requirements from 402 response".to_string(),
        ))
    }
}

/// Encode a payment payload as a base64 header value.
fn encode_payment_header(payment: &PaymentPayload) -> Result<String, X402HttpError> {
    let json = serde_json::to_string(payment)
        .map_err(|e| X402HttpError::Other(format!("Failed to serialize payment: {e}")))?;
    use base64::Engine;
    Ok(base64::engine::general_purpose::STANDARD.encode(json.as_bytes()))
}

/// Errors from the x402 HTTP client.
#[derive(Debug, thiserror::Error)]
pub enum X402HttpError {
    #[error("HTTP error: {0}")]
    Http(reqwest::Error),

    #[error("No payment requirements in 402 response")]
    NoRequirements,

    #[error("Payment declined by treasurer")]
    PaymentDeclined,

    #[error("Invalid payment requirements: {0}")]
    InvalidRequirements(String),

    #[error("{0}")]
    Other(String),
}
