import { z } from "zod"

/**
 * Creates a Zod schema for environment variable validation with configurable prefix.
 *
 * @param envPrefix - The environment variable prefix (empty string for no prefix)
 * @returns Zod schema for validating environment variables
 */
export function createEnvSchema(envPrefix = "") {
  return z
    .object({
      PORT: z.coerce.number().int().min(1).max(65535).optional(),
      BUYER_PRIVATE_KEY: z
        .string()
        .refine((val) => val.startsWith("0x"), {
          message: "Must start with 0x",
        })
        .optional(),
      BUYER_SMART_ACCOUNT_ADDRESS: z
        .string()
        .refine((val) => val.startsWith("0x"), {
          message: "Must start with 0x",
        })
        .optional(),
      BUYER_SMART_ACCOUNT_KEY_PRIVATE_KEY: z
        .string()
        .refine((val) => val.startsWith("0x"), {
          message: "Must start with 0x",
        })
        .optional(),
      BUYER_SMART_ACCOUNT_VALIDATOR_ADDRESS: z
        .string()
        .refine((val) => val.startsWith("0x"), {
          message: "Must start with 0x",
        })
        .optional(),
      BUYER_SMART_ACCOUNT_CHAIN_ID: z.coerce.number().int().optional(),
    })
    .refine(
      (data) => {
        // Cannot have both EOA and Smart Account config
        return !(data.BUYER_PRIVATE_KEY && data.BUYER_SMART_ACCOUNT_ADDRESS)
      },
      {
        message: `Cannot specify both ${envPrefix}BUYER_PRIVATE_KEY and ${envPrefix}BUYER_SMART_ACCOUNT_ADDRESS. Only one wallet type allowed.`,
        path: ["BUYER_PRIVATE_KEY"],
      },
    )
    .refine(
      (data) => {
        // If smart account address is set, all smart account fields must be set
        if (data.BUYER_SMART_ACCOUNT_ADDRESS) {
          return (
            data.BUYER_SMART_ACCOUNT_KEY_PRIVATE_KEY !== undefined &&
            data.BUYER_SMART_ACCOUNT_VALIDATOR_ADDRESS !== undefined
          )
        }
        return true
      },
      {
        message: `Smart Account mode requires all fields: ${envPrefix}BUYER_SMART_ACCOUNT_ADDRESS, ${envPrefix}BUYER_SMART_ACCOUNT_KEY_PRIVATE_KEY, ${envPrefix}BUYER_SMART_ACCOUNT_VALIDATOR_ADDRESS`,
        path: ["BUYER_SMART_ACCOUNT_ADDRESS"],
      },
    )
    .refine(
      (data) => {
        // At least one wallet type must be configured
        return data.BUYER_PRIVATE_KEY || data.BUYER_SMART_ACCOUNT_ADDRESS
      },
      {
        message:
          `Missing wallet configuration. Provide either:\n` +
          `  - EOA mode: ${envPrefix}BUYER_PRIVATE_KEY\n` +
          `  - Smart Account mode: ${envPrefix}BUYER_SMART_ACCOUNT_ADDRESS, ` +
          `${envPrefix}BUYER_SMART_ACCOUNT_KEY_PRIVATE_KEY, ${envPrefix}BUYER_SMART_ACCOUNT_VALIDATOR_ADDRESS`,
        path: ["BUYER_PRIVATE_KEY"],
      },
    )
}

/**
 * Type inferred from the env schema
 */
export type ProxyEnvConfig = z.infer<ReturnType<typeof createEnvSchema>>

/**
 * Reads and validates environment variables with the given prefix
 *
 * @param envPrefix - The environment variable prefix (empty string for no prefix)
 * @returns Validated environment configuration
 * @throws ZodError if validation fails
 */
export function parseEnvConfig(envPrefix = ""): ProxyEnvConfig {
  // Read env vars with prefix
  const envVars: Record<string, string | undefined> = {
    PORT: process.env[`${envPrefix}PORT`],
    BUYER_PRIVATE_KEY: process.env[`${envPrefix}BUYER_PRIVATE_KEY`],
    BUYER_SMART_ACCOUNT_ADDRESS: process.env[`${envPrefix}BUYER_SMART_ACCOUNT_ADDRESS`],
    BUYER_SMART_ACCOUNT_KEY_PRIVATE_KEY: process.env[`${envPrefix}BUYER_SMART_ACCOUNT_KEY_PRIVATE_KEY`],
    BUYER_SMART_ACCOUNT_VALIDATOR_ADDRESS: process.env[`${envPrefix}BUYER_SMART_ACCOUNT_VALIDATOR_ADDRESS`],
    BUYER_SMART_ACCOUNT_CHAIN_ID: process.env[`${envPrefix}BUYER_SMART_ACCOUNT_CHAIN_ID`],
  }

  // Validate with schema
  const schema = createEnvSchema(envPrefix)
  return schema.parse(envVars)
}
