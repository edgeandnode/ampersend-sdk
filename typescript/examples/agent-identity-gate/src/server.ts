/**
 * Agent Identity Gate — FastMCP server with x402 payments + agent authorization.
 *
 * Problem: x402 accepts payment from any wallet. For high-value or sensitive
 * tools, a seller may want to verify *who* the paying agent is — not just
 * that the money is there.
 *
 * This example adds a pre-payment identity check:
 *   1. Agent sends a ZKP proof of its credential alongside the x402 payment.
 *   2. The server verifies the proof (agent is enrolled, has the right
 *      permissions, credential isn't expired) *before* settling the payment.
 *   3. If identity verification fails, the payment is never settled and the
 *      tool call is rejected with a clear error.
 *
 * The identity layer uses @bolyra/sdk for ZKP-based agent credentials, but
 * the pattern works with any identity/authorization system — SIWE, API keys,
 * OAuth tokens, ERC-8004 registry lookups, etc. Swap out `verifyAgentProof()`
 * with your own check.
 */

import {
  FastMCP,
  withX402Payment,
  type OnPayment,
} from "@ampersend_ai/ampersend-sdk/mcp/server/fastmcp"
import type { PaymentRequirements } from "x402/types"
import { z } from "zod"
import { verifyAgentProof, type AgentProofPayload } from "./identity.js"

const PORT = Number(process.env.PORT || 8080)
const PAY_TO_ADDRESS = process.env.PAY_TO_ADDRESS || "0x0"

// --- Facilitator config (same pattern as the base FastMCP example) ---

const facilitatorUrl = process.env.FACILITATOR_URL || "https://x402.org/facilitator"

// --- Server setup ---

const server = new FastMCP({
  name: "Agent Identity Gate Example",
  version: "1.0.0",
})

function paymentRequirement(opts: {
  description: string
  maxAmountRequired: string
  resource: string
}): PaymentRequirements {
  return {
    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // USDC on Base Sepolia
    scheme: "exact",
    network: "base-sepolia",
    payTo: PAY_TO_ADDRESS,
    description: opts.description,
    maxAmountRequired: opts.maxAmountRequired,
    resource: opts.resource,
    mimeType: "application/json",
    maxTimeoutSeconds: 300,
    extra: {
      name: "USDC",
      version: "2",
    },
  }
}

/**
 * Create an onPayment handler that requires agent identity verification
 * before settling the x402 payment.
 *
 * The agent proof is expected in `_meta["x-agent-proof"]` alongside the
 * `x402/payment` field. If the proof is missing or invalid, the payment
 * is rejected before settlement.
 *
 * @param requiredPermissions - bitmask of permissions the agent must hold
 */
function createGatedOnPayment(requiredPermissions: bigint): OnPayment {
  return async ({ payment, requirements }) => {
    // In a real deployment, the agent proof would arrive in the MCP request
    // metadata. For this example we read it from the payment's extra field
    // or from request context. The key point: verify identity BEFORE settling.
    //
    // The proof payload is a Bolyra ProofEnvelope containing:
    //   - A ZKP proving the agent is enrolled with specific permissions
    //   - Public signals: permissionBitmask, expiryTimestamp, agentNullifier
    //
    // You could replace this with any authorization check:
    //   - SIWE signature verification
    //   - ERC-8004 registry lookup
    //   - API key validation
    //   - OAuth2 token introspection

    const agentProof = (payment as any)?.extra?.["x-agent-proof"] as
      | AgentProofPayload
      | undefined

    if (!agentProof) {
      throw new Error(
        "Agent identity proof required. Include an x-agent-proof in the " +
          "payment extra field with your agent credential proof."
      )
    }

    // Verify the ZKP and check permissions + expiry
    const result = await verifyAgentProof(agentProof, requiredPermissions)

    if (!result.valid) {
      throw new Error(`Agent authorization failed: ${result.reason}`)
    }

    // Identity verified — now settle the payment via the facilitator.
    // In production, use useFacilitator(config).settle(payment, requirements).
    // This example accepts after identity check to keep dependencies minimal.
    console.log(
      `[identity-gate] Agent ${result.agentNullifier} authorized ` +
        `(permissions: 0b${result.permissionBitmask?.toString(2)})`
    )
  }
}

// --- Permission constants matching Bolyra's cumulative bit encoding ---

const PERMISSION_READ = 1n << 0n // bit 0: READ_DATA
const PERMISSION_FINANCIAL_SMALL = 1n << 2n // bit 2: FINANCIAL_SMALL (< $100)

// --- Tools ---

const queryDescription = "Query a dataset (requires agent identity + payment)"
server.addTool({
  name: "query_dataset",
  description: queryDescription,
  parameters: z.object({
    query: z.string().describe("Search query"),
    limit: z.number().optional().default(10).describe("Max results"),
  }),
  execute: withX402Payment({
    onExecute: async () => {
      return paymentRequirement({
        description: queryDescription,
        maxAmountRequired: "1000", // $0.001 USDC
        resource: `http://localhost:${PORT}/api/query`,
      })
    },
    onPayment: createGatedOnPayment(PERMISSION_READ),
  })(async (args) => {
    // Simulate a dataset query
    return JSON.stringify({
      query: args.query,
      results: [
        { id: 1, title: `Result for "${args.query}"`, score: 0.95 },
        { id: 2, title: `Another match for "${args.query}"`, score: 0.82 },
      ].slice(0, args.limit),
    })
  }),
})

const transferDescription =
  "Execute a financial operation (requires agent identity with FINANCIAL permission + payment)"
server.addTool({
  name: "execute_transfer",
  description: transferDescription,
  parameters: z.object({
    recipient: z.string().describe("Recipient address"),
    amount: z.string().describe("Amount in USDC"),
    memo: z.string().optional().describe("Transfer memo"),
  }),
  execute: withX402Payment({
    onExecute: async () => {
      return paymentRequirement({
        description: transferDescription,
        maxAmountRequired: "5000", // $0.005 USDC
        resource: `http://localhost:${PORT}/api/transfer`,
      })
    },
    // Requires FINANCIAL_SMALL permission — an agent with only READ_DATA
    // will be rejected even if payment is valid
    onPayment: createGatedOnPayment(PERMISSION_READ | PERMISSION_FINANCIAL_SMALL),
  })(async (args) => {
    return JSON.stringify({
      status: "executed",
      recipient: args.recipient,
      amount: args.amount,
      memo: args.memo ?? "",
      txId: `0x${Date.now().toString(16)}`,
    })
  }),
})

// A free tool with no payment or identity requirement — for contrast
server.addTool({
  name: "ping",
  description: "Health check (no payment or identity required)",
  parameters: z.object({}),
  execute: async () => "pong",
})

// --- Start ---

async function start() {
  console.log(
    `Starting Agent Identity Gate server on port ${PORT}\n` +
      `Connect with: http://localhost:${PORT}/mcp\n\n` +
      `Tools:\n` +
      `  query_dataset     — requires READ_DATA permission + payment\n` +
      `  execute_transfer  — requires FINANCIAL_SMALL permission + payment\n` +
      `  ping              — free, no identity check\n`
  )

  await server.start({
    transportType: "httpStream",
    httpStream: {
      port: PORT,
      endpoint: "/mcp",
    },
  })
}

export { server, start }
