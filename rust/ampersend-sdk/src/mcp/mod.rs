pub mod client;
pub mod types;

#[cfg(feature = "mcp")]
pub mod proxy;

pub mod server;

pub use client::{create_ampersend_mcp_client, McpClient, SimpleClientOptions, X402Middleware};
pub use types::{CallToolResult, Implementation, JsonRpcMessage, JsonRpcRequest, JsonRpcResponse};
