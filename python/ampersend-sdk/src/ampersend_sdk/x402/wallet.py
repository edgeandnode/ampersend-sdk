from typing import Any, Protocol

from x402_a2a import (
    PaymentPayload,
    PaymentRequirements,
)


class X402Wallet(Protocol):
    def create_payment(
        self,
        requirements: PaymentRequirements,
        server_authorization: Any | None = None,
    ) -> PaymentPayload: ...
