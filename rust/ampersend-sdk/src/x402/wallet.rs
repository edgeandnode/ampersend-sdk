use async_trait::async_trait;

use super::types::{PaymentPayload, PaymentRequirements};
use crate::error::WalletError;

/// X402Wallet trait — Creates payment payloads from requirements.
///
/// An X402Wallet is responsible for creating cryptographically signed payment payloads
/// that can be submitted to sellers. Different wallet implementations support
/// different account types (EOA, smart accounts, etc.).
#[async_trait]
pub trait X402Wallet: Send + Sync {
    /// Creates a payment payload from requirements.
    async fn create_payment(
        &self,
        requirements: &PaymentRequirements,
    ) -> Result<PaymentPayload, WalletError>;
}
