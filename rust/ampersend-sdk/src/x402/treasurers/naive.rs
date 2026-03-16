use async_trait::async_trait;
use uuid::Uuid;

use crate::x402::treasurer::{Authorization, PaymentContext, PaymentStatus, X402Treasurer};
use crate::x402::types::PaymentRequirements;
use crate::x402::wallet::X402Wallet;

/// NaiveTreasurer — Auto-approves all payment requests.
///
/// This treasurer automatically approves all payment requests without
/// any budget checks or user confirmation. Useful for:
/// - Testing and development
/// - Trusted sellers where all requests should be paid
/// - Simple use cases without budget limits
pub struct NaiveTreasurer {
    wallet: Box<dyn X402Wallet>,
}

impl NaiveTreasurer {
    pub fn new(wallet: Box<dyn X402Wallet>) -> Self {
        Self { wallet }
    }
}

#[async_trait]
impl X402Treasurer for NaiveTreasurer {
    /// Always approves payment by creating payment with the wallet.
    /// Uses the first requirement from the array.
    async fn on_payment_required(
        &self,
        requirements: &[PaymentRequirements],
        _context: Option<&PaymentContext>,
    ) -> Option<Authorization> {
        if requirements.is_empty() {
            return None;
        }

        match self.wallet.create_payment(&requirements[0]).await {
            Ok(payment) => Some(Authorization {
                payment,
                authorization_id: Uuid::new_v4().to_string(),
            }),
            Err(e) => {
                tracing::error!("[NaiveTreasurer] Failed to create payment: {e}");
                None
            }
        }
    }

    /// Logs payment status for debugging.
    async fn on_status(
        &self,
        status: PaymentStatus,
        authorization: &Authorization,
        _context: Option<&PaymentContext>,
    ) {
        tracing::info!(
            "[NaiveTreasurer] Payment {}: {status}",
            authorization.authorization_id
        );
    }
}
