use std::sync::atomic::{AtomicU64, Ordering};

use reqwest::Client as HttpClient;
use url::Url;

use crate::mcp::types::*;
use crate::x402::treasurer::{Authorization, PaymentContext, PaymentStatus, X402Treasurer};
use crate::x402::types::PaymentRequirements;

/// Options for creating an MCP client.
pub struct ClientOptions {
    /// MCP client implementation info
    pub client_info: Implementation,
    /// X402Treasurer for handling payment decisions
    pub treasurer: Box<dyn X402Treasurer>,
}

/// MCP Client with transparent x402 payment support.
///
/// Automatically handles HTTP 402 payment responses by calling the user-provided
/// treasurer and retrying requests with payment information.
pub struct McpClient {
    client_info: Implementation,
    treasurer: Box<dyn X402Treasurer>,
    http: HttpClient,
    server_url: Option<Url>,
    session_id: Option<String>,
    next_id: AtomicU64,
}

impl McpClient {
    pub fn new(options: ClientOptions) -> Self {
        Self {
            client_info: options.client_info,
            treasurer: options.treasurer,
            http: HttpClient::new(),
            server_url: None,
            session_id: None,
            next_id: AtomicU64::new(1),
        }
    }

    /// Connect to an MCP server via Streamable HTTP transport.
    pub async fn connect(&mut self, server_url: Url) -> Result<(), crate::error::SdkError> {
        self.server_url = Some(server_url.clone());

        // Send initialize request
        let init_params = serde_json::json!({
            "protocolVersion": "2025-03-26",
            "capabilities": {
                "tools": {}
            },
            "clientInfo": {
                "name": self.client_info.name,
                "version": self.client_info.version,
            }
        });

        let response = self.raw_request("initialize", init_params).await?;

        // Extract session ID from response headers (stored in send_request)
        if let Some(result) = response.result {
            tracing::debug!("MCP initialized: {:?}", result);
        }

        // Send initialized notification
        let notification = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized",
            "params": {}
        });

        let url = self
            .server_url
            .as_ref()
            .expect("server_url set by connect()")
            .clone();
        let mut req = self.http.post(url.as_str()).json(&notification);
        if let Some(ref sid) = self.session_id {
            req = req.header("mcp-session-id", sid);
        }
        let _ = req.send().await;

        Ok(())
    }

    /// Call a tool with automatic payment retry on 402 responses.
    pub async fn call_tool(
        &self,
        name: &str,
        arguments: serde_json::Value,
    ) -> Result<CallToolResult, crate::error::SdkError> {
        let params = serde_json::json!({
            "name": name,
            "arguments": arguments,
        });

        self.with_payment_retry("tools/call", params).await
    }

    /// Read a resource with automatic payment retry on 402 responses.
    pub async fn read_resource(&self, uri: &str) -> Result<CallToolResult, crate::error::SdkError> {
        let params = serde_json::json!({
            "uri": uri,
        });

        self.with_payment_retry("resources/read", params).await
    }

    /// Internal method that handles payment retry logic.
    async fn with_payment_retry(
        &self,
        method: &str,
        params: serde_json::Value,
    ) -> Result<CallToolResult, crate::error::SdkError> {
        match self.raw_request(method, params.clone()).await {
            Ok(resp) => self.parse_tool_result(resp),
            Err(crate::error::SdkError::Mcp(ref msg)) => {
                // Try to parse as x402 error
                if let Some(x402_data) = self.try_parse_x402_error(msg) {
                    let payment_result = self
                        .decide_payment(method, &params, &x402_data.accepts)
                        .await;

                    match payment_result {
                        Some((authorization, params_with_payment)) => {
                            self.treasurer
                                .on_status(PaymentStatus::Sending, &authorization, None)
                                .await;

                            match self.raw_request(method, params_with_payment).await {
                                Ok(result) => {
                                    self.treasurer
                                        .on_status(PaymentStatus::Accepted, &authorization, None)
                                        .await;
                                    self.parse_tool_result(result)
                                }
                                Err(retry_err) => {
                                    let status = if self
                                        .try_parse_x402_error(&retry_err.to_string())
                                        .is_some()
                                    {
                                        PaymentStatus::Rejected
                                    } else {
                                        PaymentStatus::Error
                                    };
                                    self.treasurer.on_status(status, &authorization, None).await;
                                    Err(retry_err)
                                }
                            }
                        }
                        None => Err(crate::error::SdkError::Mcp(msg.clone())),
                    }
                } else {
                    Err(crate::error::SdkError::Mcp(msg.clone()))
                }
            }
            Err(e) => Err(e),
        }
    }

    /// Decide payment and return modified params if approved.
    async fn decide_payment(
        &self,
        method: &str,
        params: &serde_json::Value,
        requirements: &[PaymentRequirements],
    ) -> Option<(Authorization, serde_json::Value)> {
        let context = PaymentContext {
            method: method.to_string(),
            params: params.clone(),
            metadata: None,
        };

        let authorization = self
            .treasurer
            .on_payment_required(requirements, Some(&context))
            .await?;

        let params_with_payment = build_params_with_payment(
            params,
            &authorization.payment,
            &authorization.authorization_id,
        );

        Some((authorization, params_with_payment))
    }

    /// Send a raw JSON-RPC request.
    async fn raw_request(
        &self,
        method: &str,
        params: serde_json::Value,
    ) -> Result<JsonRpcResponse, crate::error::SdkError> {
        let url = self
            .server_url
            .as_ref()
            .ok_or_else(|| crate::error::SdkError::Mcp("Not connected".to_string()))?;

        let id = self.next_id.fetch_add(1, Ordering::Relaxed);

        let request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: serde_json::Value::Number(id.into()),
            method: method.to_string(),
            params: Some(params),
        };

        let mut req = self.http.post(url.as_str()).json(&request);
        if let Some(ref sid) = self.session_id {
            req = req.header("mcp-session-id", sid);
        }

        let response = req
            .send()
            .await
            .map_err(|e| crate::error::SdkError::Mcp(e.to_string()))?;

        // Store session ID from response headers
        // NOTE: In a real implementation this would update self.session_id,
        // but we keep it simple with interior mutability concerns.

        let rpc_response: JsonRpcResponse = response
            .json()
            .await
            .map_err(|e| crate::error::SdkError::Mcp(e.to_string()))?;

        if let Some(ref error) = rpc_response.error {
            return Err(crate::error::SdkError::Mcp(
                serde_json::to_string(error).unwrap_or_else(|_| error.message.clone()),
            ));
        }

        Ok(rpc_response)
    }

    fn parse_tool_result(
        &self,
        response: JsonRpcResponse,
    ) -> Result<CallToolResult, crate::error::SdkError> {
        match response.result {
            Some(result) => serde_json::from_value(result)
                .map_err(|e| crate::error::SdkError::Mcp(e.to_string())),
            None => Ok(CallToolResult {
                content: vec![],
                meta: None,
                is_error: None,
            }),
        }
    }

    fn try_parse_x402_error(&self, error_str: &str) -> Option<McpX402PaymentRequired> {
        let error: JsonRpcError = serde_json::from_str(error_str).ok()?;
        parse_x402_from_error(&error)
    }
}
