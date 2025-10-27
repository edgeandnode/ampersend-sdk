from typing import Any

from x402_a2a import (
    FacilitatorClient,
    FacilitatorConfig,
    x402ExtensionConfig,
)
from x402_a2a.types import (
    AgentExecutor,
    PaymentPayload,
    PaymentRequirements,
    SettleResponse,
    VerifyResponse,
)

from .x402_server_executor import X402ServerExecutor


class FacilitatorX402ServerExecutor(X402ServerExecutor):
    def __init__(
        self,
        *,
        delegate: AgentExecutor,
        config: x402ExtensionConfig,
        facilitator_config: FacilitatorConfig | None = None,
        **kwargs: Any,
    ):
        super().__init__(delegate=delegate, config=config, **kwargs)
        self._facilitator = FacilitatorClient(facilitator_config)

    async def verify_payment(
        self, payload: PaymentPayload, requirements: PaymentRequirements
    ) -> VerifyResponse:
        """Verifies the payment with the facilitator."""
        return await self._facilitator.verify(payload, requirements)

    async def settle_payment(
        self, payload: PaymentPayload, requirements: PaymentRequirements
    ) -> SettleResponse:
        """Settles the payment with the facilitator."""
        return await self._facilitator.settle(payload, requirements)
