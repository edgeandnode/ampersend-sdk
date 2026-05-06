"""FastAPI middleware that gates incoming x402 payments through the
Ampersend compliance API.

This is the seller-side HTTP counterpart to `AmpersendX402ServerExecutor`
(in `ampersend_sdk.a2a.server`), and a slim variant of upstream
`x402.fastapi.require_payment` — same overall flow (advertise
PaymentRequirements on no-payment, decode X-PAYMENT, verify via
facilitator, run handler, settle) — with one extra step inserted right
after header decode and before facilitator verify: a call to Ampersend's
`POST /v1/agents/:address/payment/authorize-receipt` that runs TRM
screening on the payer wallet (and its ERC-8004 owner if registered).

The deny posture is shared with the A2A executor: a deliberately
generic 403 body (`{"error": "Payment rejected"}`), full detail logged
server-side. See `GENERIC_DENY_REASON` in
`ampersend_sdk.a2a.server.ampersend_x402_server_executor` for the
threat-model rationale.
"""

import asyncio
import base64
import json
import logging
import os
from typing import Any, Callable, Optional, cast, get_args

import httpx
from fastapi import Request
from fastapi.responses import JSONResponse
from x402.common import (
    find_matching_payment_requirements,
    process_price_to_atomic_amount,
    x402_VERSION,
)
from x402.encoding import safe_base64_decode
from x402.facilitator import FacilitatorClient, FacilitatorConfig
from x402.networks import SupportedNetworks
from x402.types import (
    HTTPInputSchema,
    PaymentPayload,
    PaymentRequirements,
    Price,
    x402PaymentRequiredResponse,
)

# Direct sub-module imports to avoid the circular path
# `ampersend_sdk.x402 → ampersend_sdk.ampersend.__init__ →
#   ampersend_sdk.ampersend.treasurer → ampersend_sdk.x402` that
# arises when `x402/http/__init__.py` re-exports this module.
from ...ampersend.client import ApiClient
from ...ampersend.types import ApiError

logger = logging.getLogger(__name__)

# Hard timeout on the compliance API call. The middleware fails
# closed if the API hangs — without this, every paid request hangs
# with it until uvicorn keepalive cuts. 5s is comfortable for a
# local API, an SSH tunnel, and a tailscale-routed staging API; bump
# via AMPERSEND_COMPLIANCE_API_TIMEOUT_SECONDS if real-world latency
# floors creep up. Same posture/value as the A2A executor in
# `ampersend_sdk.a2a.server.ampersend_x402_server_executor`.
COMPLIANCE_API_TIMEOUT_SECONDS = float(
    os.environ.get("AMPERSEND_COMPLIANCE_API_TIMEOUT_SECONDS", "5.0")
)


