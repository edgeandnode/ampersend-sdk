/**
 * Agent Identity Gate — FastMCP server with x402 payments + agent authorization.
 *
 * Problem: x402 accepts payment from any wallet. For high-value or sensitive
 * tools, a seller may want to verify *who* the paying agent is — not just
 * that the money is there.
 *
 * This example adds a pre-payment identity check:
 *   1. Agent includes an identity proof in the MCP request metadata
 *      (`_meta["x-agent-proof"]`).
 *   2. The server verifies the proof (valid structure, required permissions,
 *      non-expired credential) *before* settling the x402 payment.
 *   3. If identity verification fails, the tool call is rejected with a
 *      clear error.
 *
 * The identity layer is pluggable via the IdentityVerifier interface. This
 * example ships a structural-validation stub. Swap in @bolyra/sdk, Skyfire
 * KYAPay, SIWE, OAuth2, or your own verifier for production.
 */

import {
  FastMCP,
  withX402Payment,
  type OnPayment,
} from "@ampersend_ai/ampersend-sdk/mcp/server/fastmcp"
import type { PaymentRequirements } from "x402/types"
import { z } from "zod"
import {
  StructuralVerifier,
  type IdentityVerifier,
  type StructuralProofPayload,
} from "./identity.js"

const PORT = Number(process.env.PORT || 8080)
const PAY_TO_ADDRESS = process.env.PAY_TO_ADDRESS || "0x0"

// --- Facilitator config (same pattern as the base FastMCP example) ---

const facilitatorUrl = process.env.FACILITATOR_URL || "https://x402.org/facilitator"

// --- Identity verifier (swap this for production) ---

const verifier: IdentityVerifier<StructuralProofPayload> = new StructuralVerifier()

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
 * Wrap a tool's execute function with an identity gate that runs before
 * x402 payment settlement.
 *
 * The agent proof is read from MCP request metadata (`_meta["x-agent-proof"]`).
 * The OnPayment callback handles x402 settlement only — identity is checked
 * separately so we reject unauthorized agents before touching payments.
 *
 * @param requiredPermissions - bitmask of permissions the agent must hold
 * @param innerExecute - the tool's actual execute function
 */
function withIdentityGate<TArgs>(
  requiredPermissions: bigint,
  innerExecute: (args: TArgs) => Promise<string>,
): (args: TArgs, context: Record<string, unknown>) => Promise<string> {
  return async (args: TArgs, context: Record<string, unknown>) => {
    // Read the agent proof from MCP request metadata.
    // The agent sends it as `_meta: { "x-agent-proof": { envelope: ... } }`.
    const metadata = context.requestMetadata as
      | Record<string, unknown>
      | undefined
    const agentProof = metadata?.["x-agent-proof"] as
      | StructuralProofPayload
      | undefined

    if (!agentProof) {
      throw new Error(
        "Agent identity proof required. Include an x-agent-proof object " +
          "in the MCP request _meta with your agent credential proof."
      )
    }

    const result = await verifier.verify(agentProof, requiredPermissions)

    if (!result.valid) {
      throw new Error(`Agent authorization failed: ${result.reason}`)
    }

    console.log(
      `[identity-gate] Agent ${result.agentId ?? "unknown"} authorized ` +
        `(permissions: 0b${result.permissionBitmask?.toString(2)})`
    )

    return innerExecute(args)
  }
}

/**
 * Standard onPayment handler — settles the x402 payment via the facilitator.
 * Identity has already been verified by the time this runs.
 */
const settlePayment: OnPayment = async ({ payment, requirements }) => {
  // In production, use useFacilitator(config).settle(payment, requirements).
  // This example accepts after identity check to keep dependencies minimal.
  console.log("[identity-gate] Payment accepted (stub — use facilitator in production)")
}

// --- Permission constants (cumulative bit encoding) ---

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
    onPayment: settlePayment,
  })(
    withIdentityGate(PERMISSION_READ, async (args) => {
      return JSON.stringify({
        query: args.query,
        results: [
          { id: 1, title: `Result for "${args.query}"`, score: 0.95 },
          { id: 2, title: `Another match for "${args.query}"`, score: 0.82 },
        ].slice(0, args.limit),
      })
    }),
  ),
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
    onPayment: settlePayment,
  })(
    withIdentityGate(
      PERMISSION_READ | PERMISSION_FINANCIAL_SMALL,
      async (args) => {
        return JSON.stringify({
          status: "executed",
          recipient: args.recipient,
          amount: args.amount,
          memo: args.memo ?? "",
          txId: `0x${Date.now().toString(16)}`,
        })
      },
    ),
  ),
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
