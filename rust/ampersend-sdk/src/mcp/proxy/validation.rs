use url::Url;

/// Error from URL validation.
#[derive(Debug, thiserror::Error)]
pub enum UrlValidationError {
    #[error("Invalid URL: {0}")]
    InvalidUrl(String),

    #[error("Invalid URL protocol: {protocol}. Only http and https are allowed.")]
    InvalidProtocol { protocol: String },
}

/// Validate a target URL for the MCP proxy.
///
/// Ensures the URL is well-formed and uses http or https protocol.
pub fn validate_target_url(target: &str) -> Result<Url, UrlValidationError> {
    let url = Url::parse(target).map_err(|e| UrlValidationError::InvalidUrl(e.to_string()))?;

    match url.scheme() {
        "http" | "https" => Ok(url),
        protocol => Err(UrlValidationError::InvalidProtocol {
            protocol: protocol.to_string(),
        }),
    }
}
