#!/usr/bin/env node
import { start } from "./server.js"

process.on("SIGINT", () => {
  console.log("\nShutting down Agent Identity Gate server...")
  process.exit(0)
})

process.on("SIGTERM", () => {
  console.log("\nShutting down Agent Identity Gate server...")
  process.exit(0)
})

start().catch((error) => {
  console.error("Failed to start server:", error)
  process.exit(1)
})
