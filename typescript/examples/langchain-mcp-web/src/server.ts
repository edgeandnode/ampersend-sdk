import { HumanMessage } from "@langchain/core/messages"
import { createReactAgent } from "@langchain/langgraph/prebuilt"
import { loadMcpTools } from "@langchain/mcp-adapters"
import { ChatOpenAI } from "@langchain/openai"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import cors from "cors"
import dotenv from "dotenv"
import express from "express"

import { Client } from "@edgeandnode/ampersend-sdk/mcp/client"
import { AccountWallet, NaiveTreasurer } from "@edgeandnode/ampersend-sdk/x402"

// Load environment variables from .env file
dotenv.config()

const MCP_SERVER_URL = process.env.TS__EXAMPLES__LANGCHAIN_MCP__MCP_SERVER_URL
const PRIVATE_KEY = process.env.TS__EXAMPLES__LANGCHAIN_MCP__PRIVATE_KEY
const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const PORT = process.env.PORT || 3001

if (!MCP_SERVER_URL || !PRIVATE_KEY || !OPENAI_API_KEY) {
  console.error("Missing required environment variables:")
  console.error("  TS__EXAMPLES__LANGCHAIN_MCP__MCP_SERVER_URL - URL of the x402-enabled MCP server")
  console.error("  TS__EXAMPLES__LANGCHAIN_MCP__PRIVATE_KEY - Wallet private key (must start with 0x)")
  console.error("  OPENAI_API_KEY - OpenAI API key")
  process.exit(1)
}

const serverUrl: string = MCP_SERVER_URL
const privateKey = PRIVATE_KEY as `0x${string}`
const openaiKey: string = OPENAI_API_KEY

const app = express()
app.use(cors())
app.use(express.json())

let agent: any = null
let mcpClient: Client | null = null

// Initialize agent on startup
async function initializeAgent() {
  try {
    console.log("Initializing x402 MCP client and LangChain agent...")

    // Setup payment wallet and treasurer
    const wallet = AccountWallet.fromPrivateKey(privateKey)
    const treasurer = new NaiveTreasurer(wallet)

    // Create X402 MCP client with payment support
    mcpClient = new Client(
      { name: "langchain-chat-ui", version: "1.0.0" },
      {
        mcpOptions: { capabilities: { tools: {} } },
        treasurer,
      },
    )

    // Connect to MCP server
    const transport = new StreamableHTTPClientTransport(new URL(serverUrl))
    await mcpClient.connect(transport as any)
    console.log("✓ Connected to MCP server")

    // Load MCP tools for LangChain
    const tools = await loadMcpTools("x402-server", mcpClient as any, {
      throwOnLoadError: true,
      prefixToolNameWithServerName: false,
    })

    console.log(`✓ Loaded ${tools.length} tools from MCP server`)

    // Create LangChain agent with OpenAI
    const model = new ChatOpenAI({
      apiKey: openaiKey,
      modelName: "gpt-4o-mini",
      streaming: true,
    })

    agent = createReactAgent({ llm: model, tools })
    console.log("✓ LangChain agent initialized")
  } catch (error) {
    console.error("Failed to initialize agent:", error)
    throw error
  }
}

// Chat endpoint with streaming support
app.post("/api/chat", async (req, res) => {
  try {
    const { message, history = [] } = req.body

    console.log("\n📨 Received message:", message)
    console.log("📜 History length:", history.length)

    if (!message) {
      return res.status(400).json({ error: "Message is required" })
    }

    if (!agent) {
      return res.status(503).json({ error: "Agent not initialized" })
    }

    // Set up SSE (Server-Sent Events) for streaming
    res.setHeader("Content-Type", "text/event-stream")
    res.setHeader("Cache-Control", "no-cache")
    res.setHeader("Connection", "keep-alive")

    // Convert history to LangChain message format
    const messages = history.map((msg: any) => new HumanMessage(msg.content))

    // Add current message
    messages.push(new HumanMessage(message))

    console.log("🚀 Invoking agent...")

    try {
      // Stream the agent response
      const stream = await agent.stream({
        messages,
      })

      let chunkCount = 0
      for await (const chunk of stream) {
        chunkCount++
        console.log(`📦 Chunk ${chunkCount}:`, JSON.stringify(chunk, null, 2))

        // Extract the latest message from the agent node
        if (chunk.agent && chunk.agent.messages && chunk.agent.messages.length > 0) {
          const agentMessages = chunk.agent.messages
          const lastMessage = agentMessages[agentMessages.length - 1]

          console.log("🤖 Agent message:", lastMessage)

          // Handle tool calls
          if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
            console.log("🔧 Tool calls detected:", lastMessage.tool_calls)
            res.write(
              `data: ${JSON.stringify({
                type: "tool_calls",
                tools: lastMessage.tool_calls.map((tc: any) => ({
                  name: tc.name,
                  args: JSON.stringify(tc.args, null, 2),
                })),
              })}\n\n`,
            )
          }

          // Handle content
          if (lastMessage.content && typeof lastMessage.content === "string") {
            console.log("💬 Content:", lastMessage.content)
            res.write(
              `data: ${JSON.stringify({
                type: "content",
                content: lastMessage.content,
              })}\n\n`,
            )
          }
        }

        // Also check for tool execution results
        if (chunk.tools && chunk.tools.messages) {
          console.log("🛠️ Tool results:", chunk.tools.messages)
          for (const toolMsg of chunk.tools.messages) {
            if (toolMsg.content) {
              res.write(
                `data: ${JSON.stringify({
                  type: "tool_result",
                  content: toolMsg.content,
                })}\n\n`,
              )
            }
          }
        }
      }

      console.log(`✅ Stream complete (${chunkCount} chunks)`)

      // Send completion event
      res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`)
      res.end()
    } catch (streamError) {
      console.error("❌ Streaming error:", streamError)
      console.error("Stack trace:", (streamError as Error).stack)
      res.write(
        `data: ${JSON.stringify({
          type: "error",
          error: streamError instanceof Error ? streamError.message : "Failed to stream response",
        })}\n\n`,
      )
      res.end()
    }
  } catch (error) {
    console.error("❌ Chat error:", error)
    console.error("Stack trace:", (error as Error).stack)
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" })
    }
  }
})

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    status: agent ? "ready" : "initializing",
    timestamp: new Date().toISOString(),
  })
})

// Get available tools
app.get("/api/tools", async (req, res) => {
  try {
    if (!mcpClient) {
      return res.status(503).json({ error: "MCP client not initialized" })
    }

    const toolsList = await mcpClient.listTools()
    res.json({
      tools: toolsList.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
      })),
    })
  } catch (error) {
    console.error("Error fetching tools:", error)
    res.status(500).json({ error: "Failed to fetch tools" })
  }
})

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\nShutting down gracefully...")
  if (mcpClient) {
    await mcpClient.close()
  }
  process.exit(0)
})

// Start server
async function start() {
  await initializeAgent()

  app.listen(PORT, () => {
    console.log(`\n🚀 Server running on http://localhost:${PORT}`)
    console.log(`📡 Chat endpoint: http://localhost:${PORT}/api/chat`)
    console.log(`🔧 Tools endpoint: http://localhost:${PORT}/api/tools`)
  })
}

start().catch((error) => {
  console.error("Failed to start server:", error)
  process.exit(1)
})
