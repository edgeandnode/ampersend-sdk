"""Unit tests for co-signed smart account payment creation."""

from ampersend_sdk.smart_account import SmartAccountConfig
from ampersend_sdk.smart_account.constants import COSIGNER_VALIDATOR
from ampersend_sdk.x402.types import ERC3009AuthorizationData, ServerAuthorizationData
from ampersend_sdk.x402.wallets.smart_account.cosigned import (
    encode_cosigned_1271_signature,
    smart_account_create_cosigned_payment,
)
from ampersend_sdk.x402.wallets.smart_account.eip712_types import (
    EIP712_DOMAIN_FIELDS,
    TRANSFER_WITH_AUTHORIZATION_FIELDS,
)
from eth_abi.abi import decode as abi_decode
from eth_account import Account
from eth_account.messages import encode_typed_data
from eth_utils.conversions import to_hex
from x402_a2a import PaymentRequirements

# Deterministic test keys
AGENT_PRIVATE_KEY = "0x" + "aa" * 32
SERVER_PRIVATE_KEY = "0x" + "bb" * 32

SMART_ACCOUNT = "0x1234567890123456789012345678901234567890"
SELLER = "0x9876543210987654321098765432109876543210"
USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"


def _make_auth_data() -> ERC3009AuthorizationData:
    return ERC3009AuthorizationData.model_validate(
        {
            "from": SMART_ACCOUNT,
            "to": SELLER,
            "value": "1000000",
            "validAfter": "0",
            "validBefore": "9999999999",
            "nonce": "0x" + "00" * 32,
        },
        by_alias=True,
    )


def _make_server_authorization() -> ServerAuthorizationData:
    """Create a server authorization with a real server signature."""
    server_account = Account.from_key(SERVER_PRIVATE_KEY)

    auth_data = _make_auth_data()

    # Sign the EIP-712 typed data with the server key (same as what the API does)
    typed_data = {
        "types": {
            "EIP712Domain": EIP712_DOMAIN_FIELDS,
            "TransferWithAuthorization": TRANSFER_WITH_AUTHORIZATION_FIELDS,
        },
        "primaryType": "TransferWithAuthorization",
        "domain": {
            "name": "USDC",
            "version": "2",
            "chainId": 84532,
            "verifyingContract": USDC_ADDRESS,
        },
        "message": auth_data.model_dump(by_alias=True),
    }

    signable = encode_typed_data(full_message=typed_data)
    signed = server_account.sign_message(signable)

    return ServerAuthorizationData.model_validate(
        {
            "authorizationData": auth_data.model_dump(by_alias=True),
            "serverSignature": to_hex(signed.signature),
        },
        by_alias=True,
    )


def _make_requirements() -> PaymentRequirements:
    return PaymentRequirements(
        scheme="exact",
        network="base-sepolia",
        max_amount_required="1000000",
        resource="http://example.com/api",
        description="Test payment",
        mime_type="application/json",
        pay_to=SELLER,
        max_timeout_seconds=60,
        asset=USDC_ADDRESS,
        extra={"name": "USDC", "version": "2"},
    )


class TestEncodeCosigned1271Signature:
    """Test co-signed ERC-1271 signature encoding."""

    def test_signature_starts_with_validator_address(self) -> None:
        """The first 20 bytes should be the validator address."""
        agent_sig = bytes([1] * 65)
        server_sig = bytes([2] * 65)

        result = encode_cosigned_1271_signature(
            COSIGNER_VALIDATOR, agent_sig, server_sig
        )

        assert result.startswith("0x")
        result_bytes = bytes.fromhex(result[2:])

        # First 20 bytes = validator address
        assert to_hex(result_bytes[:20]) == COSIGNER_VALIDATOR.lower()

    def test_abi_encoded_signatures_can_be_decoded(self) -> None:
        """The bytes after the validator prefix should ABI-decode to (bytes, bytes)."""
        agent_sig = bytes(range(65))
        server_sig = bytes(range(65, 130))

        result = encode_cosigned_1271_signature(
            COSIGNER_VALIDATOR, agent_sig, server_sig
        )

        result_bytes = bytes.fromhex(result[2:])
        # Skip 20-byte validator prefix, decode the rest
        decoded_agent, decoded_server = abi_decode(
            ["bytes", "bytes"], result_bytes[20:]
        )

        assert decoded_agent == agent_sig
        assert decoded_server == server_sig

    def test_different_validator_address(self) -> None:
        """Should work with any validator address."""
        custom_validator = "0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF"
        agent_sig = bytes([0xAA] * 65)
        server_sig = bytes([0xBB] * 65)

        result = encode_cosigned_1271_signature(custom_validator, agent_sig, server_sig)

        result_bytes = bytes.fromhex(result[2:])
        assert to_hex(result_bytes[:20]) == custom_validator.lower()


