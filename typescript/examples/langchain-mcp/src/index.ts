import { createReactAgent } from "@langchain/langgraph/prebuilt"
import { loadMcpTools } from "@langchain/mcp-adapters"
import { ChatOpenAI } from "@langchain/openai"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"

import { Client } from "@edgeandnode/ampersend-sdk/mcp/client"
import { AccountWallet, NaiveTreasurer } from "@edgeandnode/ampersend-sdk/x402"

const MCP_SERVER_URL = process.env.TS__EXAMPLES__LANGCHAIN_MCP__MCP_SERVER_URL
const PRIVATE_KEY = process.env.TS__EXAMPLES__LANGCHAIN_MCP__PRIVATE_KEY
const OPENAI_API_KEY = process.env.OPENAI_API_KEY

if (!MCP_SERVER_URL || !PRIVATE_KEY || !OPENAI_API_KEY) {
  console.error("Missing required environment variables:")
  console.error("  TS__EXAMPLES__LANGCHAIN_MCP__MCP_SERVER_URL - URL of the x402-enabled MCP server")
  console.error("  TS__EXAMPLES__LANGCHAIN_MCP__PRIVATE_KEY - Wallet private key (must start with 0x)")
  console.error("  OPENAI_API_KEY - OpenAI API key")
  process.exit(1)
}

// Type assertions after check
const serverUrl: string = MCP_SERVER_URL
const privateKey = PRIVATE_KEY as `0x${string}`
const openaiKey: string = OPENAI_API_KEY

async function main() {
  // Setup payment wallet and treasurer
  const wallet = AccountWallet.fromPrivateKey(privateKey)
  const treasurer = new NaiveTreasurer(wallet)

  // Create X402 MCP client with payment support
  const client = new Client(
    { name: "langchain-example", version: "1.0.0" },
    {
      mcpOptions: { capabilities: { tools: {} } },
      treasurer,
    },
  )

  // Connect to MCP server
  const transport = new StreamableHTTPClientTransport(new URL(serverUrl))
  await client.connect(transport as any)
  console.log("Connected to MCP server")

  try {
    // Load MCP tools for LangChain
    const tools = await loadMcpTools("x402-server", client as any, {
      throwOnLoadError: true,
      prefixToolNameWithServerName: false,
    })

    console.log(`Loaded ${tools.length} tools from MCP server`)

    // Create LangChain agent with OpenAI
    const model = new ChatOpenAI({
      apiKey: openaiKey,
      modelName: "gpt-4o-mini",
    })

    const agent = createReactAgent({ llm: model, tools })

    // Get query from command line or use default
    // Filter out '--' separator that pnpm may add, then join all args
    const args = process.argv.slice(2).filter((arg) => arg !== "--")
    const query = args.length > 0 ? args.join(" ") : "What is 5 plus 3?"
    console.log(`\nQuery: ${query}`)
    console.log("Invoking agent...\n")

    const response = await agent.invoke({
      messages: [{ role: "user", content: query }],
    })

    console.log("Agent response:")
    console.log(response.messages[response.messages.length - 1].content)
  } finally {
    // Cleanup
    await client.close()
    console.log("\nDisconnected from MCP server")
  }
}

main().catch((error) => {
  console.error("Error:", error)
  process.exit(1)
})
