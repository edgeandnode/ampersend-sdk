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

## Quick Start

### Client (Buyer)

```python
from ampersend_sdk.a2a.client import X402RemoteA2aAgent
from ampersend_sdk.x402.treasurers.naive import NaiveTreasurer
from ampersend_sdk.x402.wallets.account import AccountWallet

# Create wallet and treasurer
wallet = AccountWallet(private_key="0x...")
treasurer = NaiveTreasurer(wallet)

# Create agent with payment support
agent = X402RemoteA2aAgent(
    treasurer=treasurer,
    agent_url="http://localhost:8001",
    agent_name="SellerAgent"
)

# Use the agent (payments handled automatically)
result = await agent.run("your query here")
```

### Server (Seller)

```python
from adk.agents import Agent
from ampersend_sdk.a2a.server import to_a2a
from ampersend_sdk.x402.treasurers.naive import NaiveTreasurer

# Create your ADK agent
agent = Agent(name="MyAgent")

@agent.tool()
async def my_tool(query: str) -> str:
    return "result"

# Convert to A2A app with x402 support
treasurer = NaiveTreasurer(wallet=None)  # Server doesn't need wallet
a2a_app = to_a2a(agent, treasurer)

# Serve with uvicorn
# uvicorn module:a2a_app --host 0.0.0.0 --port 8001
```

## Core Concepts

### X402Treasurer

Handles payment authorization and status tracking. The `NaiveTreasurer` implementation auto-approves all payments
(useful for testing and demos).

### Wallets

- **AccountWallet** - For EOA (Externally Owned Accounts)
- **SmartAccountWallet** - For ERC-4337 smart accounts with ERC-1271 signatures

### Payment Flow

1. Client sends request → Server responds with `PAYMENT_REQUIRED` (402)
2. Treasurer authorizes payment → Payment injected into request
3. Request retried with payment → Server verifies and processes

## Environment Variables

See [.env.example](../.env.example) for configuration:

```bash
# Buyer configuration
EXAMPLES_A2A_BUYER__PRIVATE_KEY=0x...
EXAMPLES_A2A_BUYER__SELLER_AGENT_URL=http://localhost:8001

# Seller configuration
EXAMPLES_A2A_SELLER__PAY_TO_ADDRESS=0x...
GOOGLE_API_KEY=...
```

## Running Examples

```bash
# Start seller
uv --directory=examples run -- \
  uvicorn examples.a2a.seller.adk.agent:a2a_app --host localhost --port 8001

# Run buyer
echo "your query" | uv --directory=examples run -- adk run src/examples/a2a/buyer/adk
```

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
