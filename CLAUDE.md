# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Python-based SDK that extends the A2A (Agent-to-Agent) protocol with x402 payment capabilities. The SDK enables agents to handle payments during A2A interactions, supporting both buyer (client) and seller (server) roles.

## Development Commands

### Setup

```bash
# Install Python 3.13
uv python install 3.13

# Install dependencies including dev tools
uv sync --frozen --group dev
```

### Testing

```bash
# Run all tests
uv run -- pytest

# Run specific test file
uv run -- pytest python/ampersend-sdk/tests/unit/x402/treasurers/test_naive.py

# Run only slow tests
uv run -- pytest -m slow
```

### Linting & Formatting

```bash
# Check linting (uses ruff for imports and unused imports)
uv run -- ruff check --output-format=github python

# Check formatting
uv run -- ruff format --diff python

# Apply formatting
uv run -- ruff format python

# Type checking (strict mode enabled)
uv run -- mypy python
```

### Lockfile

```bash
# Verify lockfile is up to date
uv lock --check

# Update lockfile
uv lock
```

## Architecture

### Workspace Structure

This is a uv workspace with two main packages:

- `python/ampersend-sdk/`: Core SDK implementation
- `python/examples/`: Example buyer and seller agents

### Core Components

**X402Treasurer (Abstract Base Class)**

- Handles payment authorization decisions via `onPaymentRequired()`
- Receives payment status updates via `onStatus()`
- Implementation example: `NaiveTreasurer` auto-approves all payments

**X402Wallet (Protocol)**

- Creates payment payloads from requirements
- Two implementations:
  - `AccountWallet`: For EOA (Externally Owned Accounts)
  - `SmartAccountWallet`: For smart contract wallets with ERC-1271 signatures

**Client Side (Buyer)**

- `X402Client`: Extends A2A BaseClient with payment middleware
- `X402RemoteA2aAgent`: Remote agent wrapper with treasurer integration
- `x402_middleware`: Intercepts responses, handles PAYMENT_REQUIRED states, submits payments recursively

**Server Side (Seller)**

- `X402A2aAgentExecutor`: Wraps ADK agents with payment verification
- `make_x402_before_agent_callback()`: Creates callbacks that check payment before agent execution
- `to_a2a()`: Converts ADK agent to A2A app with x402 support
- Uses layered executor pattern: OuterA2aAgentExecutor → X402ServerExecutor → InnerA2aAgentExecutor

### Key Architectural Patterns

**Middleware Pattern**: Client uses `x402_middleware` to recursively handle payment required responses by:

1. Detecting PAYMENT_REQUIRED status in task responses
2. Calling treasurer to authorize payment
3. Submitting payment and recursing with new message

**Executor Composition**: Server uses nested executors to separate concerns:

- Outer layer handles A2A task lifecycle events
- Middle layer (X402ServerExecutor) verifies payments
- Inner layer runs the actual agent

**Protocol-based Wallets**: X402Wallet is a Protocol (structural typing), allowing any object with `create_payment()` to be used without inheritance.

## Environment Variables

Examples require these variables (see `.env.example`):

- `EXAMPLES_A2A_BUYER__PRIVATE_KEY`: Private key for buyer's EOA wallet
- `EXAMPLES_A2A_BUYER__SELLER_AGENT_URL`: URL of seller agent (default: <http://localhost:8001>)
- `GOOGLE_API_KEY`: Required for seller's google_search tool
- `EXAMPLES_A2A_SELLER__PAY_TO_ADDRESS`: Ethereum address to receive payments

## Important Notes

- Python version: 3.13+ required
- Type checking is strict mode (`mypy --strict`)
- The x402-a2a dependency comes from a git repository with a specific revision
- This SDK is marked as "unofficial" in the package description
- Tests use async mode with function-scoped fixtures
