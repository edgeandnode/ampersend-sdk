# FastMCP x402 Example

A simple example FastMCP server demonstrating basic functionality. This server provides basic math operations (`add`) and echo functionality through the MCP (Model Context Protocol) interface.

## Overview

This example serves as a minimal FastMCP server implementation that can be used as a reference for building more complex MCP servers. It demonstrates:

- **Basic Tool Implementation**: Simple `add` and `echo` tools
- **HTTP Transport**: Stateless HTTP streaming transport
- **Server-Sent Events**: Proper SSE response handling
- **Error Handling**: Graceful error management and logging

## Installation

```bash
# Install dependencies
pnpm install

# Build the package
pnpm build
```

## Usage

### Running the Server

Start the server on the default port (8080):

```bash
# Using the built CLI
pnpm build
node dist/cli.js

# Using npm/pnpm scripts
pnpm start

# Development mode with hot reload
pnpm dev
```

The server will start and display:

```
🚀 Starting FastMCP x402 Example Server on port 8080
📡 Connect with: http://localhost:8080/mcp
```

### Custom Port

Set a different port using the `PORT` environment variable:

```bash
PORT=3000 pnpm start
```

### Testing the Server

#### Test the Add Tool

```bash
curl -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"add","arguments":{"a":5,"b":3}},"id":1}'
```

Expected response:

```
event: message
data: {"result":{"content":[{"text":"8","type":"text"}]},"jsonrpc":"2.0","id":1}
```

#### Test the Echo Tool

```bash
curl -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"echo","arguments":{"message":"Hello World"}},"id":1}'
```

Expected response:

```
event: message
data: {"result":{"content":[{"text":"Hello World","type":"text"}]},"jsonrpc":"2.0","id":1}
```

## Available Tools

### `add`

- **Description**: Add two numbers
- **Parameters**:
  - `a` (number): First number
  - `b` (number): Second number
- **Returns**: String representation of the sum

### `echo`

- **Description**: Echo a message
- **Parameters**:
  - `message` (string): Message to echo
- **Returns**: The input message

## Development

### Scripts

- `pnpm build` - Build the TypeScript code
- `pnpm dev` - Run in development mode with hot reload
- `pnpm start` - Run the built server
- `pnpm clean` - Clean build artifacts
- `pnpm typecheck` - Run TypeScript type checking
- `pnpm lint` - Run ESLint
- `pnpm lint:fix` - Fix ESLint issues automatically
- `pnpm format` - Check code formatting
- `pnpm format:fix` - Fix code formatting
- `pnpm test` - Run tests

### Project Structure

```
src/
├── index.ts    # Main exports
├── server.ts   # FastMCP server implementation
└── cli.ts      # CLI entry point
```

## License

This package is part of the Ampersend monorepo.
