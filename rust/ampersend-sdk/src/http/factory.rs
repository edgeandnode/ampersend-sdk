use std::sync::Arc;

use crate::ampersend::treasurer::{
    create_ampersend_treasurer, AmpersendTreasurerConfig, SimpleAmpersendTreasurerConfig,
};
use crate::http::adapter::X402HttpClient;
use crate::x402::types::network_to_chain_id;

/// Default Ampersend API URL.
const DEFAULT_API_URL: &str = "https://api.ampersend.ai";

/// Default network (Base mainnet for production).
const DEFAULT_NETWORK: &str = "base";

/// Simplified options for Ampersend HTTP client wrapper.
pub struct SimpleHttpClientOptions {
    /// Smart account address
    pub smart_account_address: String,
    /// Session key private key for signing
    pub session_key_private_key: String,
    /// Ampersend API URL (defaults to production)
    pub api_url: Option<String>,
    /// Network to use (defaults to "base"). Chain ID is inferred from this.
    pub network: Option<String>,
}

/// Create an x402 HTTP client with Ampersend payment support.
///
/// This integrates ampersend-sdk with automatic payment handling for HTTP requests.
pub fn create_ampersend_http_client(
    options: SimpleHttpClientOptions,
) -> Result<X402HttpClient, crate::error::SdkError> {
    let network = options.network.as_deref().unwrap_or(DEFAULT_NETWORK);
    let chain_id = network_to_chain_id(network)
        .ok_or_else(|| crate::error::SdkError::Config(format!("Unknown network: {network}")))?;

    let treasurer = create_ampersend_treasurer(AmpersendTreasurerConfig::Simple(
        SimpleAmpersendTreasurerConfig {
            smart_account_address: options.smart_account_address,
            session_key_private_key: options.session_key_private_key,
            api_url: Some(
                options
                    .api_url
                    .unwrap_or_else(|| DEFAULT_API_URL.to_string()),
            ),
            chain_id: Some(chain_id),
        },
    ));

    Ok(X402HttpClient::new(Arc::new(treasurer)))
}
