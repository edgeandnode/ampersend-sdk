import os

from ampersend_sdk.a2a.client import X402RemoteA2aAgent
from ampersend_sdk.x402.treasurers import NaiveTreasurer
from ampersend_sdk.x402.wallets.account import AccountWallet
from eth_account import Account
from google.adk.agents.remote_a2a_agent import AGENT_CARD_WELL_KNOWN_PATH

_account = Account.from_key(os.environ["EXAMPLES_A2A_BUYER__PRIVATE_KEY"])
_wallet = AccountWallet(account=_account)
_treasurer = NaiveTreasurer(wallet=_wallet)

_agent_url = os.environ["EXAMPLES_A2A_BUYER__SELLER_AGENT_URL"]
root_agent = X402RemoteA2aAgent(
    treasurer=_treasurer,
    name="example_a2a_buyer_agent",
    agent_card=f"{_agent_url}{AGENT_CARD_WELL_KNOWN_PATH}",
)
