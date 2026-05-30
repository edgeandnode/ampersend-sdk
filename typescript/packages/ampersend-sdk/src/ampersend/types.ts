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

export const NonEmptyTrimmedString = Schema.NonEmptyString.check(Schema.isTrimmed())
export type NonEmptyTrimmedString = typeof NonEmptyTrimmedString.Type

export const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
export type NonNegativeInt = typeof NonNegativeInt.Type

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

export const Hex32Bytes = NonEmptyTrimmedString.check(
  Schema.makeFilter(
    (val) => /^0x[a-fA-F0-9]{64}$/.test(val) || "Must be a 32-byte hex string (0x followed by 64 hex characters)",
  ),
)
export type Hex32Bytes = typeof Hex32Bytes.Type

export const Hex65Bytes = NonEmptyTrimmedString.check(
  Schema.makeFilter(
    (val) => /^0x[a-fA-F0-9]{130}$/.test(val) || "Must be a 65-byte hex string (0x followed by 130 hex characters)",
  ),
)
export type Hex65Bytes = typeof Hex65Bytes.Type

export const NonNegativeIntegerString = NonEmptyTrimmedString.check(
  Schema.makeFilter((val) => /^\d+$/.test(val) || "Must be a non-negative integer literal (stringified bigint)"),
)
export type NonNegativeIntegerString = typeof NonNegativeIntegerString.Type

export const ID = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("ID"))
export type ID = typeof ID.Type

export const ConvertedTimestamp = Schema.Union([
  NonNegativeInt,
  Schema.NumberFromString.pipe(Schema.decodeTo(NonNegativeInt)),
])
export type ConvertedTimestamp = typeof ConvertedTimestamp.Type

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

// ============ Sign-In-With-X co-sign ============

export const SignSiwxResponse = Schema.Struct({
  serverSignature: Hex65Bytes.annotate({
    description: "Server-key ECDSA signature over hashMessage(message) — 65 bytes as 0x-prefixed hex",
  }),
}).annotate({ identifier: "SignSiwxResponse" })
export type SignSiwxResponse = typeof SignSiwxResponse.Type

// ============ ERC-3009 Authorization (for co-signed payments) ============

export const ERC3009AuthorizationData = Schema.Struct({
  from: Address.annotate({
    description: "Sender address (agent smart account)",
  }),
  to: Address.annotate({
    description: "Recipient address (seller)",
  }),
  value: NonNegativeIntegerString.annotate({
    description: "Transfer amount in wei (stringified bigint)",
  }),
  validAfter: NonNegativeIntegerString.annotate({
    description: "Unix timestamp after which the authorization is valid (stringified bigint)",
  }),
  validBefore: NonNegativeIntegerString.annotate({
    description: "Unix timestamp before which the authorization expires (stringified bigint)",
  }),
  nonce: Hex32Bytes.annotate({
    description: "Random 32-byte nonce as hex string for replay protection",
  }),
}).annotate({ identifier: "ERC3009AuthorizationData" })
export type ERC3009AuthorizationData = typeof ERC3009AuthorizationData.Type

export const ServerAuthorizationData = Schema.Struct({
  authorizationData: ERC3009AuthorizationData.annotate({
    description: "ERC-3009 TransferWithAuthorization data",
  }),
  serverSignature: Hex65Bytes.annotate({
    description: "Server's ECDSA signature (65 bytes as hex string)",
  }),
}).annotate({ identifier: "ServerAuthorizationData" })
export type ServerAuthorizationData = typeof ServerAuthorizationData.Type

// ============ Protocol envelopes (wire) ============

/** Dispatch tag on wire envelopes. Distinct from any individual protocol's internal version. */
export const Protocol = Schema.Literals(["x402-v1", "x402-v2"])
export type Protocol = typeof Protocol.Type

/** Wire envelope for a {@link PaymentRequest}; `data` validated via `@x402/core/schemas` on decode. */
export const PaymentRequestEnvelope = Schema.Union([
  Schema.Struct({
    protocol: Schema.Literal("x402-v1"),
    data: fromZod(PaymentRequiredV1Schema, "PaymentRequiredV1"),
  }),
  Schema.Struct({
    protocol: Schema.Literal("x402-v2"),
    data: fromZod(PaymentRequiredV2Schema, "PaymentRequiredV2"),
  }),
])
export type PaymentRequestEnvelope = typeof PaymentRequestEnvelope.Type

/** Wire envelope for a signed {@link PaymentAuthorization}. */
export const PaymentAuthorizationEnvelope = Schema.Union([
  Schema.Struct({
    protocol: Schema.Literal("x402-v1"),
    data: fromZod(PaymentPayloadV1Schema, "PaymentPayloadV1"),
  }),
  Schema.Struct({
    protocol: Schema.Literal("x402-v2"),
    data: fromZod(PaymentPayloadV2Schema, "PaymentPayloadV2"),
  }),
])
export type PaymentAuthorizationEnvelope = typeof PaymentAuthorizationEnvelope.Type

