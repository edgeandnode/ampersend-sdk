import { withX402Payment, type OnPayment } from "@ampersend_ai/ampersend-sdk/mcp/server/fastmcp"
import { facilitator } from "@coinbase/x402"
import { FastMCP } from "fastmcp"
import type { FacilitatorConfig, PaymentRequirements } from "x402/types"
import { useFacilitator } from "x402/verify"
import { z } from "zod"

const PORT = process.env.PORT || 8080
const PAY_TO_ADDRESS = process.env.TS__EXAMPLES__FASTMCP_X402_SERVER__PAY_TO_ADDRESS
const facilitatorConfig: FacilitatorConfig = (() => {
  if (process.env.CDP_API_KEY_ID && process.env.CDP_API_KEY_SECRET) {
    return facilitator
  }

  const facilitatorUrl = process.env.FACILITATOR_URL || "https://x402.org/facilitator"
  const verifyFacilitatorUrl = (url: string): url is `${string}://${string}` => {
    return /^https?:\/\/.+/.test(url)
  }

  if (!verifyFacilitatorUrl(facilitatorUrl)) {
    throw new Error(`FACILITATOR_URL must be a valid URL: ${facilitatorUrl}`)
  }
  return { url: facilitatorUrl }
})()

const server = new FastMCP({
  name: "FastMCP x402 Example",
  version: "1.0.0",
})

const paymentRequirement = function ({
  description,
  maxAmountRequired,
  maxTimeoutSeconds,
  mimeType,
  resource,
}: {
  description: string
  maxAmountRequired: string
  maxTimeoutSeconds: number
  mimeType: string
  resource: string
}): PaymentRequirements {
  return {
    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    scheme: "exact",
    network: "base-sepolia",
    payTo: PAY_TO_ADDRESS || "0x0",
    description,
    maxAmountRequired,
    resource,
    mimeType,
    maxTimeoutSeconds,
    extra: {
      name: "USDC",
      version: "2",
    },
  }
}

const onPayment: OnPayment = async ({ payment, requirements }) => {
  return useFacilitator(facilitatorConfig).settle(payment, requirements)
}

const addDescription = "Add two numbers"
server.addTool({
  name: "add",
  description: addDescription,
  parameters: z.object({
    a: z.number().describe("First number"),
    b: z.number().describe("Second number"),
  }),
  execute: withX402Payment({
    onExecute: async ({ args: _args }) => {
      return paymentRequirement({
        description: addDescription,
        maxAmountRequired: "1000", // $0.001 USDC
        resource: `http://localhost:${PORT}/api/add`,
        mimeType: "application/json",
        maxTimeoutSeconds: 300,
      })
    },
    onPayment,
  })(async (args) => {
    return `${args.a + args.b}`
  }),
})

const addAcceptDescription = "Add two numbers (accepts all payments)"
server.addTool({
  name: "add_accept",
  description: addAcceptDescription,
  parameters: z.object({
    a: z.number().describe("First number"),
    b: z.number().describe("Second number"),
  }),
  execute: withX402Payment({
    onExecute: async ({ args: _args }) => {
      return paymentRequirement({
        description: addAcceptDescription,
        maxAmountRequired: "1000", // $0.001 USDC
        resource: `http://localhost:${PORT}/api/add-accept`,
        mimeType: "application/json",
        maxTimeoutSeconds: 300,
      })
    },
    onPayment: async () => {}, // accepts all payments
  })(async (args) => {
    return `${args.a + args.b}`
  }),
})

const addRejectDescription = "Add two numbers (rejects all payments)"
server.addTool({
  name: "add_reject",
  description: addRejectDescription,
  parameters: z.object({
    a: z.number().describe("First number"),
    b: z.number().describe("Second number"),
  }),
  execute: withX402Payment({
    onExecute: async ({ args: _args }) => {
      return paymentRequirement({
        description: addRejectDescription,
        maxAmountRequired: "1000", // $0.001 USDC
        resource: `http://localhost:${PORT}/api/add-reject`,
        mimeType: "application/json",
        maxTimeoutSeconds: 300,
      })
    },
    onPayment: async ({ payment: payment, requirements: _requirements }) => {
      throw new Error(`I don't like this payment: ${JSON.stringify(payment)}`)
    },
  })(async (args) => {
    return `${args.a + args.b}`
  }),
})

server.addTool({
  name: "echo",
  description: "Echo a message",
  parameters: z.object({
    message: z.string().describe("Message to echo"),
  }),
  execute: async (args) => {
    return `${args.message}`
  },
})

// Start server with stateless HTTP configuration
async function start() {
  console.log(`🚀 Starting FastMCP x402 Example Server on port ${PORT}`)
  console.log(`📡 Connect with: http://localhost:${PORT}/mcp`)
  console.log(``)

  await server.start({
    transportType: "httpStream",
    httpStream: {
      port: Number(PORT),
      endpoint: "/mcp",
    },
  })
}

export { server, start }
