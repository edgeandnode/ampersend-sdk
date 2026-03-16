use alloy_primitives::{Address, FixedBytes, U256};

use crate::error::WalletError;
use crate::smart_account::signing::sign_erc3009_authorization;
use crate::smart_account::types::ERC3009AuthorizationData;
use crate::x402::types::{PaymentPayload, PaymentRequirements};

/// Creates a payment payload using the "exact" scheme with ERC-3009 USDC authorization.
///
/// This implements the x402 "exact" payment scheme, which uses USDC's transferWithAuthorization
/// (ERC-3009) to create signed payment authorizations. The signature is created using ERC-1271
/// from a smart account via the OwnableValidator module.
pub async fn create_exact_payment(
    requirements: &PaymentRequirements,
    smart_account_address: Address,
    session_key_private_key: &str,
    chain_id: u64,
    validator_address: Address,
) -> Result<PaymentPayload, WalletError> {
    let now = chrono::Utc::now().timestamp() as u64;
    let valid_after = U256::from(now.saturating_sub(600)); // 10 minutes before
    let valid_before = U256::from(now + requirements.max_timeout_seconds);

    // Generate random nonce
    let nonce_bytes: [u8; 32] = rand::random();
    let nonce = FixedBytes::from(nonce_bytes);

    let pay_to: Address = requirements
        .pay_to
        .parse()
        .map_err(|_| WalletError::payment("Invalid payTo address"))?;

    let value = U256::from_str_radix(
        requirements
            .max_amount_required
            .strip_prefix("0x")
            .unwrap_or(&requirements.max_amount_required),
        if requirements.max_amount_required.starts_with("0x") {
            16
        } else {
            10
        },
    )
    .map_err(|_| WalletError::payment("Invalid payment amount"))?;

    let auth_data = ERC3009AuthorizationData {
        from: smart_account_address,
        to: pay_to,
        value,
        valid_after,
        valid_before,
        nonce,
    };

    // Get domain params from requirements.extra
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

    // Sign using ERC-1271 with OwnableValidator
    let signature = sign_erc3009_authorization(
        session_key_private_key,
        smart_account_address,
        &auth_data,
        asset_addr,
        chain_id,
        validator_address,
        domain_name,
        domain_version,
    )
    .await?;

    let sig_hex = format!("0x{}", hex::encode(&signature));

    let authorization = serde_json::json!({
        "from": format!("{smart_account_address}"),
        "to": format!("{pay_to}"),
        "value": requirements.max_amount_required,
        "validAfter": valid_after.to_string(),
        "validBefore": valid_before.to_string(),
        "nonce": format!("0x{}", hex::encode(nonce)),
    });

    let payload = serde_json::json!({
        "signature": sig_hex,
        "authorization": authorization,
    });

    Ok(PaymentPayload {
        x402_version: 1,
        scheme: "exact".to_string(),
        network: requirements.network.clone(),
        payload,
    })
}
