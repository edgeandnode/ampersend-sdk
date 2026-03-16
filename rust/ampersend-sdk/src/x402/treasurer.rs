use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use super::types::{PaymentPayload, PaymentRequirements};

/// Context information for payment decisions.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaymentContext {
    pub method: String,
    #[serde(default)]
    pub params: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
}

/// Authorization linking a payment with a tracking ID.
#[derive(Debug, Clone)]
pub struct Authorization {
    /// Signed payment payload
    pub payment: PaymentPayload,
    /// Unique tracking ID
    pub authorization_id: String,
}

/// Payment status types for tracking payment lifecycle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PaymentStatus {
    /// Payment submitted to seller
    Sending,
    /// Payment verified and accepted
    Accepted,
    /// Payment rejected by seller
    Rejected,
    /// Buyer declined to pay
    Declined,
    /// Error during payment processing
    Error,
}

impl std::fmt::Display for PaymentStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PaymentStatus::Sending => write!(f, "sending"),
            PaymentStatus::Accepted => write!(f, "accepted"),
            PaymentStatus::Rejected => write!(f, "rejected"),
            PaymentStatus::Declined => write!(f, "declined"),
            PaymentStatus::Error => write!(f, "error"),
        }
    }
}

/// X402Treasurer trait — Separates payment decision logic from payment creation.
///
/// An X402Treasurer decides whether to approve or reject payment requests,
/// tracks payment status, and delegates actual payment creation to an X402Wallet.
#[async_trait]
pub trait X402Treasurer: Send + Sync {
    /// Called when payment is required.
    ///
    /// Returns `Some(Authorization)` to proceed with payment, or `None` to decline.
    async fn on_payment_required(
        &self,
        requirements: &[PaymentRequirements],
        context: Option<&PaymentContext>,
    ) -> Option<Authorization>;

    /// Called with payment status updates throughout the payment lifecycle.
    async fn on_status(
        &self,
        status: PaymentStatus,
        authorization: &Authorization,
        context: Option<&PaymentContext>,
    );
}
