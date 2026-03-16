use alloy_primitives::Address;
use alloy_signer_local::PrivateKeySigner;
use async_trait::async_trait;
use uuid::Uuid;

use super::client::ApiClient;
use super::types::{ApiClientOptions, PaymentEventType};
use crate::smart_account::constants::OWNABLE_VALIDATOR;
use crate::x402::treasurer::{Authorization, PaymentContext, PaymentStatus, X402Treasurer};
use crate::x402::types::PaymentRequirements;
use crate::x402::wallet::X402Wallet;
use crate::x402::wallets::{create_wallet_from_config, SmartAccountConfig, WalletConfig};

/// Default Ampersend API URL.
const DEFAULT_API_URL: &str = "https://api.ampersend.ai";

/// Default chain ID (Base mainnet).
const DEFAULT_CHAIN_ID: u64 = 8453;

/// Simplified configuration for quick setup with smart accounts.
#[derive(Debug, Clone)]
pub struct SimpleAmpersendTreasurerConfig {
    /// Smart account address
    pub smart_account_address: String,
    /// Session key private key for signing (hex with 0x prefix)
    pub session_key_private_key: String,
    /// Ampersend API URL (defaults to production)
    pub api_url: Option<String>,
    /// Chain ID (defaults to Base mainnet 8453)
    pub chain_id: Option<u64>,
}

/// Full configuration for advanced use cases with complete wallet control.
#[derive(Debug, Clone)]
pub struct FullAmpersendTreasurerConfig {
    /// Base URL of the Ampersend API server
    pub api_url: String,
    /// Wallet configuration (EOA or Smart Account)
    pub wallet_config: WalletConfig,
}

/// Configuration for the Ampersend treasurer.
#[derive(Debug, Clone)]
pub enum AmpersendTreasurerConfig {
    Simple(SimpleAmpersendTreasurerConfig),
    Full(FullAmpersendTreasurerConfig),
}

/// AmpersendTreasurer — Ampersend API-based payment authorization.
///
/// This treasurer:
/// 1. Authenticates with the Ampersend API using SIWE
/// 2. Requests payment authorization from the API before creating payments
/// 3. Creates payments only when authorized by the API
/// 4. Reports payment lifecycle events back to the API for tracking
pub struct AmpersendTreasurer {
    api_client: ApiClient,
    wallet: Box<dyn X402Wallet>,
}

impl AmpersendTreasurer {
    pub fn new(api_client: ApiClient, wallet: Box<dyn X402Wallet>) -> Self {
        Self { api_client, wallet }
    }

    fn map_status_to_event(status: PaymentStatus) -> PaymentEventType {
        match status {
            PaymentStatus::Sending => PaymentEventType::Sending,
            PaymentStatus::Accepted => PaymentEventType::Accepted,
            PaymentStatus::Rejected => PaymentEventType::Rejected {
                reason: "Payment rejected by server".to_string(),
            },
            PaymentStatus::Declined => PaymentEventType::Rejected {
                reason: "Payment declined by treasurer".to_string(),
            },
            PaymentStatus::Error => PaymentEventType::Error {
                reason: "Payment processing error".to_string(),
            },
        }
    }
}

#[async_trait]
impl X402Treasurer for AmpersendTreasurer {
    async fn on_payment_required(
        &self,
        requirements: &[PaymentRequirements],
        context: Option<&PaymentContext>,
    ) -> Option<Authorization> {
        let api_context = context.map(|ctx| super::types::AuthRequestContext {
            method: Some(ctx.method.clone()),
            server_url: None,
            params: Some(ctx.params.clone()),
        });

        let response = match self
            .api_client
            .authorize_payment(requirements, api_context.as_ref())
            .await
        {
            Ok(r) => r,
            Err(e) => {
                tracing::error!("[AmpersendTreasurer] Payment authorization failed: {e}");
                return None;
            }
        };

        if response.authorized.requirements.is_empty() {
            let reasons: Vec<String> = response
                .rejected
                .iter()
                .map(|r| format!("{}: {}", r.requirement.resource, r.reason))
                .collect();
            tracing::info!(
                "[AmpersendTreasurer] No requirements authorized. Reasons: {}",
                if reasons.is_empty() {
                    "None provided".to_string()
                } else {
                    reasons.join(", ")
                }
            );
            return None;
        }

        let recommended_index = response.authorized.recommended.unwrap_or(0);
        let authorized_req = response.authorized.requirements.get(recommended_index)?;

        match self
            .wallet
            .create_payment(&authorized_req.requirement)
            .await
        {
            Ok(payment) => Some(Authorization {
                payment,
                authorization_id: Uuid::new_v4().to_string(),
            }),
            Err(e) => {
                tracing::error!("[AmpersendTreasurer] Failed to create payment: {e}");
                None
            }
        }
    }

    async fn on_status(
        &self,
        status: PaymentStatus,
        authorization: &Authorization,
        _context: Option<&PaymentContext>,
    ) {
        let event = Self::map_status_to_event(status);
        if let Err(e) = self
            .api_client
            .report_payment_event(
                &authorization.authorization_id,
                &authorization.payment,
                event,
            )
            .await
        {
            tracing::error!("[AmpersendTreasurer] Failed to report status {status}: {e}");
        }
    }
}

/// Creates an Ampersend treasurer from configuration.
pub fn create_ampersend_treasurer(config: AmpersendTreasurerConfig) -> AmpersendTreasurer {
    match config {
        AmpersendTreasurerConfig::Simple(simple) => {
            let chain_id = simple.chain_id.unwrap_or(DEFAULT_CHAIN_ID);
            let validator_address: Address = OWNABLE_VALIDATOR
                .parse()
                .expect("Invalid OWNABLE_VALIDATOR constant");

            let smart_account_address: Address = simple
                .smart_account_address
                .parse()
                .expect("Invalid smart account address");

            let wallet_config = WalletConfig::SmartAccount(SmartAccountConfig {
                smart_account_address,
                session_key_private_key: simple.session_key_private_key.clone(),
                chain_id,
                validator_address: Some(validator_address),
            });

            let api_client = ApiClient::new(ApiClientOptions {
                base_url: simple
                    .api_url
                    .unwrap_or_else(|| DEFAULT_API_URL.to_string()),
                session_key_private_key: Some(simple.session_key_private_key),
                agent_address: simple.smart_account_address,
                timeout_ms: 30000,
            });

            let wallet = create_wallet_from_config(wallet_config);
            AmpersendTreasurer::new(api_client, wallet)
        }
        AmpersendTreasurerConfig::Full(full) => {
            let auth_private_key = match &full.wallet_config {
                WalletConfig::Eoa { private_key } => private_key.clone(),
                WalletConfig::SmartAccount(config) => config.session_key_private_key.clone(),
            };

            let agent_address = match &full.wallet_config {
                WalletConfig::SmartAccount(config) => format!("{}", config.smart_account_address),
                WalletConfig::Eoa { private_key } => {
                    let key = private_key.strip_prefix("0x").unwrap_or(private_key);
                    let key_bytes: alloy_primitives::FixedBytes<32> =
                        key.parse().expect("Invalid EOA private key");
                    let signer =
                        PrivateKeySigner::from_bytes(&key_bytes).expect("Invalid EOA private key");
                    format!("{}", signer.address())
                }
            };

            let api_client = ApiClient::new(ApiClientOptions {
                base_url: full.api_url,
                session_key_private_key: Some(auth_private_key),
                agent_address,
                timeout_ms: 30000,
            });

            let wallet = create_wallet_from_config(full.wallet_config);
            AmpersendTreasurer::new(api_client, wallet)
        }
    }
}
