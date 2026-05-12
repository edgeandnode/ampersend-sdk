"""x402 server executor that gates payments through the Ampersend
compliance API before delegating to the facilitator.

The executor wraps `FacilitatorX402ServerExecutor`. On `verify_payment`
it first calls Ampersend's `POST /v1/agents/:address/payment/authorize-
receipt` over a SIWE-authenticated bearer token; if compliance denies,
it returns a `VerifyResponse` with `is_valid=False` and a deliberately
generic `invalid_reason`. If compliance allows, it delegates to the
facilitator's verify path so on-chain settlement still happens via the
configured facilitator.

Settlement is unchanged — it still goes straight to the facilitator
because by the time we settle, the gate has already approved. Note: a
future deferred-scheme settlement (arbitrary delay between verify and
settle) would invalidate this assumption and require a settle-time
re-screen; today's `exact` scheme settles within the same x402
round-trip so the existing approval is fresh.

## Shared with the FastAPI middleware

- **Compliance-deny posture**: deliberately generic `invalid_reason`
  ("Payment rejected"). The full detail (reason, code, screening_id,
  payer) is logged at WARNING server-side; never echoed to the
  caller. See `GENERIC_DENY_REASON`.
- **Timeout**: 5s on `authorize_receipt`, env-overridable via
  `AMPERSEND_COMPLIANCE_API_TIMEOUT_SECONDS`.

## Deliberate asymmetry with the FastAPI middleware — fail-closed

On compliance API outage / timeout / `ApiError`, this executor
**lets the exception propagate** out of `verify_payment` so the
upstream task layer surfaces a 500 to the agent caller. The FastAPI
middleware **catches** the same exceptions and returns the generic
403 instead. The two surfaces fail closed differently by design:

- A2A clients are first-party agents with programmatic error
  handling; surfacing an outage as an exception is the right
  operator signal. Translating to a structured deny would silently
  swallow outages from the agent's monitoring.
- HTTP buyers are CLI/curl/Python clients with poor error semantics;
  a 500 invites blind retry under outage. The 403 deny posture
  short-circuits the buyer's payment loop cleanly.

If you need the FastAPI catch-and-return-deny shape on the A2A side
(e.g., behind a service mesh with automatic retry), wrap the
executor with your own try/except and convert as needed. Don't
modify this default — it carries operator signal that consumers
rely on.
"""

import asyncio
import logging
import os
from typing import Any

from x402.types import (
    ExactPaymentPayload,
)
from x402_a2a import (
    FacilitatorConfig,
    x402ExtensionConfig,
)
from x402_a2a.types import (
    AgentExecutor,
    PaymentPayload,
    PaymentRequirements,
    VerifyResponse,
)

from ...ampersend.client import ApiClient
from .facilitator_x402_server_executor import FacilitatorX402ServerExecutor
from .x402_server_executor import X402ServerExecutorFactory

logger = logging.getLogger(__name__)

# Hard timeout on the compliance API call. Without this, a hung
# Ampersend API takes every paid verify with it until upstream
# transport limits cut. 5s is comfortable for a local API, an SSH
# tunnel, and a tailscale-routed staging API; bump via
# AMPERSEND_COMPLIANCE_API_TIMEOUT_SECONDS if real-world latency
# floors creep up. Same posture/value as the FastAPI middleware in
# `ampersend_sdk.x402.http.fastapi`.
COMPLIANCE_API_TIMEOUT_SECONDS = float(
    os.environ.get("AMPERSEND_COMPLIANCE_API_TIMEOUT_SECONDS", "5.0")
)

# Generic deny shown to the buyer. The full detail (reason,
# reason_code, screening_id, payer) is logged server-side so the
# operator has the audit trail without leaking it to the buyer —
# telling a sanctioned wallet which category flagged it lets them
# wallet-shop or feel out our thresholds.
GENERIC_DENY_REASON = "Payment rejected"


