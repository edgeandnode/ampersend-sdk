use std::sync::Arc;

use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use reqwest::Client as HttpClient;
use tokio::sync::Mutex;
use url::Url;

use crate::mcp::client::middleware::X402Middleware;
use crate::mcp::types::*;
use crate::x402::treasurer::X402Treasurer;

/// X402 bridge between MCP client and target server.
///
/// Forwards JSON-RPC messages between the proxy client and the target MCP server,
/// intercepting x402 payment-required responses through the middleware.
pub struct X402Bridge {
    target_url: Url,
    session_id: String,
    http: HttpClient,
    middleware: Mutex<X402Middleware>,
    /// Session ID from the target server.
    target_session_id: Mutex<Option<String>>,
}

impl X402Bridge {
    pub fn new(target_url: Url, treasurer: Arc<dyn X402Treasurer>, session_id: String) -> Self {
        // Clone the treasurer Arc into a Box for the middleware.
        // We use a wrapper that implements X402Treasurer for Arc<dyn X402Treasurer>.
        let treasurer_box: Box<dyn X402Treasurer> = Box::new(ArcTreasurer(treasurer));

        Self {
            target_url,
            session_id,
            http: HttpClient::new(),
            middleware: Mutex::new(X402Middleware::new(treasurer_box)),
            target_session_id: Mutex::new(None),
        }
    }

    /// Forward a request to the target server, handling x402 payments.
    pub async fn forward_request(&self, body: serde_json::Value) -> axum::response::Response {
        // Parse as JSON-RPC request
        let request: JsonRpcRequest = match serde_json::from_value(body.clone()) {
            Ok(r) => r,
            Err(_) => {
                // Not a valid JSON-RPC request - forward as-is
                return self.forward_raw(body).await;
            }
        };

        // Forward to target
        let response = match self.send_to_target(&body).await {
            Ok(r) => r,
            Err(e) => {
                return (
                    StatusCode::BAD_GATEWAY,
                    Json(serde_json::json!({ "error": e.to_string() })),
                )
                    .into_response();
            }
        };

        // Parse as JSON-RPC response
        let rpc_response: JsonRpcResponse = match serde_json::from_value(response.clone()) {
            Ok(r) => r,
            Err(_) => return Json(response).into_response(),
        };

        // Process through middleware
        let mut middleware = self.middleware.lock().await;
        match middleware.on_message(&request, &rpc_response).await {
            Some(retry_request) => {
                // Middleware wants to retry with payment
                let retry_body = serde_json::to_value(&retry_request).unwrap_or_default();
                match self.send_to_target(&retry_body).await {
                    Ok(retry_response) => {
                        // Process retry response through middleware too
                        if let Ok(retry_rpc) =
                            serde_json::from_value::<JsonRpcResponse>(retry_response.clone())
                        {
                            // Process payment response
                            let _ = middleware.on_message(&retry_request, &retry_rpc).await;
                        }
                        Json(retry_response).into_response()
                    }
                    Err(e) => (
                        StatusCode::BAD_GATEWAY,
                        Json(serde_json::json!({ "error": e.to_string() })),
                    )
                        .into_response(),
                }
            }
            None => {
                // Forward response as-is
                Json(response).into_response()
            }
        }
    }

    /// Close the bridge.
    pub async fn close(&self) {
        // Nothing to clean up for HTTP transport
        tracing::debug!("Closing bridge session {}", self.session_id);
    }

    /// Forward raw body to target.
    async fn forward_raw(&self, body: serde_json::Value) -> axum::response::Response {
        match self.send_to_target(&body).await {
            Ok(response) => Json(response).into_response(),
            Err(e) => (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({ "error": e.to_string() })),
            )
                .into_response(),
        }
    }

    /// Send a request to the target MCP server.
    async fn send_to_target(
        &self,
        body: &serde_json::Value,
    ) -> Result<serde_json::Value, reqwest::Error> {
        let mut req = self.http.post(self.target_url.as_str()).json(body);

        let target_sid = self.target_session_id.lock().await;
        if let Some(ref sid) = *target_sid {
            req = req.header("mcp-session-id", sid);
        }
        drop(target_sid);

        let response = req.send().await?;

        // Capture session ID from target
        if let Some(sid) = response
            .headers()
            .get("mcp-session-id")
            .and_then(|v| v.to_str().ok())
        {
            let mut target_sid = self.target_session_id.lock().await;
            *target_sid = Some(sid.to_string());
        }

        response.json().await
    }
}

/// Wrapper to implement X402Treasurer for Arc<dyn X402Treasurer>.
struct ArcTreasurer(Arc<dyn X402Treasurer>);

#[async_trait::async_trait]
impl crate::x402::treasurer::X402Treasurer for ArcTreasurer {
    async fn on_payment_required(
        &self,
        requirements: &[crate::x402::types::PaymentRequirements],
        context: Option<&crate::x402::treasurer::PaymentContext>,
    ) -> Option<crate::x402::treasurer::Authorization> {
        self.0.on_payment_required(requirements, context).await
    }

    async fn on_status(
        &self,
        status: crate::x402::treasurer::PaymentStatus,
        authorization: &crate::x402::treasurer::Authorization,
        context: Option<&crate::x402::treasurer::PaymentContext>,
    ) {
        self.0.on_status(status, authorization, context).await;
    }
}