// ============ Agent Authorize ============

const AuthorizeContext = Schema.Struct({
  method: Schema.optional(NonEmptyTrimmedString),
  serverUrl: Schema.optional(NonEmptyTrimmedString),
  params: Schema.optional(Schema.Unknown),
})

/** Request body for `POST /api/v1/agents/:agent/payment/authorize`. */
export const AgentAuthorizeRequest = Schema.Struct({
  paymentRequest: PaymentRequestEnvelope.annotate({
    description: "The seller's 402 response, protocol-tagged",
  }),
  context: Schema.optional(AuthorizeContext).annotate({
    description: "Optional protocol call context for debugging (MCP method, A2A action, HTTP URL, etc)",
  }),
})
export type AgentAuthorizeRequest = typeof AgentAuthorizeRequest.Type

const AuthorizedLimits = Schema.Struct({
  dailyRemaining: NonEmptyTrimmedString.annotate({
    description: "Remaining daily budget after this instruction (in wei)",
  }),
  monthlyRemaining: NonEmptyTrimmedString.annotate({
    description: "Remaining monthly budget after this instruction (in wei)",
  }),
})

/**
 * ERC-3009 authorization data + server signature for co-signed agent keys;
 * the agent signs alongside. Scheme-specific today (exact EVM).
 */
export const CoSignature = Schema.Struct({
  authorizationData: ERC3009AuthorizationData.annotate({
    description: "Server-generated ERC-3009 authorization data",
  }),
  serverSignature: Hex65Bytes.annotate({
    description: "Server's co-signature (65 bytes as hex string)",
  }),
}).annotate({ identifier: "CoSignature" })
export type CoSignature = typeof CoSignature.Type

