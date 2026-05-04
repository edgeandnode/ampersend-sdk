"""Unit tests for AmpersendX402ServerExecutor.

Verifies that the executor:
  - Calls Ampersend's authorize-receipt endpoint with the right
    fields extracted from the payment payload.
  - On compliance allow, delegates to the facilitator's verify_payment.
  - On compliance deny, returns VerifyResponse(is_valid=False) with
    the reason carried through; does NOT call the facilitator.
  - Settle is unchanged — always goes straight to the facilitator
    (a settlement for a payment that compliance already allowed).
"""

from unittest.mock import AsyncMock, MagicMock

import pytest
from ampersend_sdk.a2a.server import (
    AmpersendX402ServerExecutor,
    create_ampersend_executor_factory,
)
from ampersend_sdk.ampersend import ApiClient
from ampersend_sdk.ampersend.types import ApiResponseAuthorizeReceipt
from x402.types import (
    EIP3009Authorization,
    ExactPaymentPayload,
    PaymentPayload,
    PaymentRequirements,
    SettleResponse,
    VerifyResponse,
)
from x402_a2a.types import (
    AgentExecutor,
    x402ExtensionConfig,
)


def _make_payment_payload() -> PaymentPayload:
    """Standard fixture — a signed EIP-3009 transfer authorization."""
    # `from` is reserved in Python, so we pass it via the pydantic
    # alias using dict-spread. The field is declared as
    # `from_: str = Field(alias="from")` in x402.types and the
    # pydantic-mypy plugin types only the alias.
    return PaymentPayload(
        x402_version=1,
        scheme="exact",
        network="base-sepolia",
        payload=ExactPaymentPayload(
            signature="0x" + "ab" * 65,
            authorization=EIP3009Authorization(
                **{"from": "0xPayer000000000000000000000000000000000001"},
                to="0xSeller00000000000000000000000000000000000",
                value="10000",
                valid_after="0",
                valid_before="9999999999",
                nonce="0x" + "cd" * 32,
            ),
        ),
    )


