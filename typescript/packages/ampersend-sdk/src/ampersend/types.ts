import { Schema } from "effect"
import { isAddress, isHex } from "viem"

const NonEmptyTrimmedString = Schema.Trimmed.check(Schema.isNonEmpty())

// ============ Primitives ============

export const Scheme = Schema.Literals(["exact", "deferred"])
export type Scheme = typeof Scheme.Type

export const Address = NonEmptyTrimmedString.check(
  Schema.makeFilter(
    (val) => isAddress(val, { strict: false }) || "Must be a valid Ethereum address (0x followed by 40 hex characters)",
  ),
).annotate({
  jsonSchema: {
    type: "string",
    pattern: "^0x[a-fA-F0-9]{40}$",
    description: "Ethereum address",
  },
})
export type Address = typeof Address.Type

export const TxHash = NonEmptyTrimmedString.check(
  Schema.makeFilter((val) => isHex(val) || "Must be a valid transaction hash (0x followed by hex characters)"),
)
export type TxHash = typeof TxHash.Type

type Caip2IDFormat = `eip155:${number}`
function isCaip2ID(val: string): val is Caip2IDFormat {
  return /^eip155:[0-9]{1,32}$/.test(val)
}

export const Caip2ID = NonEmptyTrimmedString.check(
  Schema.makeFilter((val) => isCaip2ID(val) || "Must be a valid CAIP-2 chain ID (e.g., eip155:1)"),
)
export type Caip2ID = typeof Caip2ID.Type

// ============ SIWE Authentication Schemas ============

export const SIWENonceResponse = Schema.Struct({
  nonce: NonEmptyTrimmedString.annotate({
    description: "Random nonce for SIWE message",
  }),
  sessionId: NonEmptyTrimmedString.annotate({
    description: "Session identifier for nonce validation",
  }),
}).annotate({ identifier: "SIWENonceResponse" })
export type SIWENonceResponse = typeof SIWENonceResponse.Type

export const SIWELoginRequest = Schema.Struct({
  signature: NonEmptyTrimmedString.annotate({
    description: "SIWE signature signed by session key",
  }),
  message: NonEmptyTrimmedString.annotate({
    description: "SIWE message that was signed",
  }),
  sessionId: NonEmptyTrimmedString.annotate({
    description: "Session identifier from nonce response",
  }),
  agentAddress: Address.annotate({
    description: "Agent smart account address",
  }),
}).annotate({ identifier: "SIWELoginRequest" })
export type SIWELoginRequest = typeof SIWELoginRequest.Type

export const SIWELoginResponse = Schema.Struct({
  token: NonEmptyTrimmedString.annotate({
    description: "Random session token for agent",
  }),
  agentAddress: Address.annotate({
    description: "Agent smart account address (looked up from session key)",
  }),
  expiresAt: Schema.DateTimeUtcFromString.annotate({
    description: "Token expiration time",
    jsonSchema: {
      type: "string",
      format: "date-time",
      description: "Token expiration time in ISO 8601 format",
    },
  }),
}).annotate({ identifier: "SIWELoginResponse" })
export type SIWELoginResponse = typeof SIWELoginResponse.Type

// ============ Payment Requirements (from x402) ============

export const PaymentRequirements = Schema.Struct({
  scheme: Schema.Literal("exact").annotate({
    description: "Payment scheme - starting with exact only for MVP",
  }),
  network: NonEmptyTrimmedString.annotate({
    description: "Blockchain network identifier",
  }),
  maxAmountRequired: NonEmptyTrimmedString.annotate({
    description: "Maximum payment amount in atomic units (wei/gwei)",
  }),
  resource: NonEmptyTrimmedString.annotate({
    description: "Resource identifier for the payment",
  }),
  description: NonEmptyTrimmedString.annotate({
    description: "Human-readable payment description",
  }),
  mimeType: NonEmptyTrimmedString.annotate({
    description: "MIME type of the resource",
  }),
  payTo: Address.annotate({
    description: "Seller address to receive payment",
  }),
  maxTimeoutSeconds: Schema.Number.annotate({
    description: "Maximum timeout for payment completion",
  }),
  asset: Address.annotate({
    description: "Token contract address (e.g., USDC)",
  }),
  extra: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)).annotate({
    description: "Additional payment metadata",
  }),
}).annotate({ identifier: "PaymentRequirements" })
export type PaymentRequirements = typeof PaymentRequirements.Type

// ============ Agent Payment Authorization ============

export const AgentPaymentAuthRequest = Schema.Struct({
  requirements: Schema.NonEmptyArray(PaymentRequirements).annotate({
    description: "List of payment requirements from x402",
  }),
  context: Schema.optional(
    Schema.Struct({
      method: Schema.optional(NonEmptyTrimmedString),
      serverUrl: Schema.optional(NonEmptyTrimmedString),
      params: Schema.optional(Schema.Unknown),
    }),
  ).annotate({
    description: "Optional protocol call context for debugging (MCP method, A2A action, etc)",
  }),
}).annotate({ identifier: "AgentPaymentAuthRequest" })
export type AgentPaymentAuthRequest = typeof AgentPaymentAuthRequest.Type

