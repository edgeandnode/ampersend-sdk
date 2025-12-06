"""Local Agent Orchestrator Example.

This example demonstrates using a local ADK agent to orchestrate multiple
remote A2A agents as tools. The local agent can delegate tasks to specialized
remote agents with automatic x402 payment handling.

The example uses X402RemoteAgentToolset to provide remote agent capabilities
as ADK tools that the orchestrator can use.

Getting Started (Testnet):
    1. Create agent account at https://app.staging.ampersend.ai
    2. Fund with testnet USDC: https://faucet.circle.com/ (Base Sepolia)
    3. Set environment variables:
        export EXAMPLES_A2A_BUYER__SMART_ACCOUNT_ADDRESS=0x...
        export EXAMPLES_A2A_BUYER__SMART_ACCOUNT_KEY_PRIVATE_KEY=0x...
        export EXAMPLES_A2A_BUYER__AMPERSEND_API_URL=https://api.staging.ampersend.ai

    4. Run:
        uv --directory=examples run -- adk run src/examples/a2a/buyer/local_agent

Standalone Alternative (No Ampersend):
    1. Set environment:
        export EXAMPLES_A2A_BUYER__PRIVATE_KEY=0x...
        export EXAMPLES_A2A_BUYER__USE_NAIVE_AUTHORIZER=true

    2. Run:
        uv --directory=examples run -- adk run src/examples/a2a/buyer/local_agent

Environment Variables:
    EXAMPLES_A2A_BUYER__SMART_ACCOUNT_ADDRESS: Agent smart account address (from dashboard)
    EXAMPLES_A2A_BUYER__SMART_ACCOUNT_KEY_PRIVATE_KEY: Session key (from dashboard)
    EXAMPLES_A2A_BUYER__AMPERSEND_API_URL: Ampersend API URL
        Default: https://api.staging.ampersend.ai
    EXAMPLES_A2A_BUYER__AGENT_URL_1: First remote agent URL
        Default: https://subgraph-a2a.x402.staging.thegraph.com
    EXAMPLES_A2A_BUYER__AGENT_URL_2: Second remote agent URL (optional)
    EXAMPLES_A2A_BUYER__PRIVATE_KEY: EOA private key (standalone mode only)
    EXAMPLES_A2A_BUYER__USE_NAIVE_AUTHORIZER: Use naive mode (true/false)
        Default: false

Example Usage:
    The orchestrator agent can delegate to remote agents:

    User: "Query Uniswap V3 data on Base"
    Orchestrator: Lists available agents, delegates to subgraph_agent
    Remote Agent: Processes query with automatic payment
    Orchestrator: Returns result to user

Features:
    - Automatic remote agent discovery
    - Per-agent conversation context management
    - Transparent x402 payment handling
    - Spend limits via AmpersendTreasurer
"""

import os

from ampersend_sdk.a2a.client import X402RemoteAgentToolset
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
from google.adk import Agent

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

# Configure remote agents (defaults to staging)
_remote_agent_urls = [
    os.environ.get(
        "EXAMPLES_A2A_BUYER__AGENT_URL_1",
        "https://subgraph-a2a.x402.staging.thegraph.com",
    )
]

# Add second agent if configured
if agent_url_2 := os.environ.get("EXAMPLES_A2A_BUYER__AGENT_URL_2"):
    _remote_agent_urls.append(agent_url_2)

# Create remote agent toolset
toolset = X402RemoteAgentToolset(
    remote_agent_urls=_remote_agent_urls,
    treasurer=_treasurer,
)

# Create local orchestrator agent
root_agent = Agent(
    name="orchestrator_agent",
    model="gemini-2.0-flash",
    description="An orchestrator agent that delegates tasks to specialized remote agents",
    instruction="""You are an orchestrator agent that can delegate tasks to specialized remote agents.

Your capabilities:
- Use 'x402_a2a_list_agents' to discover available remote agents
- Use 'x402_a2a_send_to_agent' to send requests to specific agents by name

When a user asks for something:
1. First, list the available agents to understand their capabilities
2. Determine which remote agent can best help with the user's request
3. Delegate the task to that agent using send_to_agent
4. Return the agent's response to the user

Payments for remote agent services are handled automatically. Each agent
maintains its own conversation context.""",
    tools=[toolset],
    before_agent_callback=toolset.get_before_agent_callback(),
)
