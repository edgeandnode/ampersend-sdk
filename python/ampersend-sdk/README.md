# ampersend-sdk

Python SDK for integrating [x402](https://github.com/coinbase/x402) payment capabilities into A2A (Agent-to-Agent) protocol applications.

## Quick Start

```python
from ampersend_sdk.a2a.client import X402RemoteA2aAgent
from ampersend_sdk.x402.treasurers.naive import NaiveTreasurer
from ampersend_sdk.x402.wallets.account import AccountWallet

wallet = AccountWallet(private_key="0x...")
treasurer = NaiveTreasurer(wallet)

agent = X402RemoteA2aAgent(
    treasurer=treasurer,
    agent_url="http://localhost:8001",
    agent_name="SellerAgent"
)

result = await agent.run("your query")
```

## Package Structure

```
ampersend_sdk/
├── a2a/
│   ├── client/          # Client-side x402 support
│   └── server/          # Server-side x402 support
└── x402/                # Core x402 components
    ├── treasurer.py
    └── wallets/         # EOA & Smart Account wallets
```

## Documentation

**→ [Complete Python SDK Documentation](../README.md)**

## Development

```bash
# Test
uv run -- pytest

# Lint & format
uv run -- ruff check python
uv run -- ruff format python

# Type check
uv run -- mypy python
```

## Learn More

- [Python SDK Guide](../README.md)
- [x402 Specification](https://github.com/coinbase/x402)
- [A2A Protocol](https://github.com/anthropics/adk)
