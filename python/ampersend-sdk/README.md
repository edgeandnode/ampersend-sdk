# ampersend-sdk

Python SDK for integrating [x402](https://github.com/coinbase/x402) payment capabilities into A2A (Agent-to-Agent)
protocol applications.

## Quick Start

```python
from ampersend_sdk import create_ampersend_treasurer
from ampersend_sdk.a2a.client import X402RemoteA2aAgent

# Create treasurer (one-liner setup)
treasurer = create_ampersend_treasurer(
    smart_account_address="0x...",
    session_key_private_key="0x...",
)

agent = X402RemoteA2aAgent(
    treasurer=treasurer,
    name="my_agent",
    agent_card="https://agent.example.com/.well-known/agent-card.json",
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
