import {
  PaymentPayloadV1Schema,
  PaymentPayloadV2Schema,
  PaymentRequiredV1Schema,
  PaymentRequiredV2Schema,
} from "@x402/core/schemas"
import { Schema } from "effect"
import { isAddress, isHex } from "viem"

import { fromZod } from "./zod-bridge.js"

// ============ Primitives ============

export const Scheme = Schema.Literal("exact", "deferred")
export type Scheme = typeof Scheme.Type

export const Address = Schema.NonEmptyTrimmedString.pipe(
  Schema.filter(
    (val) => isAddress(val, { strict: false }) || "Must be a valid Ethereum address (0x followed by 40 hex characters)",
  ),
  Schema.annotations({
    jsonSchema: {
      type: "string",
      pattern: "^0x[a-fA-F0-9]{40}$",
      description: "Ethereum address",
    },
  }),
)
export type Address = typeof Address.Type

export const TxHash = Schema.NonEmptyTrimmedString.pipe(
  Schema.filter((val) => isHex(val) || "Must be a valid transaction hash (0x followed by hex characters)"),
)
export type TxHash = typeof TxHash.Type

type Caip2IDFormat = `eip155:${number}`
function isCaip2ID(val: string): val is Caip2IDFormat {
  return /^eip155:[0-9]{1,32}$/.test(val)
}

export const Caip2ID = Schema.NonEmptyTrimmedString.pipe(
  Schema.filter((val) => isCaip2ID(val) || "Must be a valid CAIP-2 chain ID (e.g., eip155:1)"),
)
export type Caip2ID = typeof Caip2ID.Type

// ============ SIWE Authentication Schemas ============

export class SIWENonceResponse extends Schema.Class<SIWENonceResponse>("SIWENonceResponse")({
  nonce: Schema.NonEmptyTrimmedString.annotations({
    description: "Random nonce for SIWE message",
  }),
  sessionId: Schema.NonEmptyTrimmedString.annotations({
    description: "Session identifier for nonce validation",
  }),
}) {}

export class SIWELoginRequest extends Schema.Class<SIWELoginRequest>("SIWELoginRequest")({
  signature: Schema.NonEmptyTrimmedString.annotations({
    description: "SIWE signature signed by session key",
  }),
  message: Schema.NonEmptyTrimmedString.annotations({
    description: "SIWE message that was signed",
  }),
  sessionId: Schema.NonEmptyTrimmedString.annotations({
    description: "Session identifier from nonce response",
  }),
  agentAddress: Address.annotations({
    description: "Agent smart account address",
  }),
}) {}

export class SIWELoginResponse extends Schema.Class<SIWELoginResponse>("SIWELoginResponse")({
  token: Schema.NonEmptyTrimmedString.annotations({
    description: "Random session token for agent",
  }),
  agentAddress: Address.annotations({
    description: "Agent smart account address (looked up from session key)",
  }),
  expiresAt: Schema.DateTimeUtc.annotations({
    description: "Token expiration time",
    jsonSchema: {
      type: "string",
      format: "date-time",
      description: "Token expiration time in ISO 8601 format",
    },
  }),
}) {}

// ============ ERC-3009 Authorization (for co-signed payments) ============

export class ERC3009AuthorizationData extends Schema.Class<ERC3009AuthorizationData>("ERC3009AuthorizationData")({
  from: Address.annotations({
    description: "Sender address (agent smart account)",
  }),
  to: Address.annotations({
    description: "Recipient address (seller)",
  }),
  value: Schema.String.annotations({
    description: "Transfer amount in wei (stringified bigint)",
  }),
  validAfter: Schema.String.annotations({
    description: "Unix timestamp after which the authorization is valid (stringified bigint)",
  }),
  validBefore: Schema.String.annotations({
    description: "Unix timestamp before which the authorization expires (stringified bigint)",
  }),
  nonce: Schema.String.annotations({
    description: "Random 32-byte nonce as hex string for replay protection",
  }),
}) {}

export class ServerAuthorizationData extends Schema.Class<ServerAuthorizationData>("ServerAuthorizationData")({
  authorizationData: ERC3009AuthorizationData.annotations({
    description: "ERC-3009 TransferWithAuthorization data",
  }),
  serverSignature: Schema.String.annotations({
    description: "Server's ECDSA signature (65 bytes as hex string)",
  }),
}) {}

// ============ Protocol envelopes (wire) ============

/** Dispatch tag on wire envelopes. Distinct from any individual protocol's internal version. */
export const Protocol = Schema.Literal("x402-v1", "x402-v2")
export type Protocol = typeof Protocol.Type