def _make_payment_requirements() -> PaymentRequirements:
    return PaymentRequirements(
        scheme="exact",
        network="base-sepolia",
        max_amount_required="10000",
        resource="https://insights.demo/insight",
        description="Test insight",
        mime_type="application/json",
        pay_to="0xSeller00000000000000000000000000000000000",
        max_timeout_seconds=60,
        asset="0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    )


@pytest.fixture
def mock_delegate() -> AgentExecutor:
    return MagicMock(spec=AgentExecutor)


@pytest.fixture
def x402_config() -> x402ExtensionConfig:
    return MagicMock(spec=x402ExtensionConfig)


@pytest.mark.asyncio
class TestAmpersendX402ServerExecutor:
    async def test_verify_payment_forwards_payload_fields_to_authorize_receipt(
        self,
        mock_delegate: AgentExecutor,
        x402_config: x402ExtensionConfig,
    ) -> None:
        """The executor pulls payerAddress, nonce, and signature out of
        the typed PaymentPayload and forwards them to the API."""
        api_client = AsyncMock(spec=ApiClient)
        api_client.authorize_receipt = AsyncMock(
            return_value=ApiResponseAuthorizeReceipt(
                authorized=True,
                screening_id="00000000-0000-0000-0000-000000000001",
            )
        )

        executor = AmpersendX402ServerExecutor(
            delegate=mock_delegate,
            config=x402_config,
            api_client=api_client,
        )
        # Don't actually let the facilitator do anything — patch through
        # the parent's verify_payment.
        executor._facilitator = MagicMock()
        executor._facilitator.verify = AsyncMock(
            return_value=VerifyResponse(
                isValid=True,
                invalidReason=None,
                payer="0xPayer000000000000000000000000000000000001",
            )
        )

        payload = _make_payment_payload()
        requirements = _make_payment_requirements()

        result = await executor.verify_payment(payload, requirements)

        api_client.authorize_receipt.assert_awaited_once()
        call_kwargs = api_client.authorize_receipt.call_args.kwargs
        assert (
            call_kwargs["payer_address"]
            == "0xPayer000000000000000000000000000000000001"
        )
        assert call_kwargs["nonce"] == "0x" + "cd" * 32
        assert call_kwargs["payment_signature"] == "0x" + "ab" * 65
        assert call_kwargs["payment_requirements"] is requirements

        # On allow, the facilitator's verify is called.
        executor._facilitator.verify.assert_awaited_once_with(payload, requirements)
        assert result.is_valid is True

    async def test_verify_payment_returns_invalid_on_compliance_deny(
        self,
        mock_delegate: AgentExecutor,
        x402_config: x402ExtensionConfig,
    ) -> None:
        """A deny from the API short-circuits — returns
        VerifyResponse(is_valid=False) with the human-readable reason
        and never calls the facilitator."""
        api_client = AsyncMock(spec=ApiClient)
        api_client.authorize_receipt = AsyncMock(
            return_value=ApiResponseAuthorizeReceipt(
                authorized=False,
                reason="Sanctions (Severe) exposure on 0xPayer...",
                reason_code="compliance_high_risk",
                screening_id="00000000-0000-0000-0000-000000000002",
            )
        )

        executor = AmpersendX402ServerExecutor(
            delegate=mock_delegate,
            config=x402_config,
            api_client=api_client,
        )
        executor._facilitator = MagicMock()
        executor._facilitator.verify = AsyncMock()

        result = await executor.verify_payment(
            _make_payment_payload(), _make_payment_requirements()
        )

        assert result.is_valid is False
        assert "Sanctions" in (result.invalid_reason or "")
        assert result.payer == "0xPayer000000000000000000000000000000000001"

        # Facilitator never consulted on deny.
        executor._facilitator.verify.assert_not_awaited()

    async def test_verify_payment_falls_back_when_reason_missing(
        self,
        mock_delegate: AgentExecutor,
        x402_config: x402ExtensionConfig,
    ) -> None:
        """If the API somehow returns authorized=False with no reason,
        the executor falls back to a generic message rather than
        leaving invalidReason as None (which downstream consumers may
        not handle gracefully)."""
        api_client = AsyncMock(spec=ApiClient)
        api_client.authorize_receipt = AsyncMock(
            return_value=ApiResponseAuthorizeReceipt(authorized=False)
        )

        executor = AmpersendX402ServerExecutor(
            delegate=mock_delegate,
            config=x402_config,
            api_client=api_client,
        )

        result = await executor.verify_payment(
            _make_payment_payload(), _make_payment_requirements()
        )
        assert result.is_valid is False
        assert result.invalid_reason == "Payment denied by compliance"

    async def test_settle_payment_delegates_to_facilitator(
        self,
        mock_delegate: AgentExecutor,
        x402_config: x402ExtensionConfig,
    ) -> None:
        """Settlement is unchanged — it goes straight to the
        facilitator regardless of whether the executor is the
        Ampersend variant. Compliance was already approved at verify
        time."""
        api_client = AsyncMock(spec=ApiClient)
        executor = AmpersendX402ServerExecutor(
            delegate=mock_delegate,
            config=x402_config,
            api_client=api_client,
        )

        payload = _make_payment_payload()
        requirements = _make_payment_requirements()
        executor._facilitator = MagicMock()
        expected = SettleResponse(
            success=True, transaction="0xtxhash", network="base-sepolia"
        )
        executor._facilitator.settle = AsyncMock(return_value=expected)

        result = await executor.settle_payment(payload, requirements)

        executor._facilitator.settle.assert_awaited_once_with(payload, requirements)
        assert result is expected
        # Compliance API not called during settle.
        api_client.authorize_receipt.assert_not_awaited()


def test_factory_constructs_executor_with_api_client(
    mock_delegate: AgentExecutor,
    x402_config: x402ExtensionConfig,
) -> None:
    """The factory threads the api_client through to the executor and
    matches the X402ServerExecutorFactory protocol."""
    api_client = MagicMock(spec=ApiClient)
    factory = create_ampersend_executor_factory(api_client=api_client)
    executor = factory(delegate=mock_delegate, config=x402_config)
    assert isinstance(executor, AmpersendX402ServerExecutor)
    assert executor._api_client is api_client