const SuggestedNonce = Schema.Struct({
  nonce: Hex32Bytes.annotate({
    description: "Suggested EIP-3009 nonce (0x-prefixed, 32 bytes). Use for strong reconciliation matching.",
  }),
  validBefore: NonNegativeIntegerString.annotate({
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
 *   rejected: [{ acceptsIndex, reason, reasonCode? }],
 *   suggested?: { nonce, validBefore },
 * }
 * ```
 *
 * `reasonCode` on rejected items is a stable string identifier for the
 * rejection category (e.g., `per_tx_limit_exceeded`,
 * `compliance_high_risk`). Optional for backwards compatibility with
 * older API versions that only emit `reason`; consumers should fall
 * back to a default branch when an unknown code arrives.
 */
export const AgentAuthorizeResponse = Schema.Struct({
  authorized: Schema.Struct({
    selected: Schema.NullOr(
      Schema.Struct({
        acceptsIndex: NonNegativeInt.annotate({
          description: "Index into the request's accepts[] that the server picked",
        }),
        limits: AuthorizedLimits,
        coSignature: Schema.optional(CoSignature),
      }),
    ).annotate({
      description: "The selected authorized option, or null if none could be authorized",
    }),
    alternatives: Schema.Array(
      Schema.Struct({
        acceptsIndex: NonNegativeInt,
        limits: AuthorizedLimits,
      }),
    ).annotate({
      description: "Other authorized options the client can fall back to",
    }),
  }),
  rejected: Schema.Array(
    Schema.Struct({
      acceptsIndex: NonNegativeInt,
      reason: NonEmptyTrimmedString,
      reasonCode: Schema.optional(NonEmptyTrimmedString).annotate({
        description:
          "Stable identifier for the rejection category (e.g., 'per_tx_limit_exceeded'). Optional for back-compat with older APIs.",
      }),
    }),
  ),
  suggested: Schema.optional(SuggestedNonce).annotate({
    description:
      "Suggested EIP-3009 nonce and validBefore for full-access keys to use when signing. Present only when authorization passes and a suggestion is available.",
  }),
})
export type AgentAuthorizeResponse = typeof AgentAuthorizeResponse.Type

// ============ Seller-side authorize-receipt ============

/**
 * Response body for `POST /api/v1/agents/:agent/payment/authorize-receipt`.
 *
 * Discriminated union on `authorized`. Both branches are HTTP 200; the
 * caller decides how to surface a deny. `screeningId` references the
 * persisted `screening_result` for audit / support-ticket correlation
 * and may be `null` on short-circuit deny paths that skipped screening.
 *
 * The deny detail (`reason`, `reasonCode`, `screeningId`) must NOT be
 * echoed to the buyer — it is server-side audit only. Surfacing which
 * category flagged a wallet lets a sanctioned counterparty wallet-shop
 * or feel out the thresholds.
 */
export const AgentAuthorizeReceiptResponse = Schema.Union(
  Schema.Struct({
    authorized: Schema.Literal(true),
    screeningId: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    authorized: Schema.Literal(false),
    reason: Schema.String,
    reasonCode: Schema.String,
    screeningId: Schema.NullOr(Schema.String),
  }),
)
export type AgentAuthorizeReceiptResponse = typeof AgentAuthorizeReceiptResponse.Type

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

export type PaymentEvent = PaymentEventType

// ============ Agent Payment Event Report ============

/** Request body for `POST /api/v1/agents/:agent/payment/events`. */
export const AgentPaymentEventReport = Schema.Struct({
  id: NonEmptyTrimmedString.annotate({
    description: "Unique event ID from client",
  }),
  payment: PaymentAuthorizationEnvelope.annotate({
    description: "Signed payment authorization envelope",
  }),
  event: PaymentEventType.annotate({
    description: "Payment lifecycle event",
  }),
})
export type AgentPaymentEventReport = typeof AgentPaymentEventReport.Type

export const AgentPaymentEventResponse = Schema.Struct({
  received: Schema.Boolean.annotate({
    description: "Confirmation that event was received",
  }),
  paymentId: Schema.optional(Schema.String.check(Schema.isUUID())).annotate({
    description: "Internal payment record ID if created",
  }),
}).annotate({ identifier: "AgentPaymentEventResponse" })
export type AgentPaymentEventResponse = typeof AgentPaymentEventResponse.Type

// ============ SDK-specific types ============

export interface ApiClientOptions {
  baseUrl: string
  sessionKeyPrivateKey?: `0x${string}`
  /**
   * The agent's smart-account address. Required for any authenticated call
   * (the SIWE login binds to it); optional when the client is used only for
   * unauthenticated reads. Authenticated paths throw a clear error if it's
   * missing — see `ApiClient.performAuthentication`.
   */
  agentAddress?: Address
  timeout?: number
  /**
   * Identifies the calling client for the API's product-analytics
   * attribution. Sent on every authenticated request as
   * `Ampersend-Client: <clientName>/<version>`. The `ampersend` CLI passes
   * `"ampersend-cli"`; library callers default to `"sdk-typescript"`.
   */
  clientName?: string
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
  auto_topup_allowed: Schema.Boolean.annotate({
    description: "Whether automatic balance top-up is allowed",
  }),
  daily_limit: Schema.NullOr(Schema.String).pipe(
    Schema.annotate({ description: "Daily spending limit in atomic units" }),
  ),
  monthly_limit: Schema.NullOr(Schema.String).pipe(
    Schema.annotate({ description: "Monthly spending limit in atomic units" }),
  ),
  per_transaction_limit: Schema.NullOr(Schema.String).pipe(
    Schema.annotate({ description: "Per-transaction spending limit in atomic units" }),
  ),
})

export const AgentApprovalRequest = Schema.Struct({
  name: Schema.NullOr(Schema.String).pipe(
    Schema.annotate({
      description: "Optional name for the agent",
    }),
  ),
  agent_key_address: Address.pipe(
    Schema.annotate({
      description: "The agent key address (session key) for the agent",
    }),
  ),
  key_name: Schema.optional(
    Schema.String.annotate({
      description: "Optional name for the key",
    }),
  ),
  spend_config: Schema.optional(Schema.NullOr(SpendConfigInput)),
  mode: Schema.optional(
    Schema.Literals(["create", "connect", "connect_choose"]).annotate({
      description:
        "Setup mode: 'create' = new agent (default), 'connect' = connect key to agent_address, 'connect_choose' = user picks agent in dashboard",
    }),
  ),
  agent_address: Schema.optional(
    Address.annotate({
      description: "Address of existing agent to connect to (required when mode is 'connect')",
    }),
  ),
}).annotate({ identifier: "AgentApprovalRequest" })
export type AgentApprovalRequest = typeof AgentApprovalRequest.Type

export const ApprovalResponse = Schema.Struct({
  token: NonEmptyTrimmedString.annotate({
    description: "Unique token for this approval request",
  }),
  status_url: NonEmptyTrimmedString.annotate({
    description: "URL to poll for approval status",
  }),
  user_approve_url: NonEmptyTrimmedString.annotate({
    description: "URL for user to open in browser to approve the action",
  }),
}).annotate({ identifier: "ApprovalResponse" })
export type ApprovalResponse = typeof ApprovalResponse.Type

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
  resolved_at: Schema.String.annotate({
    description: "ISO timestamp of when the action was resolved",
  }),
})

export const ApprovalStatusRejected = Schema.Struct({
  status: Schema.Literal("rejected"),
  resolved_at: Schema.String.annotate({
    description: "ISO timestamp of when the action was rejected",
  }),
})

export const ApprovalStatusBlocked = Schema.Struct({
  status: Schema.Literal("blocked"),
  resolved_at: Schema.String.annotate({
    description: "ISO timestamp of when the action was blocked",
  }),
})

export const ApprovalStatus = Schema.Union([
  ApprovalStatusPending,
  ApprovalStatusResolved,
  ApprovalStatusRejected,
  ApprovalStatusBlocked,
])
export type ApprovalStatus = typeof ApprovalStatus.Type
