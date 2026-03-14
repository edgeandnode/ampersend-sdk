from typing import Protocol

from x402_a2a import (
    PaymentPayload,
    PaymentRequirements,
)

from .types import ServerAuthorizationData


class X402Wallet(Protocol):
    def create_payment(
        self,
        requirements: PaymentRequirements,
        server_authorization: ServerAuthorizationData | None = None,
    ) -> PaymentPayload: ...
