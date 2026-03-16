//! # ampersend-sdk
//!
//! Rust SDK for integrating x402 payment capabilities into agent and LLM applications.
//!
//! This SDK provides:
//! - **Core x402 abstractions**: Treasurer and Wallet traits for payment authorization
//! - **Wallet implementations**: EOA (AccountWallet) and Smart Account (SmartAccountWallet)
//! - **Treasurer implementations**: NaiveTreasurer (auto-approve) and AmpersendTreasurer (API-backed)
//! - **MCP integration**: Client with payment retry, proxy server, and server middleware
//! - **HTTP integration**: x402-aware HTTP client for automatic payment handling
//! - **Smart account support**: ERC-3009 signing with ERC-1271 validation
//!
//! ## Quick Start
//!
//! ```rust,no_run
//! use ampersend_sdk::ampersend::create_ampersend_treasurer;
//! use ampersend_sdk::ampersend::AmpersendTreasurerConfig;
//! use ampersend_sdk::ampersend::SimpleAmpersendTreasurerConfig;
//!
//! let treasurer = create_ampersend_treasurer(AmpersendTreasurerConfig::Simple(
//!     SimpleAmpersendTreasurerConfig {
//!         smart_account_address: "0x...".to_string(),
//!         session_key_private_key: "0x...".to_string(),
//!         api_url: None,
//!         chain_id: None,
//!     },
//! ));
//! ```

pub mod error;

pub mod ampersend;
pub mod mcp;
pub mod smart_account;
pub mod x402;

#[cfg(feature = "http-adapter")]
pub mod http;

// Re-export key types at crate root for convenience
pub use ampersend::{
    create_ampersend_treasurer, AmpersendManagementClient, AmpersendTreasurer,
    AmpersendTreasurerConfig,
};
pub use error::{ApiError, SdkError, WalletError};
pub use x402::treasurers::NaiveTreasurer;
pub use x402::wallets::{AccountWallet, SmartAccountConfig, SmartAccountWallet, WalletConfig};
pub use x402::{
    Authorization, PaymentContext, PaymentPayload, PaymentRequirements, PaymentStatus,
    X402Treasurer, X402Wallet,
};
