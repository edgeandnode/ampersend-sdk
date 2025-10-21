import uuid
from typing import Any, Dict

from x402_a2a import (
    PaymentStatus,
    x402PaymentRequiredResponse,
)
from x402_a2a.types import PaymentStatus, x402PaymentRequiredResponse

from ..authorizer import X402Authorization, X402Authorizer
from ..wallet import X402Wallet


class NaiveX402Authorizer(X402Authorizer):
    def __init__(self, wallet: X402Wallet):
        self._wallet = wallet

    async def authorize(
        self,
        payment_required: x402PaymentRequiredResponse,
        context: Dict[str, Any] | None = None,
    ) -> X402Authorization | None:
        payment = self._wallet.create_payment(
            requirements=payment_required.accepts[0],
        )
        return X402Authorization(
            payment=payment,
            authorization_id=uuid.uuid4().hex,
        )

    async def onStatus(
        self,
        status: PaymentStatus,
        authorization: X402Authorization,
        context: Dict[str, Any] | None = None,
    ) -> None:
        pass
