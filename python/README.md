# Python SDK - Ampersend

Python SDK for integrating [x402](https://github.com/coinbase/x402) payment capabilities into A2A (Agent-to-Agent)
protocol applications. Supports both buyer (client) and seller (server) roles with flexible payment authorization
patterns.

## Installation

```bash
# Install Python 3.13
uv python install 3.13

# Install dependencies
uv sync --frozen --group dev
```

## Getting Started

Create your first x402-enabled agent in minutes using Ampersend's staging environment (free testnet).

### 1. Create Agent Account

1. Visit https://app.staging.ampersend.ai
2. Create an agent account
3. Get your Smart Account address and session key
4. Fund with testnet USDC: https://faucet.circle.com/ (select Base Sepolia)

### 2. Install SDK

```bash
uv python install 3.13
uv sync --frozen --group dev
```

### 3. Create Your Agent

```python
from ampersend_sdk.a2a.client import X402RemoteA2aAgent
from ampersend_sdk.ampersend import AmpersendTreasurer, ApiClient, ApiClientOptions
from ampersend_sdk.x402.wallets.smart_account import SmartAccountWallet
from ampersend_sdk.smart_account import SmartAccountConfig

# Configure smart account wallet
wallet = SmartAccountWallet(
    config=SmartAccountConfig(
        session_key="0x...",  # From staging dashboard
        smart_account_address="0x...",  # From staging dashboard
    )
)

# Create Ampersend treasurer (with spend limits & monitoring)
treasurer = AmpersendTreasurer(
    api_client=ApiClient(
        options=ApiClientOptions(
            base_url="https://api.staging.ampersend.ai",
            session_key_private_key="0x..."
        )
    ),
    wallet=wallet
)

# Create agent pointing to staging service (testnet, rate-limited)
agent = X402RemoteA2aAgent(
    treasurer=treasurer,
    name="my_agent",
    agent_card="https://subgraph-a2a.x402.staging.thegraph.com/.well-known/agent-card.json"
)

# Use the agent (payments handled automatically with spend limits)
result = await agent.run("Query Uniswap V3 pools on Base Sepolia")
```

### Standalone Alternative

For testing without Ampersend account:

```python
from ampersend_sdk.a2a.client import X402RemoteA2aAgent
from ampersend_sdk.x402.treasurers.naive import NaiveTreasurer
from ampersend_sdk.x402.wallets.account import AccountWallet

wallet = AccountWallet(private_key="0x...")
treasurer = NaiveTreasurer(wallet=wallet)  # Auto-approves, no limits

agent = X402RemoteA2aAgent(
    treasurer=treasurer,
    name="test_agent",
    agent_card="https://subgraph-a2a.x402.staging.thegraph.com/.well-known/agent-card.json"
)
```

**Note**: Standalone mode has no spend limits or monitoring. Recommended for testing only.

### Server (Seller)

```python
from google.adk.agents import Agent
from ampersend_sdk.a2a.server import to_a2a, make_x402_before_agent_callback

# Create your ADK agent with payment requirements
agent = Agent(
    name="MyAgent",
    before_agent_callback=make_x402_before_agent_callback(
        price="$0.001",
        network="base-sepolia",
        pay_to_address="0x...",
    ),
)

@agent.tool()
async def my_tool(query: str) -> str:
    return "result"

# Convert to A2A app (x402 support configured via before_agent_callback)
a2a_app = to_a2a(agent, host="localhost", port=8001)

# Serve with uvicorn
# uvicorn module:a2a_app --host 0.0.0.0 --port 8001
```

## Core Concepts

### X402Treasurer

Handles payment authorization and status tracking.

- **AmpersendTreasurer** (recommended) - Enforces spend limits and provides monitoring via Ampersend API
- **NaiveTreasurer** - Auto-approves all payments (useful for testing and demos only)

### Wallets

- **AccountWallet** - For EOA (Externally Owned Accounts)
- **SmartAccountWallet** - For ERC-4337 smart accounts with ERC-1271 signatures. Currently supports accounts with the
  ERC-7579 OwnableValidator from Rhinestone.

### Payment Flow

1. Client sends request → Server responds with `PAYMENT_REQUIRED` (402)
2. Treasurer authorizes payment → Payment injected into request
3. Request retried with payment → Server verifies and processes

## Development

```bash
# Test
uv run -- pytest

# Lint & format
uv run -- ruff check python
uv run -- ruff format python

# Type check (strict mode)
uv run -- mypy python
```

## Learn More

- [x402 Specification](https://github.com/coinbase/x402)
- [A2A Protocol](https://github.com/anthropics/adk)
- [SDK Package Documentation](./ampersend-sdk/README.md)
- [Repository Root](../README.md)
