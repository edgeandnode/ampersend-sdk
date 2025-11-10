# LangChain + x402 MCP Example

Simple example showing how to use LangChain agents with x402-enabled MCP tools.

## Prerequisites

- Running x402-enabled MCP server
- OpenAI API key
- Wallet with funds for payments

## Setup

Install dependencies:

```bash
pnpm install
```

## Environment Variables

- `TS__EXAMPLES__LANGCHAIN_MCP__MCP_SERVER_URL`: Your MCP server URL
- `TS__EXAMPLES__LANGCHAIN_MCP__PRIVATE_KEY`: Wallet private key (must start with `0x`)
- `OPENAI_API_KEY`: Your OpenAI API key

## Run

Run with default demo query:

```bash
pnpm dev
```

Or provide your own query:

```bash
pnpm dev "What is 42 plus 17?"
pnpm dev "Add 100 and 200"
pnpm dev "Echo hello world"
```

## How it works

1. Creates `AccountWallet` from private key
2. Uses `NaiveTreasurer` to auto-approve payments
3. Connects `X402 Client` to MCP server
4. Loads MCP tools into LangChain with `loadMcpTools()`
5. Creates LangChain agent with OpenAI
6. Agent automatically handles x402 payments when calling tools
