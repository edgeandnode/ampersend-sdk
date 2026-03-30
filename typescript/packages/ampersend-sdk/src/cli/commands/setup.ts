import type { Command } from "commander"
import { isAddress } from "viem"
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts"

import { ApprovalClient } from "../../ampersend/approval.ts"
import {
  clearPendingApproval,
  computeApprovalExpiry,
  DEFAULT_API_URL,
  isPendingExpired,
  promotePending,
  readConfig,
  storePendingApproval,
} from "../config.ts"
import { err, ok, type JsonEnvelope } from "../envelope.ts"

// ─── setup start ───────────────────────────────────────────────────────────────

export interface SetupStartOptions {
  name?: string
  agent?: string
  force: boolean
  dailyLimit?: string
  monthlyLimit?: string
  perTransactionLimit?: string
  autoTopup: boolean
}

export async function executeSetupStart(options: SetupStartOptions): Promise<void> {
  const existing = readConfig()

  // Check for non-expired pending approval
  if (existing?.pendingApproval && !options.force) {
    if (!isPendingExpired(existing.pendingApproval)) {
      console.log(
        JSON.stringify(
          err("PENDING_EXISTS", "A pending approval already exists. Use --force to create a new one."),
          null,
          2,
        ),
      )
      process.exit(1)
    }
    // Expired locally — clear it and proceed
  }

  // Generate a new key for this approval (lives in pending slot, not active)
  const agentKey = generatePrivateKey()
  const agentKeyAddress = privateKeyToAddress(agentKey)

  // Resolve API URL: env > config > default
  const apiUrl = process.env.AMPERSEND_API_URL ?? existing?.apiUrl ?? DEFAULT_API_URL

  // Call the approval API
  const client = new ApprovalClient({ apiUrl })

  let result: JsonEnvelope<{
    token: string
    user_approve_url: string
    agentKeyAddress: string
  }>

  try {
    let response

    if (options.agent) {
      // Connect key to existing agent account
      if (!isAddress(options.agent)) {
        console.log(JSON.stringify(err("INVALID_ADDRESS", `Invalid agent address: ${options.agent}`), null, 2))
        process.exit(1)
      }

      response = await client.requestConnectAgentKey({
        agent_address: options.agent as `0x${string}`,
        agent_key_address: agentKeyAddress,
        key_name: options.name ?? null,
      })
    } else {
      // Create new agent account (existing flow)
      const hasSpendConfig =
        options.dailyLimit != null ||
        options.monthlyLimit != null ||
        options.perTransactionLimit != null ||
        options.autoTopup

      const spendConfig = hasSpendConfig
        ? {
            auto_topup_allowed: options.autoTopup,
            daily_limit: options.dailyLimit ?? null,
            monthly_limit: options.monthlyLimit ?? null,
            per_transaction_limit: options.perTransactionLimit ?? null,
          }
        : undefined

      response = await client.requestAgentCreation({
        name: options.name ?? null,
        agent_key_address: agentKeyAddress,
        spend_config: spendConfig,
      })
    }

    // Store pending approval in config
    storePendingApproval({
      token: response.token,
      agentKey,
      expiresAt: computeApprovalExpiry(),
    })

    result = ok({
      token: response.token,
      user_approve_url: response.user_approve_url,
      agentKeyAddress,
    })
  } catch (error) {
    result = err("API_ERROR", error instanceof Error ? error.message : String(error))
  }

  console.log(JSON.stringify(result, null, 2))
  process.exit(result.ok ? 0 : 1)
}

// ─── setup finish ──────────────────────────────────────────────────────────────

export interface SetupFinishOptions {
  force: boolean
  pollInterval: number
  timeout: number
}

export async function executeSetupFinish(options: SetupFinishOptions): Promise<void> {
  const result = await pollForApproval(options)
  console.log(JSON.stringify(result, null, 2))
  process.exit(result.ok ? 0 : 1)
}

async function pollForApproval(options: SetupFinishOptions): Promise<
  JsonEnvelope<{
    agentKeyAddress: string
    agentAccount: string
    status: string
  }>
