"""Shared types for x402 payment authorization."""

from pydantic import BaseModel, ConfigDict, Field


class ERC3009AuthorizationData(BaseModel):
    """ERC-3009 TransferWithAuthorization data."""

    from_address: str = Field(
        alias="from", description="Sender address (agent smart account)"
    )
    to: str = Field(description="Recipient address (seller)")
    value: str = Field(description="Transfer amount in wei (stringified)")
    valid_after: str = Field(
        alias="validAfter", description="Unix timestamp after which valid (stringified)"
    )
    valid_before: str = Field(
        alias="validBefore",
        description="Unix timestamp before which expires (stringified)",
    )
    nonce: str = Field(description="Random 32-byte nonce as hex string")

    model_config = ConfigDict(
        populate_by_name=True,
    )


class ServerAuthorizationData(BaseModel):
    """Server co-signature data for co-signed agent keys."""

    authorization_data: ERC3009AuthorizationData = Field(
        alias="authorizationData", description="ERC-3009 authorization data"
    )
    server_signature: str = Field(
        alias="serverSignature",
        description="Server's ECDSA signature (65 bytes as hex)",
    )

    model_config = ConfigDict(
        populate_by_name=True,
    )