export const AgentPaymentAuthResponse = Schema.Struct({
  authorized: Schema.Struct({
    recommended: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))).annotate({
      description:
        "Index of recommended payment requirement (cheapest option). Null if no requirements are authorized.",
    }),
    requirements: Schema.Array(
      Schema.Struct({
        requirement: PaymentRequirements.annotate({
          description: "Authorized payment requirement",
        }),
        limits: Schema.Struct({
          dailyRemaining: NonEmptyTrimmedString.annotate({
            description: "Remaining daily budget after this requirement (in wei)",
          }),
          monthlyRemaining: NonEmptyTrimmedString.annotate({
            description: "Remaining monthly budget after this requirement (in wei)",
          }),
        }).annotate({
          description: "Remaining spend limits after this specific requirement is used",
        }),
      }),
    ).annotate({
      description: "List of authorized payment requirements. Empty if none authorized.",
    }),
  }).annotate({
    description: "Authorized payment requirements with recommendation",
  }),
  rejected: Schema.Array(
    Schema.Struct({
      requirement: PaymentRequirements.annotate({
        description: "Rejected payment requirement",
      }),
      reason: NonEmptyTrimmedString.annotate({
        description: "Reason why this requirement was rejected",
      }),
    }),
  ).annotate({
    description: "List of rejected payment requirements with reasons",
  }),
}).annotate({ identifier: "AgentPaymentAuthResponse" })
export type AgentPaymentAuthResponse = typeof AgentPaymentAuthResponse.Type

// ============ Payment Event Types ============

export const PaymentEventType = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("sending").annotate({ description: "Payment is being sent" }),
  }),
  Schema.Struct({
    type: Schema.Literal("accepted").annotate({ description: "Payment was accepted" }),
  }),
  Schema.Struct({
    type: Schema.Literal("rejected"),
    reason: NonEmptyTrimmedString.annotate({ description: "Rejection reason" }),
  }),
  Schema.Struct({
    type: Schema.Literal("error"),
    reason: NonEmptyTrimmedString.annotate({ description: "Error details" }),
  }),
]).annotate({
  description: "Payment lifecycle event types",
})
export type PaymentEventType = typeof PaymentEventType.Type

// ============ Exact EVM Payment ============

export const ExactEvmAuthorization = Schema.Struct({
  from: Address.annotate({
    description: "Payer address",
  }),
  to: Address.annotate({
    description: "Payee address",
  }),
  value: NonEmptyTrimmedString.annotate({
    description: "Payment amount in wei",
  }),
  validAfter: NonEmptyTrimmedString.annotate({
    description: "Valid after timestamp",
  }),
  validBefore: NonEmptyTrimmedString.annotate({
    description: "Valid before timestamp",
  }),
  nonce: NonEmptyTrimmedString.annotate({
    description: "Unique nonce for this authorization",
  }),
}).annotate({ identifier: "ExactEvmAuthorization" })
export type ExactEvmAuthorization = typeof ExactEvmAuthorization.Type

export const ExactEvmPayload = Schema.Struct({
  signature: NonEmptyTrimmedString.annotate({
    description: "EIP-3009 signature",
  }),
  authorization: ExactEvmAuthorization.annotate({
    description: "Payment authorization details",
  }),
}).annotate({ identifier: "ExactEvmPayload" })
export type ExactEvmPayload = typeof ExactEvmPayload.Type

// ============ x402 Payment Payload ============

export const PaymentPayload = Schema.Struct({
  x402Version: Schema.Number.annotate({
    description: "x402 protocol version",
  }),
  scheme: NonEmptyTrimmedString.annotate({
    description: "Payment scheme (exact/deferred)",
  }),
  network: NonEmptyTrimmedString.annotate({
    description: "Blockchain network",
  }),
  payload: Schema.Union([ExactEvmPayload, Schema.Unknown]).annotate({
    description: "Scheme-specific payload (ExactEvmPayload or DeferredEvmPayload)",
  }),
}).annotate({ identifier: "PaymentPayload" })
export type PaymentPayload = typeof PaymentPayload.Type

// ============ Agent Payment Event Report ============

export const AgentPaymentEventReport = Schema.Struct({
  id: NonEmptyTrimmedString.annotate({
    description: "Unique event ID from client",
  }),
  payment: PaymentPayload.annotate({
    description: "x402 payment payload",
  }),
  event: PaymentEventType.annotate({
    description: "Payment lifecycle event",
  }),
}).annotate({ identifier: "AgentPaymentEventReport" })
export type AgentPaymentEventReport = typeof AgentPaymentEventReport.Type

export const AgentPaymentEventResponse = Schema.Struct({
  received: Schema.Boolean.annotate({
    description: "Confirmation that event was received",
  }),
  paymentId: Schema.optional(Schema.String.check(Schema.isUUID(4))).annotate({
    description: "Internal payment record ID if created",
  }),
}).annotate({ identifier: "AgentPaymentEventResponse" })
export type AgentPaymentEventResponse = typeof AgentPaymentEventResponse.Type

// ============ SDK-specific types ============

export interface ApiClientOptions {
  baseUrl: string
  sessionKeyPrivateKey?: `0x${string}`
  agentAddress: Address
  timeout?: number
}

export interface AuthenticationState {
  token: string | null
  expiresAt: Date | null
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public response?: Response,
  ) {
    super(message)
    this.name = "ApiError"
  }
}

// Type alias for PaymentEvent (re-export PaymentEventType as PaymentEvent for convenience)
export type PaymentEvent = PaymentEventType