/** Wire envelope for a {@link PaymentRequest}; `data` validated via `@x402/core/schemas` on decode. */
export const PaymentRequestEnvelope = Schema.Union(
  Schema.Struct({
    protocol: Schema.Literal("x402-v1"),
    data: fromZod(PaymentRequiredV1Schema, "PaymentRequiredV1"),
  }),
  Schema.Struct({
    protocol: Schema.Literal("x402-v2"),
    data: fromZod(PaymentRequiredV2Schema, "PaymentRequiredV2"),
  }),
)
export type PaymentRequestEnvelope = typeof PaymentRequestEnvelope.Type

/** Wire envelope for a signed {@link PaymentAuthorization}. */
export const PaymentAuthorizationEnvelope = Schema.Union(
  Schema.Struct({
    protocol: Schema.Literal("x402-v1"),
    data: fromZod(PaymentPayloadV1Schema, "PaymentPayloadV1"),
  }),
  Schema.Struct({
    protocol: Schema.Literal("x402-v2"),
    data: fromZod(PaymentPayloadV2Schema, "PaymentPayloadV2"),
  }),
)
export type PaymentAuthorizationEnvelope = typeof PaymentAuthorizationEnvelope.Type

// ============ Agent Authorize ============

const AuthorizeContext = Schema.Struct({
  method: Schema.optional(Schema.NonEmptyTrimmedString),
  serverUrl: Schema.optional(Schema.NonEmptyTrimmedString),
  params: Schema.optional(Schema.Unknown),
})

/** Request body for `POST /api/v1/agents/:agent/payment/authorize`. */
export const AgentAuthorizeRequest = Schema.Struct({
  paymentRequest: PaymentRequestEnvelope.annotations({
    description: "The seller's 402 response, protocol-tagged",
  }),
  context: Schema.optional(AuthorizeContext).annotations({
    description: "Optional protocol call context for debugging (MCP method, A2A action, HTTP URL, etc)",
  }),
})
export type AgentAuthorizeRequest = typeof AgentAuthorizeRequest.Type

const AuthorizedLimits = Schema.Struct({
  dailyRemaining: Schema.NonEmptyTrimmedString.annotations({
    description: "Remaining daily budget after this instruction (in wei)",
  }),
  monthlyRemaining: Schema.NonEmptyTrimmedString.annotations({
    description: "Remaining monthly budget after this instruction (in wei)",
  }),
})

/**
 * ERC-3009 authorization data + server signature for co-signed agent keys;
 * the agent signs alongside. Scheme-specific today (exact EVM).
 */
export class CoSignature extends Schema.Class<CoSignature>("CoSignature")({
  authorizationData: ERC3009AuthorizationData.annotations({
    description: "Server-generated ERC-3009 authorization data",
  }),
  serverSignature: Schema.String.annotations({
    description: "Server's co-signature (65 bytes as hex string)",
  }),
}) {}

const SuggestedNonce = Schema.Struct({
  nonce: Schema.NonEmptyTrimmedString.annotations({
    description: "Suggested EIP-3009 nonce (0x-prefixed, 32 bytes). Use for strong reconciliation matching.",
  }),
  validBefore: Schema.NonEmptyTrimmedString.annotations({
    description: "Suggested validBefore (Unix timestamp in seconds). Capped by ampersend TTL policy.",
  }),
})

/**
 * Response body for `POST /api/v1/agents/:agent/payment/authorize`. Returns
 * *indices* into the request's `accepts[]` — the client has the original
 * line-items, so byte-exact echo doesn't require re-serialization.
 *
 * ```
 * {
 *   authorized: {
 *     selected: { acceptsIndex, limits, coSignature? } | null,
 *     alternatives: [{ acceptsIndex, limits }],
 *   },
 *   rejected: [{ acceptsIndex, reason }],
 *   suggested?: { nonce, validBefore },
 * }
 * ```
 */
export const AgentAuthorizeResponse = Schema.Struct({
  authorized: Schema.Struct({
    selected: Schema.NullOr(
      Schema.Struct({
        acceptsIndex: Schema.NonNegativeInt.annotations({
          description: "Index into the request's accepts[] that the server picked",
        }),
        limits: AuthorizedLimits,
        coSignature: Schema.optional(CoSignature),
      }),
    ).annotations({
      description: "The selected authorized option, or null if none could be authorized",
    }),
    alternatives: Schema.Array(
      Schema.Struct({
        acceptsIndex: Schema.NonNegativeInt,
        limits: AuthorizedLimits,
      }),
    ).annotations({
      description: "Other authorized options the client can fall back to",
    }),
  }),
  rejected: Schema.Array(
    Schema.Struct({
      acceptsIndex: Schema.NonNegativeInt,
      reason: Schema.NonEmptyTrimmedString,
    }),
  ),
  suggested: Schema.optional(SuggestedNonce).annotations({
    description:
      "Suggested EIP-3009 nonce and validBefore for full-access keys to use when signing. Present only when authorization passes and a suggestion is available.",
  }),
})
export type AgentAuthorizeResponse = typeof AgentAuthorizeResponse.Type

// ============ Payment Event Types ============

