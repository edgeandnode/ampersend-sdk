"""MCP Buyer Example using x402 Proxy.

This example demonstrates using the MCP protocol to access remote tools
with automatic x402 payment handling via the ampersend-proxy.

The proxy sits between the buyer agent and the remote MCP server,
automatically handling payment requirements transparently.

Prerequisites:
    1. Start the MCP proxy (ampersend-proxy) with wallet configured
    2. Set environment variables for proxy and target server URLs

Environment Variables:
    EXAMPLE_BUYER__MCP__PROXY_URL: MCP proxy URL (e.g., http://localhost:3000/mcp)
    EXAMPLE_BUYER__MCP__TARGET_SERVER_URL: Target MCP server URL
        Default: https://subgraph-mcp.x402.staging.ampersend.ai (testnet)

Example:
    # Start proxy (in separate terminal)
    export BUYER_SMART_ACCOUNT_ADDRESS=0x...
    export BUYER_SMART_ACCOUNT_KEY_PRIVATE_KEY=0x...
    export AMPERSEND_API_URL=https://api.staging.ampersend.ai
    ampersend-proxy

    # Run this buyer agent
    export EXAMPLE_BUYER__MCP__PROXY_URL=http://localhost:3000/mcp
    export EXAMPLE_BUYER__MCP__TARGET_SERVER_URL=https://subgraph-mcp.x402.staging.ampersend.ai
    uv --directory=examples run -- adk run src/examples/mcp/buyer/adk
"""

import os

from google.adk import Agent
from google.adk.tools.mcp_tool import StreamableHTTPConnectionParams
from google.adk.tools.mcp_tool.mcp_toolset import McpToolset

# Get URLs from environment
_proxy_url = os.environ["EXAMPLE_BUYER__MCP__PROXY_URL"]
_target_server_url = os.environ.get(
    "EXAMPLE_BUYER__MCP__TARGET_SERVER_URL",
    "https://subgraph-mcp.x402.staging.ampersend.ai",
)

root_agent = Agent(
    name="mcp_buyer_agent",
    model="gemini-2.0-flash",
    description="An agent that interacts with blockchain data via MCP protocol with automatic x402 payments",
    instruction=(
        "You are an agent that can query blockchain data using The Graph subgraphs. "
        "Use the available MCP tools to answer user questions about blockchain data. "
        "Payments for queries are handled automatically by the MCP proxy."
    ),
    tools=[
        McpToolset(
            connection_params=StreamableHTTPConnectionParams(
                url=f"{_proxy_url}?target={_target_server_url}",
            ),
        ),
    ],
)
