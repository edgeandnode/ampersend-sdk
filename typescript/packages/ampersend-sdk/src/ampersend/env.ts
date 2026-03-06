import { z } from "zod"

import { OWNABLE_VALIDATOR } from "../smart-account/constants.ts"

/**
 * Environment configuration for Ampersend smart account wallets.
 *
 * Supports two formats:
 * 1. Combined: AMPERSEND_AGENT_KEY="address:::session_key"
 * 2. Separate: AMPERSEND_SMART_ACCOUNT_ADDRESS + AMPERSEND_SESSION_KEY
 *
 * The combined format is checked first. Error if both formats are present.
 */

/** Supported networks (Ampersend smart accounts only support Base) */
export const NETWORKS = ["base", "base-sepolia"] as const

export type Network = (typeof NETWORKS)[number]

/** Separator for AMPERSEND_AGENT_KEY format */
const AGENT_KEY_SEPARATOR = ":::"

/**
 * Parse AMPERSEND_AGENT_KEY format: "address:::session_key"
 */
function parseAgentKey(agentKey: string): { address: string; sessionKey: string } {
  const parts = agentKey.split(AGENT_KEY_SEPARATOR)
  if (parts.length !== 2) {
    throw new Error(
      `Invalid AMPERSEND_AGENT_KEY format. Expected "address${AGENT_KEY_SEPARATOR}session_key", got ${parts.length} parts`,
    )
  }
  const [address, sessionKey] = parts
  if (!address.startsWith("0x")) {
    throw new Error(`Invalid AMPERSEND_AGENT_KEY: address must start with 0x`)
  }
  if (!sessionKey.startsWith("0x")) {
    throw new Error(`Invalid AMPERSEND_AGENT_KEY: session key must start with 0x`)
  }
  return { address, sessionKey }
}

/**
 * Zod schema for validated config (after resolving AGENT_KEY)
 */
const configSchema = z.object({
  SMART_ACCOUNT_ADDRESS: z.string().refine((val) => val.startsWith("0x"), {
    message: "SMART_ACCOUNT_ADDRESS must start with 0x",
  }),
  SESSION_KEY: z.string().refine((val) => val.startsWith("0x"), {
    message: "SESSION_KEY must start with 0x",
  }),
  VALIDATOR_ADDRESS: z
    .string()
    .refine((val) => val.startsWith("0x"), {
      message: "VALIDATOR_ADDRESS must start with 0x",
    })
    .default(OWNABLE_VALIDATOR),
  NETWORK: z.enum(NETWORKS).default("base"),
  API_URL: z.string().url().optional(),
})

/**
 * Ampersend environment configuration
 */
export type AmpersendEnvConfig = z.infer<typeof configSchema>

/**
 * Reads and validates Ampersend environment variables.
 *
 * Checks AMPERSEND_AGENT_KEY first (combined format), then falls back to
 * separate AMPERSEND_SMART_ACCOUNT_ADDRESS + AMPERSEND_SESSION_KEY.
 *
 * @returns Validated environment configuration
 * @throws Error if configuration is invalid or missing
 */
export function parseEnvConfig(): AmpersendEnvConfig {
  const agentKey = process.env.AMPERSEND_AGENT_KEY
  const smartAccountAddress = process.env.AMPERSEND_SMART_ACCOUNT_ADDRESS
  const sessionKey = process.env.AMPERSEND_SESSION_KEY

  // Check for conflicting configuration
  if (agentKey && (smartAccountAddress || sessionKey)) {
    throw new Error(
      "Cannot use both AMPERSEND_AGENT_KEY and AMPERSEND_SMART_ACCOUNT_ADDRESS/AMPERSEND_SESSION_KEY. Use one or the other.",
    )
  }

  let address: string | undefined
  let key: string | undefined

  if (agentKey) {
    // Parse combined format
    const parsed = parseAgentKey(agentKey)
    address = parsed.address
    key = parsed.sessionKey
  } else {
    // Use separate env vars
    address = smartAccountAddress
    key = sessionKey
  }

  // Check required fields
  if (!address || !key) {
    throw new Error(
      "Missing wallet configuration. Provide either:\n" +
        "  AMPERSEND_AGENT_KEY=address:::session_key\n" +
        "or:\n" +
        "  AMPERSEND_SMART_ACCOUNT_ADDRESS + AMPERSEND_SESSION_KEY",
    )
  }

  // Build and validate config
  return configSchema.parse({
    SMART_ACCOUNT_ADDRESS: address,
    SESSION_KEY: key,
    VALIDATOR_ADDRESS: process.env.AMPERSEND_VALIDATOR_ADDRESS,
    NETWORK: process.env.AMPERSEND_NETWORK,
    API_URL: process.env.AMPERSEND_API_URL,
  })
}