class AmpersendX402ServerExecutor(FacilitatorX402ServerExecutor):
    """Compliance-gated x402 server executor.

    Args:
        delegate: The wrapped agent executor (handles the underlying
            request once payment is verified).
        config: x402 extension config (passed through to the base
            executor).
        api_client: An Ampersend `ApiClient` configured with the
            seller agent's address and session-key private key. The
            client's SIWE flow runs lazily on first `authorize_receipt`
            call. Re-uses the client used by the buyer side for
            agents that both buy and sell.
        facilitator_config: Optional facilitator config for the
            verify/settle delegation.
    """

    def __init__(
        self,
        *,
        delegate: AgentExecutor,
        config: x402ExtensionConfig,
        api_client: ApiClient,
        facilitator_config: FacilitatorConfig | None = None,
        **kwargs: Any,
    ):
        super().__init__(
            delegate=delegate,
            config=config,
            facilitator_config=facilitator_config,
            **kwargs,
        )
        self._api_client = api_client

    async def verify_payment(
        self, payload: PaymentPayload, requirements: PaymentRequirements
    ) -> VerifyResponse:
        """Compliance-gate the payment, then delegate to the facilitator.

        On compliance deny, returns
        `VerifyResponse(is_valid=False, invalid_reason="Payment rejected")`
        and never consults the facilitator. The deny reason is
        deliberately generic — see `GENERIC_DENY_REASON`. On allow,
        falls through to the facilitator's normal verify (signature,
        amount, nonce reuse, etc.).

        Failure modes:
          - Unsupported payment scheme: returns a structured deny.
            We require ExactPaymentPayload because the compliance
            call needs the EIP-3009 `authorization` block; future
            schemes would need their own extraction logic.
          - Compliance API error (network, auth failure, 5xx): the
            underlying `ApiError` propagates out of this method by
            design. Translating to a structured deny would silently
            swallow outages; surfacing as an exception lets the
            upstream task layer 500 / alert. This is fail-closed
            as a class — a deny because we can't reach the gate —
            just at a different layer than a structured deny.
          - Compliance API timeout: same posture as a transport
            failure — the `asyncio.TimeoutError` propagates out and
            the upstream task layer 500s. Without the timeout, a
            hung API would hang every verify.

        Note on the `payer` field: on a deny, we echo back
        `authorization.from_` *unverified*. The EIP-3009 signature
        is checked only after compliance allows and control passes
        to the facilitator. The field is intended for client-side
        error reporting (the buyer sees back the address they
        claimed to pay from), not as an authenticated identity.
        """
        # PaymentPayload.payload is scheme-specific. We only support
        # `exact` today (the only x402 scheme that ships
        # signed-EIP-3009 authorizations); a future scheme would
        # need its own field extraction. Guard against an
        # AttributeError on .authorization that would otherwise
        # crash before the compliance call even runs.
        if not isinstance(payload.payload, ExactPaymentPayload):
            return VerifyResponse(
                isValid=False,
                invalidReason="Unsupported payment scheme",
                payer=None,
            )

        # EIP3009Authorization.from_ uses an underscore because
        # `from` is a Python keyword; the field's wire alias is "from".
        authorization = payload.payload.authorization
        compliance_result = await asyncio.wait_for(
            self._api_client.authorize_receipt(
                payer_address=authorization.from_,
                payment_requirements=requirements,
                nonce=authorization.nonce,
                payment_signature=payload.payload.signature,
            ),
            timeout=COMPLIANCE_API_TIMEOUT_SECONDS,
        )

        if not compliance_result.authorized:
            # Operator-side audit trail — the buyer gets the generic
            # deny string; the full detail (incl. screening_id for
            # support-ticket correlation) stays server-side. Mirrors
            # the FastAPI middleware's logging shape so a single
            # log query catches denies across both surfaces. WARNING
            # (not INFO) because compliance denies are unusual events
            # worth surfacing in default log filters and alerting.
            logger.warning(
                "Compliance denied payment",
                extra={
                    "payer_address": authorization.from_,
                    "reason_code": compliance_result.reason_code,
                    "reason": compliance_result.reason,
                    "screening_id": compliance_result.screening_id,
                },
            )
            return VerifyResponse(
                isValid=False,
                invalidReason=GENERIC_DENY_REASON,
                payer=authorization.from_,
            )

        # Compliance allowed — delegate to the facilitator for the
        # standard x402 signature/amount/nonce checks.
        return await super().verify_payment(payload, requirements)


def create_ampersend_executor_factory(
    api_client: ApiClient,
    facilitator_config: FacilitatorConfig | None = None,
) -> X402ServerExecutorFactory:
    """Create a factory for `AmpersendX402ServerExecutor` instances.

    Args:
        api_client: The Ampersend API client (configured with the
            seller agent's address + session-key private key).
        facilitator_config: Optional facilitator configuration.

    Returns:
        Factory function suitable for `X402A2aAgentExecutor.x402_executor_factory`.

    Example:
        >>> from ampersend_sdk.ampersend import ApiClient, ApiClientOptions
        >>> client = ApiClient(ApiClientOptions(
        ...     base_url="https://api.staging.ampersend.ai",
        ...     agent_address="0x...",
        ...     session_key_private_key="0x...",
        ... ))
        >>> factory = create_ampersend_executor_factory(
        ...     api_client=client,
        ...     facilitator_config=FacilitatorConfig(
        ...         url="https://facilitator.example.com"
        ...     ),
        ... )
    """

    def factory(
        *,
        delegate: AgentExecutor,
        config: x402ExtensionConfig,
    ) -> AmpersendX402ServerExecutor:
        return AmpersendX402ServerExecutor(
            delegate=delegate,
            config=config,
            api_client=api_client,
            facilitator_config=facilitator_config,
        )

    return factory