class TestSmartAccountCreateCosignedPayment:
    """Test co-signed payment payload creation."""

    def test_returns_exact_scheme_payload(self) -> None:
        """Payment payload should have scheme=exact and x402_version=1."""
        config = SmartAccountConfig(
            session_key=AGENT_PRIVATE_KEY,
            smart_account_address=SMART_ACCOUNT,
        )

        payment = smart_account_create_cosigned_payment(
            requirements=_make_requirements(),
            config=config,
            server_authorization=_make_server_authorization(),
        )

        assert payment.scheme == "exact"
        assert payment.x402_version == 1
        assert payment.network == "base-sepolia"

    def test_uses_server_authorization_data(self) -> None:
        """The authorization in the payload should match server-provided data."""
        config = SmartAccountConfig(
            session_key=AGENT_PRIVATE_KEY,
            smart_account_address=SMART_ACCOUNT,
        )

        server_auth = _make_server_authorization()
        payment = smart_account_create_cosigned_payment(
            requirements=_make_requirements(),
            config=config,
            server_authorization=server_auth,
        )

        auth = payment.payload.authorization
        assert auth.from_ == SMART_ACCOUNT
        assert auth.to == SELLER
        assert auth.value == "1000000"
        assert auth.valid_after == "0"
        assert auth.valid_before == "9999999999"
        assert auth.nonce == "0x" + "00" * 32

    def test_signature_has_cosigner_validator_prefix(self) -> None:
        """The signature should be prefixed with the CoSignerValidator address."""
        config = SmartAccountConfig(
            session_key=AGENT_PRIVATE_KEY,
            smart_account_address=SMART_ACCOUNT,
        )

        payment = smart_account_create_cosigned_payment(
            requirements=_make_requirements(),
            config=config,
            server_authorization=_make_server_authorization(),
        )

        sig_bytes = bytes.fromhex(payment.payload.signature[2:])
        # First 20 bytes should be the CoSignerValidator address
        assert to_hex(sig_bytes[:20]) == COSIGNER_VALIDATOR.lower()

    def test_signature_contains_both_agent_and_server_sigs(self) -> None:
        """The ABI-encoded portion should decode to two 65-byte signatures."""
        config = SmartAccountConfig(
            session_key=AGENT_PRIVATE_KEY,
            smart_account_address=SMART_ACCOUNT,
        )

        payment = smart_account_create_cosigned_payment(
            requirements=_make_requirements(),
            config=config,
            server_authorization=_make_server_authorization(),
        )

        sig_bytes = bytes.fromhex(payment.payload.signature[2:])
        # Decode the ABI-encoded part (after 20-byte validator prefix)
        decoded_agent, decoded_server = abi_decode(["bytes", "bytes"], sig_bytes[20:])

        assert len(decoded_agent) == 65
        assert len(decoded_server) == 65

    def test_agent_signature_recovers_to_agent_address(self) -> None:
        """The agent signature should be verifiable against the agent's public key."""
        agent_account = Account.from_key(AGENT_PRIVATE_KEY)
        config = SmartAccountConfig(
            session_key=AGENT_PRIVATE_KEY,
            smart_account_address=SMART_ACCOUNT,
        )

        server_auth = _make_server_authorization()
        payment = smart_account_create_cosigned_payment(
            requirements=_make_requirements(),
            config=config,
            server_authorization=server_auth,
        )

        sig_bytes = bytes.fromhex(payment.payload.signature[2:])
        decoded_agent_sig, _ = abi_decode(["bytes", "bytes"], sig_bytes[20:])

        # Reconstruct the same typed data that was signed
        typed_data = {
            "types": {
                "EIP712Domain": EIP712_DOMAIN_FIELDS,
                "TransferWithAuthorization": TRANSFER_WITH_AUTHORIZATION_FIELDS,
            },
            "primaryType": "TransferWithAuthorization",
            "domain": {
                "name": "USDC",
                "version": "2",
                "chainId": 84532,
                "verifyingContract": USDC_ADDRESS,
            },
            "message": server_auth.authorization_data.model_dump(by_alias=True),
        }

        signable = encode_typed_data(full_message=typed_data)
        recovered = Account.recover_message(signable, signature=decoded_agent_sig)

        assert recovered.lower() == agent_account.address.lower()

    def test_rejects_non_exact_scheme(self) -> None:
        """Should raise ValueError for non-exact payment schemes."""
        config = SmartAccountConfig(
            session_key=AGENT_PRIVATE_KEY,
            smart_account_address=SMART_ACCOUNT,
        )

        requirements = _make_requirements()
        requirements.scheme = "deferred"

        try:
            smart_account_create_cosigned_payment(
                requirements=requirements,
                config=config,
                server_authorization=_make_server_authorization(),
            )
            assert False, "Should have raised ValueError"
        except ValueError as e:
            assert "Unsupported payment scheme" in str(e)

    def test_rejects_missing_extra(self) -> None:
        """Should raise ValueError when requirements.extra is missing."""
        config = SmartAccountConfig(
            session_key=AGENT_PRIVATE_KEY,
            smart_account_address=SMART_ACCOUNT,
        )

        requirements = _make_requirements()
        requirements.extra = None

        try:
            smart_account_create_cosigned_payment(
                requirements=requirements,
                config=config,
                server_authorization=_make_server_authorization(),
            )
            assert False, "Should have raised ValueError"
        except ValueError as e:
            assert "EIP-712 domain info" in str(e)
