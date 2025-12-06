"""A2A Buyer Example with x402 Payment Support.

This example demonstrates connecting directly to a remote A2A agent
with automatic x402 payment handling.

The example supports two modes:
1. Smart Account + AmpersendTreasurer (recommended - with spend limits)
2. EOA + NaiveTreasurer (standalone alternative - no limits)

Getting Started (Testnet):
    1. Create agent account at https://app.staging.ampersend.ai
    2. Fund with testnet USDC: https://faucet.circle.com/ (Base Sepolia)
    3. Set environment variables:
        export EXAMPLES_A2A_BUYER__SMART_ACCOUNT_ADDRESS=0x...
        export EXAMPLES_A2A_BUYER__SMART_ACCOUNT_KEY_PRIVATE_KEY=0x...
        export EXAMPLES_A2A_BUYER__AMPERSEND_API_URL=https://api.staging.ampersend.ai

    4. Run:
        uv --directory=examples run -- adk run src/examples/a2a/buyer/adk

Standalone Alternative (No Ampersend):
    1. Set environment:
        export EXAMPLES_A2A_BUYER__PRIVATE_KEY=0x...
        export EXAMPLES_A2A_BUYER__USE_NAIVE_AUTHORIZER=true

    2. Run:
        uv --directory=examples run -- adk run src/examples/a2a/buyer/adk

Environment Variables:
    EXAMPLES_A2A_BUYER__SMART_ACCOUNT_ADDRESS: Agent smart account address (from dashboard)
    EXAMPLES_A2A_BUYER__SMART_ACCOUNT_KEY_PRIVATE_KEY: Session key (from dashboard)
    EXAMPLES_A2A_BUYER__AMPERSEND_API_URL: Ampersend API URL
        Default: https://api.staging.ampersend.ai
    EXAMPLES_A2A_BUYER__SELLER_AGENT_URL: Remote agent URL
        Default: https://subgraph-a2a.x402.staging.thegraph.com
    EXAMPLES_A2A_BUYER__PRIVATE_KEY: EOA private key (standalone mode only)
    EXAMPLES_A2A_BUYER__USE_NAIVE_AUTHORIZER: Use naive mode (true/false)
        Default: false
"""

import os

from ampersend_sdk.a2a.client import X402RemoteA2aAgent
from ampersend_sdk.ampersend import (
    AmpersendTreasurer,
    ApiClient,
    ApiClientOptions,
)
from ampersend_sdk.smart_account import SmartAccountConfig
from ampersend_sdk.x402 import X402Treasurer, X402Wallet
from ampersend_sdk.x402.treasurers import NaiveTreasurer
from ampersend_sdk.x402.wallets.account import AccountWallet
from ampersend_sdk.x402.wallets.smart_account import SmartAccountWallet
from eth_account import Account
from google.adk.agents.remote_a2a_agent import AGENT_CARD_WELL_KNOWN_PATH

# Determine account type from environment
smart_account_address = os.environ.get("EXAMPLES_A2A_BUYER__SMART_ACCOUNT_ADDRESS")
use_naive = (
    os.environ.get("EXAMPLES_A2A_BUYER__USE_NAIVE_AUTHORIZER", "false").lower()
    == "true"
)

_wallet: X402Wallet
_session_key: str
if smart_account_address:
    # Smart Account mode (recommended)
    _session_key = os.environ["EXAMPLES_A2A_BUYER__SMART_ACCOUNT_KEY_PRIVATE_KEY"]
    _wallet = SmartAccountWallet(
        config=SmartAccountConfig(
            session_key=_session_key,
            smart_account_address=smart_account_address,
            validator_address="0x000000000013FDB5234E4E3162A810F54D9F7E98",
        )
    )
else:
    # EOA mode (standalone alternative)
    _session_key = os.environ["EXAMPLES_A2A_BUYER__PRIVATE_KEY"]
    _account = Account.from_key(_session_key)
    _wallet = AccountWallet(account=_account)

_treasurer: X402Treasurer
if use_naive:
    # Naive mode - auto-approves all payments (no spend limits)
    _treasurer = NaiveTreasurer(wallet=_wallet)
else:
    # Ampersend mode - with spend limits and monitoring
    _ampersend_api_url = os.environ.get(
        "EXAMPLES_A2A_BUYER__AMPERSEND_API_URL",
        "https://api.staging.ampersend.ai",
    )
    _treasurer = AmpersendTreasurer(
        api_client=ApiClient(
            options=ApiClientOptions(
                base_url=_ampersend_api_url,
                session_key_private_key=_session_key,
            )
        ),
        wallet=_wallet,
    )

# Get seller agent URL (defaults to staging)
_agent_url = os.environ.get(
    "EXAMPLES_A2A_BUYER__SELLER_AGENT_URL",
    "https://subgraph-a2a.x402.staging.thegraph.com",
)

root_agent = X402RemoteA2aAgent(
    treasurer=_treasurer,
    name="a2a_buyer_agent",
    agent_card=f"{_agent_url}{AGENT_CARD_WELL_KNOWN_PATH}",
)
