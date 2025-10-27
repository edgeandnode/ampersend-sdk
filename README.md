# Ampersend SDK

A Python SDK that extends the [A2A (Agent-to-Agent) protocol](https://github.com/google/a2a) with x402 payment capabilities. Build AI agents that can send and receive payments during interactions.

## 🚀 Prerequisites

**uv** is required for dependency management. Install with:

```bash
# macOS/Linux
curl -LsSf https://astral.sh/uv/install.sh | sh

# Windows
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"

# Alternative: Homebrew
brew install uv
```

## ⚙️ Setup

1. **Install Python 3.13:**

   ```bash
   uv python install 3.13
   ```

2. **Install dependencies:**

   ```bash
   uv sync --frozen --group dev
   ```

3. **Configure environment variables:**

   ```bash
   cp .env.example .env
   # Edit .env and fill in your values:
   # - EXAMPLES_A2A_BUYER__PRIVATE_KEY: Private key for buyer's wallet
   # - EXAMPLES_A2A_BUYER__SELLER_AGENT_URL: URL of seller agent (default: http://localhost:8001)
   # - GOOGLE_API_KEY: Required for seller's Google Search tool
   # - EXAMPLES_A2A_SELLER__PAY_TO_ADDRESS: Ethereum address to receive payments
   ```

4. **Obtain required credentials:**

   **Google API Key** (required for seller example):

   1. Visit [Google AI Studio](https://aistudio.google.com/app/apikey)
   2. Sign in with your Google account
   3. Click "Get API key" or "Create API key"
   4. Copy the generated key and add it to your `.env` file

   **USDC Testnet Tokens** (required for buyer example):

   Use the [Circle USDC testnet faucet](https://faucet.circle.com) to obtain test USDC for your buyer wallet address.

### 💡 Optional: direnv

For automatic environment variable loading, install [direnv](https://direnv.net/):

```bash
# macOS
brew install direnv

# Then add to your shell config (e.g., ~/.zshrc):
eval "$(direnv hook zsh)"

# Allow direnv in this directory:
direnv allow
```

## 🔧 Development

**Run tests:**

```bash
uv run -- pytest                      # All tests
```

**Linting and formatting:**

```bash
uv run -- ruff check python          # Lint
uv run -- ruff format python         # Format
uv run -- mypy python                # Type check
```

## 🤖 Running Examples

The examples demonstrate a buyer agent querying a seller agent that requires payment.

**Terminal 1 - Start the seller agent:**

```bash
uv --directory=python/examples run -- uvicorn examples.a2a.seller.adk.agent:a2a_app --host localhost --port 8001
```

**Terminal 2 - Run the buyer agent:**

Option 1: Command-line query

```bash
echo "when was x402 founded?" | uv --directory=python/examples run -- adk run src/examples/a2a/buyer/adk
```

Option 2: Interactive web UI

```bash
uv --directory=python/examples run -- adk web src/examples/a2a/buyer
# Open http://localhost:8000 in your browser
```
