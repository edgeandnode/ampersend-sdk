from abc import ABC, abstractmethod
from typing import Any, Dict, NamedTuple

from x402_a2a import (
    PaymentPayload,
    PaymentStatus,
    x402PaymentRequiredResponse,
)
from x402_a2a.types import PaymentStatus, x402PaymentRequiredResponse


class X402Authorization(NamedTuple):
    """Result of payment authorization containing payment details and ID."""

    payment: PaymentPayload
    authorization_id: str


class X402Authorizer(ABC):
    @abstractmethod
    async def authorize(
        self,
        payment_required: x402PaymentRequiredResponse,
        context: Dict[str, Any] | None = None,
    ) -> X402Authorization | None:
        """Authorize a payment."""

    @abstractmethod
    async def onStatus(
        self,
        status: PaymentStatus,
        authorization: X402Authorization,
        context: Dict[str, Any] | None = None,
    ) -> None:
        """Handle payment status updates."""
