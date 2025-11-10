#!/usr/bin/env node
import { Command } from "commander"
import type { Address } from "viem"

import { createNaiveTreasurer } from "../../x402/index.ts"
import { parseEnvConfig, type ProxyEnvConfig } from "./env.ts"
import { initializeProxyServer } from "./server/index.ts"
import {
  type EOAWalletConfig,
  type ProxyServerOptions,
  type SmartAccountWalletConfig,
  type TransportConfig,
  type WalletConfig,
} from "./types.js"

/**
 * Creates transport configuration from CLI options and environment variables.
 * CLI arguments take precedence over environment variables.
 *
 * @param cliPort - Port from CLI arguments (optional)
 * @param envConfig - Validated environment configuration
 * @returns TransportConfig with resolved port
 */
export function createTransportConfig(cliPort: number | undefined, envConfig: ProxyEnvConfig): TransportConfig {
  const port = cliPort ?? envConfig.PORT ?? 8402
  return {
    type: "http",
    port,
  }
}

/**
 * Creates wallet configuration from validated environment variables.
 *
 * Supports two mutually exclusive modes:
 * - EOA mode: Uses BUYER_PRIVATE_KEY
 * - Smart Account mode: Uses BUYER_SMART_ACCOUNT_* variables
 *
 * @param envConfig - Validated environment configuration
 * @returns WalletConfig for either EOA or Smart Account mode
 */
export function createWalletConfig(envConfig: ProxyEnvConfig): WalletConfig {
  if (!envConfig.BUYER_SMART_ACCOUNT_ADDRESS && !envConfig.BUYER_PRIVATE_KEY) {
    throw new Error(`Must provide either EOA or Smart Account configuration`)
  }

  // Smart Account mode
  if (envConfig.BUYER_SMART_ACCOUNT_ADDRESS) {
    const smartAccountWalletConfig: SmartAccountWalletConfig = {
      type: "smart-account",
      smartAccountAddress: envConfig.BUYER_SMART_ACCOUNT_ADDRESS as `0x${string}`,
      sessionKeyPrivateKey: envConfig.BUYER_SMART_ACCOUNT_KEY_PRIVATE_KEY! as `0x${string}`,
      chainId: envConfig.BUYER_SMART_ACCOUNT_CHAIN_ID ?? 84532,
      validatorAddress: envConfig.BUYER_SMART_ACCOUNT_VALIDATOR_ADDRESS! as Address,
    }
    return smartAccountWalletConfig
  }

  // EOA mode
  const eoaWalletConfig: EOAWalletConfig = {
    type: "eoa",
    privateKey: envConfig.BUYER_PRIVATE_KEY as `0x${string}`,
  }
  return eoaWalletConfig
}

/**
 * Parses command-line arguments and environment variables to build proxy configuration
 */
function parseOptions(args: Array<string>, envPrefix = ""): ProxyServerOptions {
  // Parse CLI arguments first to check for env-prefix flag
  const program = new Command()
    .name("ampersend-proxy")
    .description("MCP x402 proxy server with naive treasurer")
    .version("0.1.0")
    .option("-p, --port <number>", "Port number (overrides env)", (value) => parseInt(value, 10))
    .option("-e, --env-prefix <value>", "Environment variable prefix (empty string for no prefix)")
    .parse(args, { from: "user" })

  const opts = program.opts<{ port?: number; envPrefix?: string }>()

  // Resolve envPrefix: CLI flag takes precedence over function argument
  const resolvedEnvPrefix = opts.envPrefix ?? envPrefix

  // Parse environment variables with validation
  const envConfig = parseEnvConfig(resolvedEnvPrefix)

  // Build configuration (CLI args override env vars)
  const transport = createTransportConfig(opts.port, envConfig)
  const walletConfig = createWalletConfig(envConfig)
  const treasurer = createNaiveTreasurer(walletConfig)

  return {
    transport,
    treasurer,
  }
}

/**
 * Main entry point for the MCP x402 proxy CLI
 */
async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2))

  console.log("[MCP-PROXY] Starting naive treasurer proxy...")
  console.log(`[MCP-PROXY] Port: ${options.transport.port}`)

  const { server } = await initializeProxyServer(options)

  console.log("[MCP-PROXY] Proxy server started successfully")

  const shutdown = async () => {
    console.warn("[MCP-PROXY] Shutting down...")
    await server.stop()
    process.exit(0)
  }

  // Handle graceful shutdown
  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("[MCP-PROXY] (FATAL)", error)
    process.exit(1)
  })
}
