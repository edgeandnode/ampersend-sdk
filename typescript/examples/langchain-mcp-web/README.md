# LangChain x402 Agent Chat UI

Beautiful web-based chat interface for interacting with LangChain agents that use x402-enabled MCP tools. Features real-time streaming responses and automatic payment handling.

## Features

- 🎨 Modern, responsive chat UI
- ⚡ Real-time streaming responses
- 🔧 Tool usage visualization
- 💰 Automatic x402 payment handling
- 🤖 Powered by LangChain and OpenAI

## Prerequisites

- Running x402-enabled MCP server **with valid payment address configured**
- OpenAI API key
- Wallet with funds for payments
- Node.js 18+

### Important: MCP Server Configuration

Your MCP server **must** have a valid payment address configured. If using the `fastmcp-x402-server` example, set:

```bash
export TS__EXAMPLES__FASTMCP_X402_SERVER__PAY_TO_ADDRESS="0xYourValidAddress"
```

**DO NOT use `0x0` or leave it blank** - this will cause "Address is invalid" errors.

## Setup

1. Install dependencies:

```bash
pnpm install
```

2. Create a `.env` file:

```bash
cp .env.example .env
# Then edit .env with your actual values
```

3. Configure your `.env` file:

```bash
TS__EXAMPLES__LANGCHAIN_MCP__MCP_SERVER_URL=http://localhost:8080/mcp
TS__EXAMPLES__LANGCHAIN_MCP__PRIVATE_KEY=0xYourPrivateKeyHere
OPENAI_API_KEY=sk-YourOpenAIKeyHere
PORT=3001
```

## Environment Variables

The server automatically loads variables from `.env`:

- `TS__EXAMPLES__LANGCHAIN_MCP__MCP_SERVER_URL`: Your MCP server URL (include `/mcp` endpoint)
- `TS__EXAMPLES__LANGCHAIN_MCP__PRIVATE_KEY`: Wallet private key (must start with `0x`)
- `OPENAI_API_KEY`: Your OpenAI API key
- `PORT` (optional): Backend server port (default: 3001)

## Run Development Mode

Start both the backend server and frontend UI:

```bash
pnpm dev
```

This will:
- Start the backend API server on port 3001
- Start the frontend dev server on port 3000
- Open the chat UI in your browser automatically

## Run Backend Only

```bash
pnpm dev:server
```

## Run Frontend Only

```bash
pnpm dev:client
```

## Build for Production

```bash
pnpm build
```

This creates:
- Backend: `dist/server.js`
- Frontend: `dist/client/`

## Run Production Build

After building:

```bash
# Start the backend (you'll need to serve the frontend separately)
pnpm start
```

## How it works

### Backend (`src/server.ts`)

1. Creates `AccountWallet` from private key
2. Uses `NaiveTreasurer` to auto-approve payments
3. Connects `X402 Client` to MCP server
4. Loads MCP tools into LangChain with `loadMcpTools()`
5. Creates LangChain agent with OpenAI
6. Exposes REST API endpoints:
   - `POST /api/chat` - Stream chat responses using Server-Sent Events (SSE)
   - `GET /api/tools` - List available MCP tools
   - `GET /api/health` - Health check endpoint

### Frontend (`src/App.tsx`)

1. Beautiful React-based chat interface
2. Real-time streaming of agent responses
3. Visualizes tool calls and arguments
4. Shows connection status and available tools
5. Responsive design for mobile and desktop

## API Endpoints

### POST /api/chat

Send a message to the agent and receive a streaming response.

**Request:**
```json
{
  "message": "What is 42 plus 17?",
  "history": [
    { "role": "user", "content": "Hello" },
    { "role": "assistant", "content": "Hi! How can I help?" }
  ]
}
```

**Response:** Server-Sent Events (SSE) stream with:
- `{ type: "content", content: "..." }` - Response text chunks
- `{ type: "tool_calls", tools: [...] }` - Tool invocations
- `{ type: "done" }` - Stream complete
- `{ type: "error", error: "..." }` - Error occurred

### GET /api/tools

List all available MCP tools.

**Response:**
```json
{
  "tools": [
    { "name": "add", "description": "Add two numbers" },
    { "name": "echo", "description": "Echo a message" }
  ]
}
```

### GET /api/health

Check server status.

**Response:**
```json
{
  "status": "ready",
  "timestamp": "2025-11-12T10:30:00.000Z"
}
```

## Example Queries

Try these in the chat interface:

- "What is 42 plus 17?"
- "Add 100 and 200"
- "Echo hello world"
- "Can you help me calculate 15 * 8 + 23?"

## Architecture

```
┌─────────────────┐
│  React Frontend │  (Port 3000)
│   (Vite + React) │
└────────┬────────┘
         │ HTTP/SSE
         ▼
┌─────────────────┐
│  Express Server │  (Port 3001)
│                 │
│  ┌───────────┐  │
│  │ LangChain │  │
│  │   Agent   │  │
│  └─────┬─────┘  │
│        │        │
│  ┌─────▼─────┐  │
│  │ X402 MCP  │  │
│  │  Client   │  │
│  └─────┬─────┘  │
└────────┼────────┘
         │ x402
         ▼
   ┌─────────────┐
   │ MCP Server  │
   │ (with x402) │
   └─────────────┘
```

## Troubleshooting

### Server won't start

- Make sure all environment variables are set
- Check that the MCP server is running and accessible
- Verify your wallet has sufficient funds

### Frontend shows "Connection Error"

- Ensure the backend server is running on port 3001
- Check browser console for CORS errors
- Verify the API_URL in `src/App.tsx` matches your backend

### Agent responses are slow

- Check your internet connection to OpenAI
- Verify the MCP server is responding quickly
- Consider using a different OpenAI model

## Development

The project uses:
- **Backend:** Express.js with TypeScript
- **Frontend:** React with Vite
- **Agent:** LangChain with OpenAI
- **MCP:** x402-enabled client for paid tool access
- **Styling:** Custom CSS with modern design

To modify:
- Backend logic: `src/server.ts`
- Frontend UI: `src/App.tsx` and `src/App.css`
- Build config: `vite.config.ts`, `tsconfig.json`

## License

See root LICENSE file.
