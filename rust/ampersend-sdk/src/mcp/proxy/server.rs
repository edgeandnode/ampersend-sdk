use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{delete, post};
use axum::{Json, Router};
use tokio::sync::RwLock;

use super::bridge::X402Bridge;
use super::validation::{validate_target_url, UrlValidationError};
use crate::x402::treasurer::X402Treasurer;

/// Shared state for the proxy server.
struct ProxyState {
    treasurer: Arc<dyn X402Treasurer>,
    bridges: RwLock<HashMap<String, Arc<X402Bridge>>>,
}

/// MCP x402 proxy server.
///
/// HTTP proxy that adds x402 payment support to any MCP server.
/// Creates bridge sessions between clients and target MCP servers,
/// intercepting payment-required responses.
pub struct ProxyServer {
    state: Arc<ProxyState>,
    shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
}

impl ProxyServer {
    pub fn new(treasurer: Arc<dyn X402Treasurer>) -> Self {
        Self {
            state: Arc::new(ProxyState {
                treasurer,
                bridges: RwLock::new(HashMap::new()),
            }),
            shutdown_tx: None,
        }
    }

    /// Start the proxy server on the given port.
    pub async fn start(&mut self, port: u16) -> Result<(), crate::error::SdkError> {
        let app = Router::new()
            .route("/mcp", post(handle_mcp_post))
            .route("/mcp", delete(handle_mcp_delete))
            .with_state(self.state.clone());

        let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{port}"))
            .await
            .map_err(|e| {
                crate::error::SdkError::Other(format!("Failed to bind port {port}: {e}"))
            })?;

        tracing::info!("Starting HTTP proxy server on port {port}");
        tracing::info!("Connect with: http://localhost:{port}/mcp?target=<TARGET_URL>");

        let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();
        self.shutdown_tx = Some(shutdown_tx);

        tokio::spawn(async move {
            axum::serve(listener, app)
                .with_graceful_shutdown(async {
                    let _ = shutdown_rx.await;
                })
                .await
                .ok();
        });

        Ok(())
    }

    /// Stop the proxy server.
    pub async fn stop(&mut self) {
        // Close all bridges
        let bridges: Vec<Arc<X402Bridge>> = {
            let mut map = self.state.bridges.write().await;
            map.drain().map(|(_, b)| b).collect()
        };
        for bridge in bridges {
            bridge.close().await;
        }

        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
    }
}

#[derive(serde::Deserialize)]
struct McpQuery {
    target: Option<String>,
}

/// Handle POST /mcp requests.
async fn handle_mcp_post(
    State(state): State<Arc<ProxyState>>,
    Query(query): Query<McpQuery>,
    headers: HeaderMap,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    let target_url = match query.target {
        Some(t) => t,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "Missing target URL parameter" })),
            )
                .into_response();
        }
    };

    // Validate target URL
    let validated_url = match validate_target_url(&target_url) {
        Ok(url) => url,
        Err(UrlValidationError::InvalidProtocol { protocol }) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": format!("Invalid URL protocol: {protocol}. Only http and https are allowed."),
                    "code": "INVALID_PROTOCOL"
                })),
            )
                .into_response();
        }
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": e.to_string() })),
            )
                .into_response();
        }
    };

    let session_id = headers
        .get("mcp-session-id")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    // Check for existing bridge
    if let Some(ref sid) = session_id {
        let bridges = state.bridges.read().await;
        if let Some(bridge) = bridges.get(sid) {
            return bridge.forward_request(body).await;
        }
    }

    // Create new bridge
    let new_session_id = uuid::Uuid::new_v4().to_string();
    let bridge = Arc::new(X402Bridge::new(
        validated_url,
        state.treasurer.clone(),
        new_session_id.clone(),
    ));

    {
        let mut bridges = state.bridges.write().await;
        bridges.insert(new_session_id.clone(), bridge.clone());
    }

    bridge.forward_request(body).await
}

/// Handle DELETE /mcp requests.
async fn handle_mcp_delete(
    State(state): State<Arc<ProxyState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let session_id = match headers.get("mcp-session-id").and_then(|v| v.to_str().ok()) {
        Some(sid) => sid.to_string(),
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "Missing session ID header" })),
            )
                .into_response();
        }
    };

    let bridge = {
        let mut bridges = state.bridges.write().await;
        bridges.remove(&session_id)
    };

    match bridge {
        Some(b) => {
            b.close().await;
            StatusCode::OK.into_response()
        }
        None => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Session not found" })),
        )
            .into_response(),
    }
}

/// Initialize and start a proxy server.
pub async fn initialize_proxy_server(
    port: u16,
    treasurer: Arc<dyn X402Treasurer>,
) -> Result<ProxyServer, crate::error::SdkError> {
    let mut server = ProxyServer::new(treasurer);
    server.start(port).await?;
    Ok(server)
}
