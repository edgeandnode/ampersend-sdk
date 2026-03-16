use std::sync::Arc;

use crate::ampersend::treasurer::{
    create_ampersend_treasurer, AmpersendTreasurerConfig, SimpleAmpersendTreasurerConfig,
};
use crate::mcp::proxy::server::{initialize_proxy_server, ProxyServer};

/// Default Ampersend API URL.
const DEFAULT_API_URL: &str = "https://api.ampersend.ai";

/// Default chain ID (Base Sepolia).
const DEFAULT_CHAIN_ID: u64 = 84532;

/// Simplified options for Ampersend MCP proxy.
pub struct SimpleProxyOptions {
    /// Port to run the proxy server on
    pub port: u16,
    /// Smart account address
    pub smart_account_address: String,
    /// Session key private key for signing
    pub session_key_private_key: String,
    /// Ampersend API URL (defaults to production)
    pub api_url: Option<String>,
    /// Chain ID (defaults to Base Sepolia 84532)
    pub chain_id: Option<u64>,
}

/// Initialize an MCP proxy with minimal configuration.
pub async fn create_ampersend_proxy(
    options: SimpleProxyOptions,
) -> Result<ProxyServer, crate::error::SdkError> {
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

    initialize_proxy_server(options.port, Arc::new(treasurer)).await
}
