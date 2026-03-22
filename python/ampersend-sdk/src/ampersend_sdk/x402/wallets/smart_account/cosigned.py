"""
Co-signed payment creation for smart accounts.

This module provides functions to create payment payloads using server co-signatures
for enhanced security. The server provides the ERC-3009 authorization data and its
signature, and the agent adds its signature to complete the dual-signature requirement.
"""

from typing import cast

from eth_abi.abi import encode as abi_encode
from eth_account import Account
from eth_account.messages import encode_typed_data
from eth_utils.conversions import to_bytes, to_hex
from x402.chains import get_chain_id
from x402_a2a import PaymentPayload, PaymentRequirements
from x402_a2a.types import EIP3009Authorization, ExactPaymentPayload

from ....smart_account.sign import SmartAccountConfig
from ...types import ServerAuthorizationData
from .eip712_types import EIP712_DOMAIN_FIELDS, TRANSFER_WITH_AUTHORIZATION_FIELDS


def encode_cosigned_1271_signature(
    cosigner_validator_address: str,
    agent_signature: bytes,
    server_signature: bytes,
) -> str:
    """
    Encode a co-signed ERC-1271 signature.

    Combines agent signature + server signature according to CoSignerValidator format:
    1. ABI encode as (bytes agentSig, bytes serverSig)
    2. Prefix with validator address for ERC-1271

    Args:
        cosigner_validator_address: CoSignerValidator contract address
        agent_signature: Agent's ECDSA signature (65 bytes)
        server_signature: Server's ECDSA signature (65 bytes)

    Returns:
        ERC-1271 formatted signature as hex string
    """
    # ABI encode the two signatures as (bytes, bytes)
    combined = abi_encode(["bytes", "bytes"], [agent_signature, server_signature])

    # Prefix with validator address
    validator_bytes = to_bytes(hexstr=cosigner_validator_address)

    return cast(str, to_hex(validator_bytes + combined))


def smart_account_create_cosigned_payment(
    requirements: PaymentRequirements,
    config: SmartAccountConfig,
    server_authorization: ServerAuthorizationData,
) -> PaymentPayload:
    """
    Create a payment payload using server co-signature.

    This is used for co-signed agent keys where the server provides the ERC-3009
    authorization data and co-signature. The agent key adds its signature and
    combines them for ERC-1271 validation via CoSignerValidator.

    Args:
        requirements: Payment requirements from x402 server
        config: Smart account configuration
        server_authorization: Server-provided authorization data and co-signature

    Returns:
        PaymentPayload ready to submit to x402 server

    Raises:
        ValueError: If unsupported payment scheme or missing required data
    """
    if requirements.scheme != "exact":
        raise ValueError(f"Unsupported payment scheme: {requirements.scheme}")

    auth_data = server_authorization.authorization_data

    # Validate requirements have EIP-712 domain info
    if not requirements.extra:
        raise ValueError("requirements.extra must contain EIP-712 domain info")

    domain_name = requirements.extra.get("name")
    domain_version = requirements.extra.get("version")

    if not domain_name or not domain_version:
        raise ValueError(
            "requirements.extra must contain 'name' and 'version' for EIP-712 domain"
        )

    # Construct authorization using model_validate (same as exact.py)
    authorization = EIP3009Authorization.model_validate(
        {
            "from": auth_data.from_address,
            "to": auth_data.to,
            "value": auth_data.value,
            "validAfter": auth_data.valid_after,
            "validBefore": auth_data.valid_before,
            "nonce": auth_data.nonce,
        },
        by_alias=True,
    )

    # Create account from session key
    account = Account.from_key(config.session_key)

    # Build EIP-712 typed data using model_dump(by_alias=True) for correct field names
    typed_data = {
        "types": {
            "EIP712Domain": EIP712_DOMAIN_FIELDS,
            "TransferWithAuthorization": TRANSFER_WITH_AUTHORIZATION_FIELDS,
        },
        "primaryType": "TransferWithAuthorization",
        "domain": {
            "name": domain_name,
            "version": domain_version,
            "chainId": get_chain_id(requirements.network),
            "verifyingContract": requirements.asset,
        },
        "message": authorization.model_dump(by_alias=True),
    }

    # Sign with agent key
    signable = encode_typed_data(full_message=typed_data)
    signed = account.sign_message(signable)
    agent_sig = signed.signature

    # Decode server signature from hex
    server_sig = to_bytes(hexstr=server_authorization.server_signature)

    # Validate coSignerValidatorAddress is present
    if not config.cosigner_validator_address:
        raise ValueError(
            "config.cosigner_validator_address required for co-signed payments"
        )

    # Encode for ERC-1271
    signature = encode_cosigned_1271_signature(
        config.cosigner_validator_address,
        agent_sig,
        server_sig,
    )

    # Construct payload
    exact_payload = ExactPaymentPayload(
        signature=signature,
        authorization=authorization,
    )

    return PaymentPayload(
        x402_version=1,
        scheme="exact",
        network=requirements.network,
        payload=exact_payload,
    )
