/// Proxy environment configuration.
#[derive(Debug, Clone)]
pub struct ProxyEnvConfig {
    pub port: Option<u16>,
    /// EOA mode: private key
    pub buyer_private_key: Option<String>,
    /// Smart account mode
    pub buyer_smart_account_address: Option<String>,
    pub buyer_smart_account_key_private_key: Option<String>,
    pub buyer_smart_account_validator_address: Option<String>,
    pub buyer_smart_account_chain_id: Option<u64>,
    /// Ampersend API URL (if set, uses AmpersendTreasurer; otherwise NaiveTreasurer)
    pub ampersend_api_url: Option<String>,
}

/// Parse environment configuration with a given prefix.
///
/// Environment variables are expected as `{prefix}VARIABLE_NAME`.
pub fn parse_env_config(prefix: &str) -> Result<ProxyEnvConfig, String> {
    let get = |name: &str| -> Option<String> {
        std::env::var(format!("{prefix}{name}"))
            .ok()
            .filter(|v| !v.is_empty())
    };

    let port = get("PORT").and_then(|v| v.parse().ok());

    let buyer_private_key = get("BUYER_PRIVATE_KEY");
    let buyer_smart_account_address = get("BUYER_SMART_ACCOUNT_ADDRESS");
    let buyer_smart_account_key_private_key = get("BUYER_SMART_ACCOUNT_KEY_PRIVATE_KEY");
    let buyer_smart_account_validator_address = get("BUYER_SMART_ACCOUNT_VALIDATOR_ADDRESS");
    let buyer_smart_account_chain_id =
        get("BUYER_SMART_ACCOUNT_CHAIN_ID").and_then(|v| v.parse().ok());
    let ampersend_api_url = get("AMPERSEND_API_URL");

    // Validate mutual exclusivity
    if buyer_private_key.is_some() && buyer_smart_account_address.is_some() {
        return Err(
            "Cannot provide both BUYER_PRIVATE_KEY and BUYER_SMART_ACCOUNT_ADDRESS".to_string(),
        );
    }

    // Validate smart account has required fields
    if buyer_smart_account_address.is_some() && buyer_smart_account_key_private_key.is_none() {
        return Err(
            "BUYER_SMART_ACCOUNT_KEY_PRIVATE_KEY is required when using smart account mode"
                .to_string(),
        );
    }

    Ok(ProxyEnvConfig {
        port,
        buyer_private_key,
        buyer_smart_account_address,
        buyer_smart_account_key_private_key,
        buyer_smart_account_validator_address,
        buyer_smart_account_chain_id,
        ampersend_api_url,
    })
}
