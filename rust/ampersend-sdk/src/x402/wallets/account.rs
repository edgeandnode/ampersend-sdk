use std::borrow::Cow;

use alloy_primitives::{Address, FixedBytes, U256};
use alloy_signer::Signer;
use alloy_signer_local::PrivateKeySigner;
use alloy_sol_types::Eip712Domain;
use async_trait::async_trait;

use crate::error::WalletError;
use crate::x402::types::{PaymentPayload, PaymentRequirements};
use crate::x402::wallet::X402Wallet;

/// AccountWallet — EOA (Externally Owned Account) wallet implementation.
///
/// Creates payment payloads signed by an EOA private key.
/// Supports the "exact" payment scheme.
pub struct AccountWallet {
    signer: PrivateKeySigner,
}

impl AccountWallet {
    /// Creates an AccountWallet from a [`PrivateKeySigner`].
    pub fn new(signer: PrivateKeySigner) -> Self {
        Self { signer }
    }

    /// Creates an AccountWallet from a hex-encoded private key.
    pub fn from_private_key(private_key: &str) -> Result<Self, WalletError> {
        let key = private_key.strip_prefix("0x").unwrap_or(private_key);
        let bytes: FixedBytes<32> = key
            .parse()
            .map_err(|e| WalletError::payment(format!("Invalid private key: {e}")))?;
        let signer = PrivateKeySigner::from_bytes(&bytes)
            .map_err(|e| WalletError::payment(format!("Invalid private key: {e}")))?;
        Ok(Self { signer })
    }

    /// Returns the account address.
    pub fn address(&self) -> Address {
        self.signer.address()
    }
}

#[async_trait]
impl X402Wallet for AccountWallet {
    async fn create_payment(
        &self,
        requirements: &PaymentRequirements,
    ) -> Result<PaymentPayload, WalletError> {
        if requirements.scheme != "exact" {
            return Err(WalletError::UnsupportedScheme(requirements.scheme.clone()));
        }

        // For EOA wallets, we create an ERC-3009 TransferWithAuthorization
        // signed directly by the EOA private key.
        let now = chrono::Utc::now().timestamp() as u64;
        let valid_after = now.saturating_sub(600); // 10 minutes before
        let valid_before = now + requirements.max_timeout_seconds;

        let nonce_bytes: [u8; 32] = rand::random();
        let nonce = format!("0x{}", hex::encode(nonce_bytes));

        let from = self.signer.address();
        let value = &requirements.max_amount_required;

        // Build EIP-712 typed data for ERC-3009 TransferWithAuthorization
        let domain_name = requirements
            .extra
            .as_ref()
            .and_then(|e| e.get("name"))
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                WalletError::payment("requirements.extra must contain 'name' for EIP-712 domain")
            })?;

        let domain_version = requirements
            .extra
            .as_ref()
            .and_then(|e| e.get("version"))
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                WalletError::payment("requirements.extra must contain 'version' for EIP-712 domain")
            })?;

        let asset_addr: Address = requirements
            .asset
            .parse()
            .map_err(|_| WalletError::payment("Invalid asset address"))?;

        let chain_id =
            crate::x402::types::network_to_chain_id(&requirements.network).ok_or_else(|| {
                WalletError::payment(format!("Unknown network: {}", requirements.network))
            })?;

        // Construct EIP-712 domain manually to avoid lifetime issues with macro
        let domain = Eip712Domain {
            name: Some(Cow::Owned(domain_name.to_string())),
            version: Some(Cow::Owned(domain_version.to_string())),
            chain_id: Some(U256::from(chain_id)),
            verifying_contract: Some(asset_addr),
            salt: None,
        };

        alloy_sol_types::sol! {
            #[derive(serde::Serialize)]
            struct TransferWithAuthorization {
                address from;
                address to;
                uint256 value;
                uint256 validAfter;
                uint256 validBefore;
                bytes32 nonce;
            }
        }

        let pay_to: Address = requirements
            .pay_to
            .parse()
            .map_err(|_| WalletError::payment("Invalid payTo address"))?;

        let value_u256 = alloy_primitives::U256::from_str_radix(
            value.strip_prefix("0x").unwrap_or(value),
            if value.starts_with("0x") { 16 } else { 10 },
        )
        .map_err(|_| WalletError::payment("Invalid payment amount"))?;

        let nonce_bytes_fixed: FixedBytes<32> = nonce
            .parse()
            .map_err(|_| WalletError::payment("Failed to parse nonce"))?;

        let message = TransferWithAuthorization {
            from,
            to: pay_to,
            value: value_u256,
            validAfter: alloy_primitives::U256::from(valid_after),
            validBefore: alloy_primitives::U256::from(valid_before),
            nonce: nonce_bytes_fixed,
        };

        let signing_hash = alloy_sol_types::SolStruct::eip712_signing_hash(&message, &domain);

        let signature = self
            .signer
            .sign_hash(&signing_hash)
            .await
            .map_err(|e| WalletError::payment_with_source("Failed to sign payment", e))?;

        let sig_hex = format!("0x{}", hex::encode(signature.as_bytes()));

        let authorization = serde_json::json!({
            "from": format!("{from}"),
            "to": format!("{pay_to}"),
            "value": value,
            "validAfter": valid_after.to_string(),
            "validBefore": valid_before.to_string(),
            "nonce": nonce,
        });

        let payload = serde_json::json!({
            "signature": sig_hex,
            "authorization": authorization,
        });

        let payment = PaymentPayload {
            x402_version: 1,
            scheme: "exact".to_string(),
            network: requirements.network.clone(),
            payload,
        };

        Ok(payment)
    }
}