def require_payment_with_compliance(
    *,
    api_client: ApiClient,
    price: Price,
    pay_to_address: str,
    network: str = "base-sepolia",
    description: str = "",
    mime_type: str = "",
    max_deadline_seconds: int = 60,
    input_schema: Optional[HTTPInputSchema] = None,
    output_schema: Optional[Any] = None,
    facilitator_config: Optional[FacilitatorConfig] = None,
    resource: Optional[str] = None,
) -> Callable[[Request, Callable[[Request], Any]], Any]:
    """Generate a FastAPI middleware that compliance-gates payments
    before delegating to the standard x402 facilitator flow.

    Args:
        api_client: Ampersend `ApiClient` configured with the seller
            agent's address and session-key private key. Used to call
            `authorize_receipt`.
        price: Payment price (Money or TokenAmount).
        pay_to_address: Seller wallet address that receives the payment.
        network: Blockchain network (default `base-sepolia`).
        description: Human-readable description shown in 402 responses.
        mime_type: MIME type of the resource.
        max_deadline_seconds: Maximum time allowed for payment.
        input_schema: Optional input schema metadata.
        output_schema: Optional output schema metadata.
        facilitator_config: Facilitator config for verify/settle.
            Defaults to the public x402.org facilitator.
        resource: Resource URL override (defaults to the request URL).

    Returns:
        Async FastAPI middleware compatible with `app.middleware("http")`.

    Example:
        >>> from fastapi import FastAPI
        >>> from ampersend_sdk.ampersend import ApiClient, ApiClientOptions
        >>> from ampersend_sdk.x402.http.fastapi import require_payment_with_compliance
        >>>
        >>> app = FastAPI()
        >>> client = ApiClient(ApiClientOptions(...))
        >>> app.middleware("http")(
        ...     require_payment_with_compliance(
        ...         api_client=client,
        ...         price="$0.01",
        ...         pay_to_address="0xSeller...",
        ...         network="base-sepolia",
        ...     )
        ... )
    """

    supported_networks = get_args(SupportedNetworks)
    if network not in supported_networks:
        raise ValueError(
            f"Unsupported network: {network}. Must be one of: {supported_networks}"
        )

    try:
        max_amount_required, asset_address, eip712_domain = (
            process_price_to_atomic_amount(price, network)
        )
    except Exception as e:
        raise ValueError(f"Invalid price: {price}. Error: {e}")

    facilitator = FacilitatorClient(facilitator_config)

    async def middleware(request: Request, call_next: Callable[[Request], Any]) -> Any:
        # Liveness path is unauthenticated by design — bypasses the
        # entire compliance + payment flow so k8s probes don't get a
        # 402. Keep this check at the top so the bypass list is
        # easy to extend.
        if request.url.path == "/health":
            return await call_next(request)

        resource_url = resource or str(request.url)

        payment_requirements = [
            PaymentRequirements(
                scheme="exact",
                network=cast(SupportedNetworks, network),
                asset=asset_address,
                max_amount_required=max_amount_required,
                resource=resource_url,
                description=description,
                mime_type=mime_type,
                pay_to=pay_to_address,
                max_timeout_seconds=max_deadline_seconds,
                output_schema={
                    "input": {
                        "type": "http",
                        "method": request.method.upper(),
                        "discoverable": True,
                        **(input_schema.model_dump() if input_schema else {}),
                    },
                    "output": output_schema,
                },
                extra=eip712_domain,
            )
        ]

        def x402_response(error: str) -> JSONResponse:
            """402 with the full PaymentRequirements body — used when
            the buyer can fix the situation by paying (or paying
            differently)."""
            response_data = x402PaymentRequiredResponse(
                x402_version=x402_VERSION,
                accepts=payment_requirements,
                error=error,
            ).model_dump(by_alias=True)
            return JSONResponse(
                content=response_data,
                status_code=402,
                headers={"Content-Type": "application/json"},
            )

        def compliance_denied_response() -> JSONResponse:
            """403 with a deliberately generic body. Compliance denials
            DON'T leak the reason / category / screening id to the
            buyer — telling a sanctioned wallet "you're flagged for
            Tornado Cash exposure" lets them wallet-shop or feel out
            our thresholds. The operator gets the full detail via
            server-side logs (and the dashboard rejection panel).

            x402 clients only retry on 402, so a 403 short-circuits
            the buyer's payment loop without any extra signaling.
            """
            return JSONResponse(
                content={"error": "Payment rejected"},
                status_code=403,
                headers={"Content-Type": "application/json"},
            )

        # 1. No X-PAYMENT → advertise requirements.
        payment_header = request.headers.get("X-PAYMENT", "")
        if payment_header == "":
            return x402_response("No X-PAYMENT header provided")

        # 2. Decode the payment header.
        try:
            payment_dict = json.loads(safe_base64_decode(payment_header))
            payment = PaymentPayload(**payment_dict)
        except Exception as e:
            client_host = request.client.host if request.client else "unknown"
            logger.warning(f"Invalid payment header format from {client_host}: {e}")
            return x402_response("Invalid payment header format")

        selected_requirements = find_matching_payment_requirements(
            payment_requirements, payment
        )
        if selected_requirements is None:
            return x402_response("No matching payment requirements found")

        # 3. Compliance gate — runs BEFORE the facilitator's verify.
        # On deny we return 403 (NOT 402): the buyer's payment is
        # well-formed; we just refuse to accept it. Returning 402
        # would invite an x402 client to attempt another payment,
        # which we'd reject again. 403 short-circuits cleanly.
        #
        # Catch only transport-level + SDK-known failures. We
        # deliberately do NOT use bare `except Exception:` here —
        # that would swallow programmer errors (TypeError,
        # AttributeError, ValidationError) as fail-closed responses,
        # masking real bugs. Anything else raises and pages the
        # operator via the 500 path.
        try:
            authorization = payment.payload.authorization
            compliance_result = await asyncio.wait_for(
                api_client.authorize_receipt(
                    payer_address=authorization.from_,
                    payment_requirements=selected_requirements,
                    nonce=authorization.nonce,
                    payment_signature=payment.payload.signature,
                ),
                timeout=COMPLIANCE_API_TIMEOUT_SECONDS,
            )
        except (httpx.HTTPError, asyncio.TimeoutError, ApiError):
            # `logger.exception` keeps the stack trace; plain
            # `logger.error(f"...{e}")` would lose it.
            logger.exception("Compliance API call failed (transport/timeout/api-error)")
            return compliance_denied_response()

        if not compliance_result.authorized:
            # Operator-side audit trail. The buyer gets the generic
            # 403 above; the full detail stays server-side. Mirrors
            # the A2A executor's logging shape so a single log query
            # catches denies across both surfaces.
            logger.info(
                "Compliance denied payment",
                extra={
                    "payer_address": authorization.from_,
                    "reason_code": compliance_result.reason_code,
                    "reason": compliance_result.reason,
                    "screening_id": compliance_result.screening_id,
                },
            )
            return compliance_denied_response()

        # 4. Facilitator verify (signature, amount, nonce reuse).
        # Wrapped to absorb transient transport errors (httpx
        # ReadTimeout against the public x402.org facilitator is
        # observed at ~1% under concurrent buyer-loop load) — bubbling
        # them out as 500s is noisier than necessary; the buyer's CLI
        # treats 402 as retry-able which is the right behavior here.
        try:
            verify_response = await facilitator.verify(payment, selected_requirements)
        except (httpx.HTTPError, asyncio.TimeoutError) as exc:
            logger.warning("Facilitator verify failed (transport/timeout): %s", exc)
            return x402_response("Facilitator verify failed")
        if not verify_response.is_valid:
            return x402_response(
                f"Invalid payment: {verify_response.invalid_reason or 'Unknown error'}"
            )

        request.state.payment_details = selected_requirements
        request.state.verify_response = verify_response

        # 5. Run the actual handler.
        response = await call_next(request)

        # Don't settle on non-2xx (handler short-circuited).
        if response.status_code < 200 or response.status_code >= 300:
            return response

        # 6. Settle via the facilitator. On failure we discard the
        # original response (which contains the handler output) and
        # return a fresh 402. The handler already executed — any
        # side effects have happened, but the buyer doesn't see the
        # body. This matches the upstream `x402.fastapi.require_payment`
        # pattern; if a real seller wanted at-least-once delivery
        # semantics they'd need to settle BEFORE running the handler,
        # at the cost of double-charge risk on retry.
        try:
            settle_response = await facilitator.settle(payment, selected_requirements)
            if settle_response.success:
                response.headers["X-PAYMENT-RESPONSE"] = base64.b64encode(
                    settle_response.model_dump_json(by_alias=True).encode("utf-8")
                ).decode("utf-8")
            else:
                return x402_response(
                    "Settle failed: "
                    + (settle_response.error_reason or "Unknown error")
                )
        except (httpx.HTTPError, asyncio.TimeoutError) as exc:
            logger.warning("Facilitator settle failed (transport/timeout): %s", exc)
            return x402_response("Settle failed")

        return response

    return middleware