> {
  const existing = readConfig()

  if (!existing?.pendingApproval) {
    return err("NO_PENDING", 'No pending approval found. Run "ampersend setup start" first.')
  }

  // Check if already configured and not --force
  if (existing.agentKey && existing.agentAccount && !options.force) {
    return err("ALREADY_CONFIGURED", "Agent is already configured. Use --force to overwrite with the pending approval.")
  }

  const pending = existing.pendingApproval
  const pendingKeyAddress = privateKeyToAddress(pending.agentKey)

  // Resolve API URL: env > config > default
  const apiUrl = process.env.AMPERSEND_API_URL ?? existing.apiUrl ?? DEFAULT_API_URL
  const client = new ApprovalClient({ apiUrl })

  const pollIntervalMs = options.pollInterval * 1000
  const timeoutMs = options.timeout * 1000
  const startTime = Date.now()

  // Poll loop
  while (Date.now() - startTime < timeoutMs) {
    let status
    try {
      status = await client.getApprovalStatus(pending.token)
    } catch (error) {
      // Transient API errors — keep pending so user can retry with `setup finish`
      return err("API_ERROR", error instanceof Error ? error.message : String(error))
    }

    if (status.status === "pending") {
      await sleep(pollIntervalMs)
      continue
    }

    if (status.status === "rejected" || status.status === "blocked") {
      clearPendingApproval()
      return err("APPROVAL_REJECTED", `Approval was ${status.status} by the user.`)
    }

    if (status.status === "resolved") {
      // Check if we got the agent address back
      if ("agent" in status && status.agent) {
        const agentAddress = status.agent.address as `0x${string}`

        // TODO: Once API returns agent_key_address in the resolved response,
        // make this check required instead of optional.
        if (status.agent.agent_key_address != null) {
          // Normalize to lowercase — API may return a different checksum than privateKeyToAddress
          if (status.agent.agent_key_address.toLowerCase() !== pendingKeyAddress.toLowerCase()) {
            clearPendingApproval()
            return err(
              "KEY_MISMATCH",
              `Approval resolved for a different agent key. Expected ${pendingKeyAddress}, got ${status.agent.agent_key_address}`,
            )
          }
        }

        // Promote pending → active
        return promotePending(agentAddress)
      }

      // Resolved but no agent info — keep pending so user can retry
      return err(
        "RESOLVE_NO_AGENT",
        'Approval resolved but no agent address was returned. Run "setup finish" again to retry.',
      )
    }
  }

  // Timeout
  return err(
    "TIMEOUT",
    `Timed out after ${options.timeout}s. The pending approval is still stored — run "setup finish" again to resume polling.`,
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ─── Register ──────────────────────────────────────────────────────────────────

export function registerSetupCommand(program: Command): void {
  const setup = program.command("setup").description("Set up an agent account via the approval flow")

  setup
    .command("start")
    .description("Step 1: Generate a key and request approval (create new agent or connect to existing)")
    .option("--name <name>", "Name for the agent (or key name when using --agent)")
    .option("--agent <address>", "Connect key to an existing agent account instead of creating a new one")
    .option("--force", "Overwrite an existing pending approval", false)
    .option("--daily-limit <amount>", "Daily spending limit in atomic units, e.g. 1000000 = 1 USDC")
    .option("--monthly-limit <amount>", "Monthly spending limit in atomic units")
    .option("--per-transaction-limit <amount>", "Per-transaction spending limit in atomic units")
    .option("--auto-topup", "Allow automatic balance top-up from main account", false)
    .action(async (options: SetupStartOptions) => {
      await executeSetupStart(options)
    })

  setup
    .command("finish")
    .description("Step 2: Poll for approval and activate the agent config")
    .option("--force", "Overwrite existing active config", false)
    .option("--poll-interval <seconds>", "Seconds between status checks", parseFloat, 5)
    .option("--timeout <seconds>", "Maximum seconds to wait", parseFloat, 600)
    .action(async (options: SetupFinishOptions) => {
      await executeSetupFinish(options)
    })
}
