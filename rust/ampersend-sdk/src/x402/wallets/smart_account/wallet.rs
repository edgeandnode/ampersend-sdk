use alloy_primitives::Address;
use async_trait::async_trait;

use super::exact::create_exact_payment;
use crate::error::WalletError;
use crate::smart_account::constants::OWNABLE_VALIDATOR;
use crate::x402::types::{PaymentPayload, PaymentRequirements};
use crate::x402::wallet::X402Wallet;

/// Configuration for SmartAccountWallet.
#[derive(Debug, Clone)]
pub struct SmartAccountConfig {
    /// Smart account address
    pub smart_account_address: Address,
    /// Session key private key for signing (hex-encoded with 0x prefix)
    pub session_key_private_key: String,
    /// Chain ID for the blockchain network
    pub chain_id: u64,
    /// OwnableValidator address (defaults to standard OwnableValidator)
    pub validator_address: Option<Address>,
}

/// SmartAccountWallet — Smart account wallet implementation using ERC-1271.
///
/// Creates payment payloads signed by a smart account using ERC-1271 standard.
/// Supports Safe accounts with OwnableValidator module.
/// Only supports the "exact" payment scheme with ERC-3009 (USDC) authorizations.
pub struct SmartAccountWallet {
    config: SmartAccountConfig,
    validator_address: Address,
}

impl SmartAccountWallet {
    pub fn new(config: SmartAccountConfig) -> Self {
        let validator_address = config.validator_address.unwrap_or_else(|| {
            OWNABLE_VALIDATOR
                .parse::<Address>()
                .expect("Invalid OWNABLE_VALIDATOR constant")
        });
        Self {
            config,
            validator_address,
        }
    }

    /// Returns the smart account address.
    pub fn address(&self) -> Address {
        self.config.smart_account_address
    }
}

#[async_trait]
impl X402Wallet for SmartAccountWallet {
    async fn create_payment(
        &self,
        requirements: &PaymentRequirements,
    ) -> Result<PaymentPayload, WalletError> {
        if requirements.scheme != "exact" {
            return Err(WalletError::UnsupportedScheme(requirements.scheme.clone()));
        }

        create_exact_payment(
            requirements,
            self.config.smart_account_address,
            &self.config.session_key_private_key,
            self.config.chain_id,
            self.validator_address,
        )
        .await
    }
}
