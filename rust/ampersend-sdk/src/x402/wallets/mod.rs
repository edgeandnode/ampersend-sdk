pub mod account;
pub mod smart_account;

pub use account::AccountWallet;
pub use smart_account::{SmartAccountConfig, SmartAccountWallet};

/// Wallet configuration for factory creation.
#[derive(Debug, Clone)]
pub enum WalletConfig {
    /// EOA wallet using a private key directly.
    Eoa {
        /// Hex-encoded private key (with or without 0x prefix)
        private_key: String,
    },
    /// Smart account wallet using session key signing.
    SmartAccount(SmartAccountConfig),
}

/// Creates a wallet from configuration.
pub fn create_wallet_from_config(config: WalletConfig) -> Box<dyn crate::x402::wallet::X402Wallet> {
    match config {
        WalletConfig::Eoa { private_key } => Box::new(
            AccountWallet::from_private_key(&private_key).expect("Invalid EOA private key"),
        ),
        WalletConfig::SmartAccount(config) => Box::new(SmartAccountWallet::new(config)),
    }
}
