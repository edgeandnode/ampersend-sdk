from typing import Optional

from x402_a2a import PaymentPayload, PaymentRequirements

from ....ampersend.types import ServerAuthorizationData
from ....smart_account.sign import SmartAccountConfig
from .cosigned import smart_account_create_cosigned_payment
from .exact import smart_account_create_payment


class SmartAccountWallet:
    def __init__(self, config: SmartAccountConfig) -> None:
        self._config = config

    def create_payment(
        self,
        requirements: PaymentRequirements,
        server_authorization: Optional[ServerAuthorizationData] = None,
    ) -> PaymentPayload:
        # If server authorization provided, use co-signed path
        if server_authorization:
            return smart_account_create_cosigned_payment(
                config=self._config,
                requirements=requirements,
                server_authorization=server_authorization,
            )

        # Otherwise use direct signing (full-access keys)
        return smart_account_create_payment(
            config=self._config,
            requirements=requirements,
        )
