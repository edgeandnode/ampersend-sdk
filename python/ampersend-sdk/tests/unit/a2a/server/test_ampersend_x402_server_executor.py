"""Unit tests for AmpersendX402ServerExecutor.

Verifies that the executor:
  - Calls Ampersend's authorize-receipt endpoint with the right
    fields extracted from the payment payload.
  - On compliance allow, delegates to the facilitator's verify_payment.
  - On compliance deny, returns VerifyResponse(is_valid=False) with
    a deliberately generic invalid_reason and never calls the
    facilitator. The full deny detail (reason, code, screening_id)
    must NOT leak to the client — server-side audit only.
  - On compliance API error / timeout, the exception propagates so
    the upstream task layer 500s. Translating to a structured deny
    would silently swallow outages.
  - Settle is unchanged — always goes straight to the facilitator
    (a settlement for a payment that compliance already allowed).

These tests reach into `executor._facilitator` (a private attr on
the parent `FacilitatorX402ServerExecutor`) to mock the facilitator
client without standing up a real one. If the parent class renames
that attribute, these tests will hard-fail — accept the brittleness
in exchange for not restructuring the parent for testability.
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest
from ampersend_sdk.a2a.server import (
    AmpersendX402ServerExecutor,
    create_ampersend_executor_factory,
)
from ampersend_sdk.a2a.server.ampersend_x402_server_executor import (
    GENERIC_DENY_REASON,
)
from ampersend_sdk.ampersend import ApiClient, ApiError
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
        # Don't actually let the facilitator do anything — patch
        # through the parent's verify_payment via its private
        # _facilitator attribute (see the module docstring).
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

    async def test_verify_payment_returns_generic_deny_on_compliance_deny(
        self,
        mock_delegate: AgentExecutor,
        x402_config: x402ExtensionConfig,
    ) -> None:
        """A deny short-circuits with a deliberately generic
        invalid_reason — the API's reason / reason_code / screening_id
        must NOT be echoed to the client. Telling a sanctioned wallet
        the category that flagged it lets them wallet-shop or feel out
        thresholds. The facilitator is never consulted on deny."""
        api_client = AsyncMock(spec=ApiClient)
        # API returns rich detail. The executor must drop it.
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
        assert result.invalid_reason == GENERIC_DENY_REASON
        # No-leak: every detail field from the API must be absent
        # from the visible response. Anchored on absence so a future
        # refactor that adds a leak surface (e.g., new reason field)
        # has to actively decide whether to expose it.
        assert "Sanctions" not in (result.invalid_reason or "")
        assert "compliance_high_risk" not in (result.invalid_reason or "")
        # screening_id appears in audit logs only.
        assert "00000000-0000-0000-0000-000000000002" not in (
            result.invalid_reason or ""
        )
        # `payer` is echoed (unverified, for client-side error display).
        assert result.payer == "0xPayer000000000000000000000000000000000001"

        # Facilitator never consulted on deny.
        executor._facilitator.verify.assert_not_awaited()

    async def test_verify_payment_uses_generic_deny_when_reason_missing(
        self,
        mock_delegate: AgentExecutor,
        x402_config: x402ExtensionConfig,
    ) -> None:
        """Same generic deny posture even when the API returns a deny
        with no reason. invalid_reason is always the constant — we
        don't differentiate between "deny with detail" and "deny
        without"."""
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
        assert result.invalid_reason == GENERIC_DENY_REASON

    async def test_verify_payment_propagates_api_error(
        self,
        mock_delegate: AgentExecutor,
        x402_config: x402ExtensionConfig,
    ) -> None:
        """A compliance API failure (5xx, auth failure, malformed
        response) propagates as an exception rather than being
        swallowed as a structured deny. Pinning this contract — the
        docstring says so, and a future "improvement" that wraps the
        call in `try/except: return deny(...)` would silently invert
        fail-closed-by-exception into fail-closed-by-deny, which
        looks the same to the buyer but masks the API outage from
        operators."""
        api_client = AsyncMock(spec=ApiClient)
        api_client.authorize_receipt = AsyncMock(
            side_effect=ApiError("Compliance API 503", status=503)
        )

        executor = AmpersendX402ServerExecutor(
            delegate=mock_delegate,
            config=x402_config,
            api_client=api_client,
        )
        executor._facilitator = MagicMock()
        executor._facilitator.verify = AsyncMock()

        with pytest.raises(ApiError):
            await executor.verify_payment(
                _make_payment_payload(), _make_payment_requirements()
            )
        # And the facilitator must not be touched on the error path.
        executor._facilitator.verify.assert_not_awaited()

    async def test_verify_payment_propagates_compliance_timeout(
        self,
        mock_delegate: AgentExecutor,
        x402_config: x402ExtensionConfig,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """If the compliance call hangs past the timeout budget, the
        `asyncio.TimeoutError` propagates out — same posture as any
        other transport failure (the upstream task layer 500s rather
        than masking the outage as a deny)."""

        async def hang(*args: object, **kwargs: object) -> None:
            await asyncio.sleep(60)

        api_client = AsyncMock(spec=ApiClient)
        api_client.authorize_receipt = AsyncMock(side_effect=hang)

        # Compress the timeout so the test runs in milliseconds.
        from ampersend_sdk.a2a.server import ampersend_x402_server_executor as mod

        monkeypatch.setattr(mod, "COMPLIANCE_API_TIMEOUT_SECONDS", 0.05)

        executor = AmpersendX402ServerExecutor(
            delegate=mock_delegate,
            config=x402_config,
            api_client=api_client,
        )
        executor._facilitator = MagicMock()
        executor._facilitator.verify = AsyncMock()

        with pytest.raises(asyncio.TimeoutError):
            await executor.verify_payment(
                _make_payment_payload(), _make_payment_requirements()
            )
        executor._facilitator.verify.assert_not_awaited()

    async def test_verify_payment_rejects_unsupported_scheme(
        self,
        mock_delegate: AgentExecutor,
        x402_config: x402ExtensionConfig,
    ) -> None:
        """If the payload isn't an `ExactPaymentPayload` (today the
        only x402 scheme that carries an EIP-3009 authorization), the
        executor returns a structured deny rather than crashing on
        attribute access. Future schemes would need their own field
        extraction in this method."""
        api_client = AsyncMock(spec=ApiClient)
        api_client.authorize_receipt = AsyncMock()

        executor = AmpersendX402ServerExecutor(
            delegate=mock_delegate,
            config=x402_config,
            api_client=api_client,
        )

        # Construct a PaymentPayload whose `payload` is not the
        # exact-scheme variant. Use a MagicMock so attribute access
        # would succeed if the guard wasn't there — that way a
        # missing guard would surface as a different failure
        # (compliance call with bogus args), not as the test passing.
        payload = MagicMock(spec=PaymentPayload)
        payload.payload = MagicMock()  # not an ExactPaymentPayload

        result = await executor.verify_payment(payload, _make_payment_requirements())

        assert result.is_valid is False
        assert result.invalid_reason == "Unsupported payment scheme"
        assert result.payer is None
        # Compliance API should never be called for an unsupported scheme.
        api_client.authorize_receipt.assert_not_awaited()

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