export const PaymentEventType = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("sending").annotations({ description: "Payment is being sent" }),
  }),
  Schema.Struct({
    type: Schema.Literal("accepted").annotations({ description: "Payment was accepted" }),
  }),
  Schema.Struct({
    type: Schema.Literal("rejected"),
    reason: Schema.NonEmptyTrimmedString.annotations({ description: "Rejection reason" }),
  }),
  Schema.Struct({
    type: Schema.Literal("error"),
    reason: Schema.NonEmptyTrimmedString.annotations({ description: "Error details" }),
  }),
).annotations({
  description: "Payment lifecycle event types",
})
export type PaymentEventType = typeof PaymentEventType.Type

export type PaymentEvent = PaymentEventType

// ============ Agent Payment Event Report ============

/** Request body for `POST /api/v1/agents/:agent/payment/events`. */
export const AgentPaymentEventReport = Schema.Struct({
  id: Schema.NonEmptyTrimmedString.annotations({
    description: "Unique event ID from client",
  }),
  payment: PaymentAuthorizationEnvelope.annotations({
    description: "Signed payment authorization envelope",
  }),
  event: PaymentEventType.annotations({
    description: "Payment lifecycle event",
  }),
})
export type AgentPaymentEventReport = typeof AgentPaymentEventReport.Type

export class AgentPaymentEventResponse extends Schema.Class<AgentPaymentEventResponse>("AgentPaymentEventResponse")({
  received: Schema.Boolean.annotations({
    description: "Confirmation that event was received",
  }),
  paymentId: Schema.optional(Schema.UUID).annotations({
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

// ============ Approve Action Types ============

export const SpendConfigInput = Schema.Struct({
  auto_topup_allowed: Schema.Boolean.annotations({
    description: "Whether automatic balance top-up is allowed",
  }),
  daily_limit: Schema.NullOr(Schema.String).pipe(
    Schema.annotations({ description: "Daily spending limit in atomic units" }),
  ),
  monthly_limit: Schema.NullOr(Schema.String).pipe(
    Schema.annotations({ description: "Monthly spending limit in atomic units" }),
  ),
  per_transaction_limit: Schema.NullOr(Schema.String).pipe(
    Schema.annotations({ description: "Per-transaction spending limit in atomic units" }),
  ),
})

export class AgentApprovalRequest extends Schema.Class<AgentApprovalRequest>("AgentApprovalRequest")({
  name: Schema.NullOr(Schema.String).pipe(
    Schema.annotations({
      description: "Optional name for the agent",
    }),
  ),
  agent_key_address: Address.pipe(
    Schema.annotations({
      description: "The agent key address (session key) for the agent",
    }),
  ),
  key_name: Schema.optional(
    Schema.String.annotations({
      description: "Optional name for the key",
    }),
  ),
  spend_config: Schema.optional(Schema.NullOr(SpendConfigInput)),
  mode: Schema.optional(
    Schema.Literal("create", "connect", "connect_choose").annotations({
      description:
        "Setup mode: 'create' = new agent (default), 'connect' = connect key to agent_address, 'connect_choose' = user picks agent in dashboard",
    }),
  ),
  agent_address: Schema.optional(
    Address.annotations({
      description: "Address of existing agent to connect to (required when mode is 'connect')",
    }),
  ),
}) {}

export class ApprovalResponse extends Schema.Class<ApprovalResponse>("ApprovalResponse")({
  token: Schema.NonEmptyTrimmedString.annotations({
    description: "Unique token for this approval request",
  }),
  status_url: Schema.NonEmptyTrimmedString.annotations({
    description: "URL to poll for approval status",
  }),
  user_approve_url: Schema.NonEmptyTrimmedString.annotations({
    description: "URL for user to open in browser to approve the action",
  }),
}) {}

export const ApprovalStatusPending = Schema.Struct({
  status: Schema.Literal("pending"),
})

export const ApprovalStatusResolved = Schema.Struct({
  status: Schema.Literal("resolved"),
  agent: Schema.optional(
    Schema.Struct({
      address: Address,
      agent_key_address: Schema.optional(Address),
    }),
  ),
  resolved_at: Schema.String.annotations({
    description: "ISO timestamp of when the action was resolved",
  }),
})

export const ApprovalStatusRejected = Schema.Struct({
  status: Schema.Literal("rejected"),
  resolved_at: Schema.String.annotations({
    description: "ISO timestamp of when the action was rejected",
  }),
})

export const ApprovalStatusBlocked = Schema.Struct({
  status: Schema.Literal("blocked"),
  resolved_at: Schema.String.annotations({
    description: "ISO timestamp of when the action was blocked",
  }),
})

export const ApprovalStatus = Schema.Union(
  ApprovalStatusPending,
  ApprovalStatusResolved,
  ApprovalStatusRejected,
  ApprovalStatusBlocked,
)
export type ApprovalStatus = typeof ApprovalStatus.Type
