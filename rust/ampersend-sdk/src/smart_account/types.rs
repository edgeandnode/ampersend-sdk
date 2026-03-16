use alloy_primitives::{Address, FixedBytes, U256};

/// ERC-3009 TransferWithAuthorization data structure.
/// Used for USDC transfers with smart accounts.
#[derive(Debug, Clone)]
pub struct ERC3009AuthorizationData {
    /// Address sending the funds
    pub from: Address,
    /// Address receiving the funds
    pub to: Address,
    /// Amount to transfer
    pub value: U256,
    /// Unix timestamp after which the authorization is valid
    pub valid_after: U256,
    /// Unix timestamp before which the authorization is valid
    pub valid_before: U256,
    /// Unique nonce for replay protection
    pub nonce: FixedBytes<32>,
}
