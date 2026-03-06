from typing import Any

from eth_account import Account
from x402_a2a import PaymentPayload, PaymentRequirements, process_payment


class AccountWallet:
    def __init__(self, account: Account) -> None:
        self._account = account

    def create_payment(
        self,
        requirements: PaymentRequirements,
        server_authorization: Any | None = None,  # Ignored for EOA wallets
    ) -> PaymentPayload:
        return process_payment(
            requirements=requirements,
            account=self._account,
        )
