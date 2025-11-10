#!/usr/bin/env node
import { start } from "./server.js"

// Handle process signals gracefully
process.on("SIGINT", () => {
  console.log("\n👋 Shutting down FastMCP x402 Example Server...")
  process.exit(0)
})

process.on("SIGTERM", () => {
  console.log("\n👋 Shutting down FastMCP x402 Example Server...")
  process.exit(0)
})

// Start the server
start().catch((error) => {
  console.error("❌ Failed to start server:", error)
  process.exit(1)
})
