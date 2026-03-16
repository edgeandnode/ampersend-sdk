use crate::ampersend::treasurer::{
    create_ampersend_treasurer, AmpersendTreasurerConfig, SimpleAmpersendTreasurerConfig,
};
use crate::mcp::client::mcp_client::{ClientOptions, McpClient};
use crate::mcp::types::Implementation;

/// Default Ampersend API URL.
const DEFAULT_API_URL: &str = "https://api.ampersend.ai";

/// Default chain ID (Base Sepolia).
const DEFAULT_CHAIN_ID: u64 = 84532;

/// Simplified options for Ampersend MCP client.
pub struct SimpleClientOptions {
    /// Client implementation info (name and version)
    pub client_info: Implementation,
    /// Smart account address
    pub smart_account_address: String,
    /// Session key private key for signing
    pub session_key_private_key: String,
    /// Ampersend API URL (defaults to production)
    pub api_url: Option<String>,
    /// Chain ID (defaults to Base Sepolia 84532)
    pub chain_id: Option<u64>,
}

/// Create an MCP client with Ampersend payment support.
///
/// This is the recommended way to create an MCP client with automatic x402
/// payment handling for most use cases.
pub fn create_ampersend_mcp_client(options: SimpleClientOptions) -> McpClient {
    let treasurer = create_ampersend_treasurer(AmpersendTreasurerConfig::Simple(
        SimpleAmpersendTreasurerConfig {
            smart_account_address: options.smart_account_address,
            session_key_private_key: options.session_key_private_key,
            api_url: Some(
                options
                    .api_url
                    .unwrap_or_else(|| DEFAULT_API_URL.to_string()),
            ),
            chain_id: Some(options.chain_id.unwrap_or(DEFAULT_CHAIN_ID)),
        },
    ));

    McpClient::new(ClientOptions {
        client_info: options.client_info,
        treasurer: Box::new(treasurer),
    })
}
