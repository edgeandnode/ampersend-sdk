"""Tests for the compliance-gated FastAPI middleware
(`ampersend_sdk.x402.http.fastapi.require_payment`).

Covers the four short-circuit branches that don't require a
facilitator:
  - No `X-PAYMENT` header → 402 with PaymentRequirements.
  - Malformed `X-PAYMENT` → 402 "Invalid payment header format".
  - Compliance API returns deny → 403 with a generic
    `{"error": "Payment rejected"}` body. We deliberately don't
    leak the reason, category, or screening id to the buyer
    (compliance industry default — telling a sanctioned wallet why
    it was flagged lets them evade or wallet-shop). The facilitator
    is never consulted.
  - Compliance API itself fails (transport, timeout, ApiError) → 403
    fail-closed with the same generic body.

A programmer error (TypeError, AttributeError, etc.) raised inside
the compliance call must NOT silent-degrade to a 403 — operators
want those to surface as 500s. Pinned by an explicit test.

The "compliance allow → facilitator verify" path needs a facilitator,
which we don't run in unit tests. That path is exercised by the
end-to-end demo runbook of the consuming insights service.
"""

import asyncio
import base64
import json
from unittest.mock import AsyncMock, MagicMock

import pytest
from ampersend_sdk.ampersend import ApiClient
from ampersend_sdk.ampersend.types import ApiError, ApiResponseAuthorizeReceipt
from ampersend_sdk.x402.http.fastapi import require_payment
from fastapi import FastAPI
from fastapi.testclient import TestClient

SELLER_ADDRESS = "0x742d35Cc6634C0532925a3b8D13Cec84d3d1b123"
# Generic non-sanctioned-looking 40-hex address. Used as the payer
# in fail-closed/transport-failure tests where the value never
# reaches the compliance API or the facilitator. Real format (not
# `"0xPayer"`) so a future EIP3009Authorization format check
# wouldn't break these tests for unrelated reasons.
PAYER_ADDRESS = "0xa160cdab225685da1d56aa342ad8841c3b53f291"


def _make_app(api_client: ApiClient) -> FastAPI:
    app = FastAPI()
    app.middleware("http")(
        require_payment(
            api_client=api_client,
            price="$0.01",
            pay_to_address=SELLER_ADDRESS,
            network="base-sepolia",
            description="Test endpoint",
        )
    )

    @app.get("/insight")
    async def get_insight() -> dict[str, str]:
        return {"insight": "test"}

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


def _signed_payment_header(payer: str, nonce: str = "0x" + "ab" * 32) -> str:
    """Construct a syntactically valid base64-encoded X-PAYMENT header
    for an exact-scheme EIP-3009 transfer. The signature is dummy —
    these tests never reach the facilitator's verify step."""
    payload = {
        "x402Version": 1,
        "scheme": "exact",
        "network": "base-sepolia",
        "payload": {
            "signature": "0x" + "cd" * 65,
            "authorization": {
                "from": payer,
                "to": SELLER_ADDRESS,
                "value": "10000",
                "validAfter": "0",
                "validBefore": "9999999999",
                "nonce": nonce,
            },
        },
    }
    return base64.b64encode(json.dumps(payload).encode("utf-8")).decode("utf-8")


def test_no_payment_header_returns_402_with_requirements() -> None:
    api_client = MagicMock(spec=ApiClient)
    client = TestClient(_make_app(api_client))

    response = client.get("/insight")

    assert response.status_code == 402
    body = response.json()
    assert body["x402Version"] == 1
    assert len(body["accepts"]) == 1
    assert body["accepts"][0]["payTo"] == SELLER_ADDRESS
    assert body["accepts"][0]["network"] == "base-sepolia"
    assert "No X-PAYMENT" in body["error"]


def test_malformed_payment_header_returns_402() -> None:
    api_client = MagicMock(spec=ApiClient)
    client = TestClient(_make_app(api_client))

    response = client.get("/insight", headers={"X-PAYMENT": "not-base64!@#"})
    assert response.status_code == 402
    assert "Invalid payment header format" in response.json()["error"]


@pytest.mark.asyncio
async def test_compliance_deny_returns_403_without_leaking_reason() -> None:
    """A deny from authorize_receipt short-circuits — the buyer sees a
    generic 403 with NO reason, category, or screening id. The
    facilitator is never reached. The full audit detail stays
    server-side (logged + persisted in `incoming_payment`)."""
    api_client = AsyncMock(spec=ApiClient)
    api_client.authorize_receipt = AsyncMock(
        return_value=ApiResponseAuthorizeReceipt(
            authorized=False,
            reason="Sanctions (Severe) exposure on 0xBadClaw",
            reason_code="compliance_high_risk",
            screening_id="00000000-0000-0000-0000-000000000001",
        )
    )

    client = TestClient(_make_app(api_client))

    payer = "0xa160cdab225685da1d56aa342ad8841c3b53f291"
    response = client.get(
        "/insight",
        headers={"X-PAYMENT": _signed_payment_header(payer)},
    )

    assert response.status_code == 403
    body = response.json()
    assert body == {"error": "Payment rejected"}
    # Tight body shape — exactly one key, exactly that string. If a
    # future refactor accidentally surfaces *any* additional field
    # (`screeningId`, `code`, even `Content-Type`-style metadata),
    # this catches it. Anchored on the keyset, not on hand-picked
    # negative-list strings, so we don't have to chase every new
    # potential-leak field.
    assert set(body.keys()) == {"error"}
    # Belt-and-suspenders against accidental leakage in the value.
    assert "Sanctions" not in str(body)
    assert "compliance_high_risk" not in str(body)

    api_client.authorize_receipt.assert_awaited_once()
    call_kwargs = api_client.authorize_receipt.call_args.kwargs
    assert call_kwargs["payer_address"] == payer
    assert call_kwargs["nonce"] == "0x" + "ab" * 32
    assert call_kwargs["payment_signature"] == "0x" + "cd" * 65


