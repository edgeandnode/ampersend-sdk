use std::borrow::Cow;

use alloy_primitives::{Address, Bytes, FixedBytes, U256};
use alloy_signer::Signer;
use alloy_signer_local::PrivateKeySigner;
use alloy_sol_types::Eip712Domain;

use super::types::ERC3009AuthorizationData;
use crate::error::WalletError;

/// Generic smart account typed data signing with OwnableValidator.
///
/// Signs EIP-712 typed data using a session key, then wraps it for
/// OwnableValidator (ERC-7579) and ERC-1271 validation by the smart account.
pub async fn sign_smart_account_typed_data(
    session_key_private_key: &str,
    smart_account_address: Address,
    signing_hash: FixedBytes<32>,
    validator_address: Address,
) -> Result<Bytes, WalletError> {
    let key = session_key_private_key
        .strip_prefix("0x")
        .unwrap_or(session_key_private_key);
    let key_bytes: FixedBytes<32> = key
        .parse()
        .map_err(|e| WalletError::payment(format!("Invalid session key: {e}")))?;
    let signer = PrivateKeySigner::from_bytes(&key_bytes)
        .map_err(|e| WalletError::payment(format!("Invalid session key: {e}")))?;

    // 1. Sign with the session key (EOA signature)
    let eoa_signature = signer
        .sign_hash(&signing_hash)
        .await
        .map_err(|e| WalletError::payment_with_source("Failed to sign typed data", e))?;

    let eoa_sig_bytes = eoa_signature.as_bytes();

    // 2. Format for OwnableValidator (threshold = 1, so single signature)
    let validator_signature = Bytes::from(eoa_sig_bytes.to_vec());

    // 3. Encode for ERC-1271 validation by smart account
    let encoded = encode_1271_signature(
        smart_account_address,
        validator_address,
        &validator_signature,
    );

    Ok(encoded)
}

/// Encode a signature for ERC-1271 validation.
fn encode_1271_signature(
    _smart_account_address: Address,
    validator_address: Address,
    validator_signature: &Bytes,
) -> Bytes {
    let mut encoded = Vec::with_capacity(20 + validator_signature.len());
    encoded.extend_from_slice(validator_address.as_slice());
    encoded.extend_from_slice(validator_signature);
    Bytes::from(encoded)
}

/// Sign ERC-3009 TransferWithAuthorization for USDC payments.
///
/// Creates a signature that allows a smart account to authorize USDC transfers
/// using the ERC-3009 standard (gasless transfers with authorization).
#[allow(clippy::too_many_arguments)]
pub async fn sign_erc3009_authorization(
    session_key_private_key: &str,
    smart_account_address: Address,
    auth_data: &ERC3009AuthorizationData,
    token_address: Address,
    chain_id: u64,
    validator_address: Address,
    domain_name: &str,
    domain_version: &str,
) -> Result<Bytes, WalletError> {
    // Build EIP-712 domain manually to avoid lifetime issues with the macro
    let domain = Eip712Domain {
        name: Some(Cow::Owned(domain_name.to_string())),
        version: Some(Cow::Owned(domain_version.to_string())),
        chain_id: Some(U256::from(chain_id)),
        verifying_contract: Some(token_address),
        salt: None,
    };

    // Define the ERC-3009 struct for signing
    alloy_sol_types::sol! {
        struct TransferWithAuthorization {
            address from;
            address to;
            uint256 value;
            uint256 validAfter;
            uint256 validBefore;
            bytes32 nonce;
        }
    }

    let message = TransferWithAuthorization {
        from: auth_data.from,
        to: auth_data.to,
        value: auth_data.value,
        validAfter: auth_data.valid_after,
        validBefore: auth_data.valid_before,
        nonce: auth_data.nonce,
    };

    let signing_hash = alloy_sol_types::SolStruct::eip712_signing_hash(&message, &domain);

    sign_smart_account_typed_data(
        session_key_private_key,
        smart_account_address,
        signing_hash,
        validator_address,
    )
    .await
}
