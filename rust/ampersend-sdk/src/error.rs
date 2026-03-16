use thiserror::Error;

/// Top-level SDK error type.
#[derive(Debug, Error)]
pub enum SdkError {
    #[error("Wallet error: {0}")]
    Wallet(#[from] WalletError),

    #[error("API error: {0}")]
    Api(#[from] ApiError),

    #[error("MCP error: {0}")]
    Mcp(String),

    #[error("Configuration error: {0}")]
    Config(String),

    #[error("{0}")]
    Other(String),
}

/// Error from wallet operations.
#[derive(Debug, Error)]
pub enum WalletError {
    #[error("{message}")]
    Payment {
        message: String,
        #[source]
        source: Option<Box<dyn std::error::Error + Send + Sync>>,
    },

    #[error("Unsupported payment scheme: {0}. Only \"exact\" is supported.")]
    UnsupportedScheme(String),
}

impl WalletError {
    pub fn payment(message: impl Into<String>) -> Self {
        Self::Payment {
            message: message.into(),
            source: None,
        }
    }

    pub fn payment_with_source(
        message: impl Into<String>,
        source: impl std::error::Error + Send + Sync + 'static,
    ) -> Self {
        Self::Payment {
            message: message.into(),
            source: Some(Box::new(source)),
        }
    }
}

/// Error from API operations.
#[derive(Debug, Error)]
pub enum ApiError {
    #[error("HTTP {status}: {message}")]
    Http { status: u16, message: String },

    #[error("Request timeout after {0}ms")]
    Timeout(u64),

    #[error("Authentication failed: {0}")]
    Auth(String),

    #[error("Request failed: {0}")]
    Request(String),

    #[error("Schema validation failed: {0}")]
    Validation(String),
}