def test_health_endpoint_bypasses_compliance_gate() -> None:
    """`/health` is liveness — the compliance middleware MUST NOT
    short-circuit it to 402 (which would break k8s probes). The
    bypass at the top of the middleware checks `request.url.path`
    against the `bypass_paths` set, default `("/health",)`."""
    api_client = MagicMock(spec=ApiClient)
    client = TestClient(_make_app(api_client))

    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    # The compliance API should never have been touched on a /health
    # call — paid-route middleware is fully bypassed.
    api_client.authorize_receipt.assert_not_called()


def test_bypass_paths_override_swaps_default() -> None:
    """`bypass_paths` is configurable so sellers using non-`/health`
    liveness paths (`/livez`, `/readyz`, `/metrics`) can still get
    a clean 200 on probes. Overriding it replaces the default — it
    doesn't extend it. Pin both: custom path bypassed (200), and
    `/health` no longer bypassed when omitted from the override."""
    api_client = MagicMock(spec=ApiClient)
    app = FastAPI()
    app.middleware("http")(
        require_payment(
            api_client=api_client,
            price="$0.01",
            pay_to_address=SELLER_ADDRESS,
            network="base-sepolia",
            bypass_paths=("/livez", "/metrics"),
        )
    )

    @app.get("/livez")
    async def livez() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    client = TestClient(app)

    # Custom bypass path: handler runs, no 402.
    livez_response = client.get("/livez")
    assert livez_response.status_code == 200

    # `/health` is no longer in the override — middleware gates it
    # like any paid route. Without an X-PAYMENT header → 402.
    health_response = client.get("/health")
    assert health_response.status_code == 402


@pytest.mark.asyncio
async def test_compliance_api_transport_failure_fails_closed() -> None:
    """If the compliance API fails with a transport error (httpx
    network/timeout, ApiError 5xx), refuse the payment rather than
    letting it through unscreened. Same generic 403 as a deny — we
    don't tell the buyer "compliance API was down" (which would
    itself be a useful signal to a probing user)."""
    import httpx

    api_client = AsyncMock(spec=ApiClient)
    api_client.authorize_receipt = AsyncMock(
        side_effect=httpx.ConnectError("connection refused")
    )

    client = TestClient(_make_app(api_client))

    response = client.get(
        "/insight",
        headers={"X-PAYMENT": _signed_payment_header(PAYER_ADDRESS)},
    )

    assert response.status_code == 403
    assert response.json() == {"error": "Payment rejected"}


@pytest.mark.asyncio
async def test_compliance_api_timeout_fails_closed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """If the compliance API hangs past the timeout budget, treat it
    as a transport failure: 403 fail-closed instead of letting the
    request hang for the buyer's TCP keepalive window."""

    async def hang(*args: object, **kwargs: object) -> None:
        await asyncio.sleep(60)

    api_client = AsyncMock(spec=ApiClient)
    api_client.authorize_receipt = AsyncMock(side_effect=hang)

    # Patch the timeout down to something the test can wait through.
    from ampersend_sdk.x402.http import fastapi as fastapi_mod

    monkeypatch.setattr(fastapi_mod, "COMPLIANCE_API_TIMEOUT_SECONDS", 0.05)

    client = TestClient(_make_app(api_client))
    response = client.get(
        "/insight",
        headers={"X-PAYMENT": _signed_payment_header(PAYER_ADDRESS)},
    )

    assert response.status_code == 403
    assert response.json() == {"error": "Payment rejected"}


@pytest.mark.asyncio
async def test_compliance_api_programmer_error_does_not_swallow() -> None:
    """A programmer error (TypeError, AttributeError, RuntimeError
    not raised by the SDK) should NOT silent-degrade to a 403. The
    operator wants these to surface as 500s so they can be alerted
    on and fixed — masking them as "compliance denied" buries real
    bugs."""
    api_client = AsyncMock(spec=ApiClient)
    api_client.authorize_receipt = AsyncMock(
        side_effect=AttributeError("oops, accidentally accessed .foo")
    )

    client = TestClient(_make_app(api_client), raise_server_exceptions=False)

    response = client.get(
        "/insight",
        headers={"X-PAYMENT": _signed_payment_header(PAYER_ADDRESS)},
    )

    # Bubbled out to ASGI → 500. Crucially, the body is NOT the
    # "Payment rejected" generic — that would mask the bug.
    assert response.status_code == 500


@pytest.mark.asyncio
async def test_compliance_api_apierror_fails_closed() -> None:
    """An ApiError (5xx, malformed JSON, auth failure) should fail
    closed — same generic 403 as transport failures. Operators see
    the error in logs; buyers see a uniform deny."""
    api_client = AsyncMock(spec=ApiClient)
    api_client.authorize_receipt = AsyncMock(
        side_effect=ApiError("Compliance API 503", status=503)
    )

    client = TestClient(_make_app(api_client))
    response = client.get(
        "/insight",
        headers={"X-PAYMENT": _signed_payment_header(PAYER_ADDRESS)},
    )

    assert response.status_code == 403
    assert response.json() == {"error": "Payment rejected"}
