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

export class SIWENonceResponse extends Schema.Class<SIWENonceResponse>("SIWENonceResponse")({
  nonce: NonEmptyTrimmedString.annotate({
    description: "Random nonce for SIWE message",
  }),
  sessionId: NonEmptyTrimmedString.annotate({
    description: "Session identifier for nonce validation",
  }),
}) {}

export class SIWELoginRequest extends Schema.Class<SIWELoginRequest>("SIWELoginRequest")({
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
}) {}

export class SIWELoginResponse extends Schema.Class<SIWELoginResponse>("SIWELoginResponse")({
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
}) {}

// ============ Payment Requirements (from x402) ============

export class PaymentRequirements extends Schema.Class<PaymentRequirements>("PaymentRequirements")({
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
}) {}

// ============ Agent Payment Authorization ============

export class AgentPaymentAuthRequest extends Schema.Class<AgentPaymentAuthRequest>("AgentPaymentAuthRequest")({
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
}) {}

export class AgentPaymentAuthResponse extends Schema.Class<AgentPaymentAuthResponse>("AgentPaymentAuthResponse")({
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
}) {}

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

export class ExactEvmAuthorization extends Schema.Class<ExactEvmAuthorization>("ExactEvmAuthorization")({
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
}) {}

export class ExactEvmPayload extends Schema.Class<ExactEvmPayload>("ExactEvmPayload")({
  signature: NonEmptyTrimmedString.annotate({
    description: "EIP-3009 signature",
  }),
  authorization: ExactEvmAuthorization.annotate({
    description: "Payment authorization details",
  }),
}) {}

// ============ x402 Payment Payload ============

export class PaymentPayload extends Schema.Class<PaymentPayload>("PaymentPayload")({
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
}) {}

// ============ Agent Payment Event Report ============

export class AgentPaymentEventReport extends Schema.Class<AgentPaymentEventReport>("AgentPaymentEventReport")({
  id: NonEmptyTrimmedString.annotate({
    description: "Unique event ID from client",
  }),
  payment: PaymentPayload.annotate({
    description: "x402 payment payload",
  }),
  event: PaymentEventType.annotate({
    description: "Payment lifecycle event",
  }),
}) {}

export class AgentPaymentEventResponse extends Schema.Class<AgentPaymentEventResponse>("AgentPaymentEventResponse")({
  received: Schema.Boolean.annotate({
    description: "Confirmation that event was received",
  }),
  paymentId: Schema.optional(Schema.String.check(Schema.isUUID(4))).annotate({
    description: "Internal payment record ID if created",
  }),
}) {}

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
