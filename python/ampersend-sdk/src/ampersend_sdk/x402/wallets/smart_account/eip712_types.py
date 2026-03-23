"""Shared EIP-712 type definitions for ERC-3009 TransferWithAuthorization."""

# EIP-712 domain fields (standard across all EIP-712 signatures)
EIP712_DOMAIN_FIELDS = [
    {"name": "name", "type": "string"},
    {"name": "version", "type": "string"},
    {"name": "chainId", "type": "uint256"},
    {"name": "verifyingContract", "type": "address"},
]

# ERC-3009 TransferWithAuthorization message fields
TRANSFER_WITH_AUTHORIZATION_FIELDS = [
    {"name": "from", "type": "address"},
    {"name": "to", "type": "address"},
    {"name": "value", "type": "uint256"},
    {"name": "validAfter", "type": "uint256"},
    {"name": "validBefore", "type": "uint256"},
    {"name": "nonce", "type": "bytes32"},
]
