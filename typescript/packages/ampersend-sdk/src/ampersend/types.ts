import { Schema } from "effect"
import { isAddress, isHex } from "viem"

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

// ============ Payment Option ============

export class ResourceInfo extends Schema.Class<ResourceInfo>("ResourceInfo")({
  url: Schema.NonEmptyTrimmedString.annotations({
    description: "URL of the resource being paid for",
  }),
  description: Schema.optional(Schema.String).annotations({
    description: "Human-readable description of the resource",
  }),
  mimeType: Schema.optional(Schema.String).annotations({
    description: "MIME type of the resource response",
  }),
}) {}

/**
 * A single payment option advertised by a seller.
 *
 * From the buyer-agent's perspective these are options to pick from, not
 * requirements — x402 calls them requirements because the protocol is
 * seller-centric, but ampersend is buyer-centric.
 */
export class PaymentOption extends Schema.Class<PaymentOption>("PaymentOption")({
  scheme: Schema.Literal("exact").annotations({
    description: "Payment scheme",
  }),
  network: Caip2ID.annotations({
    description: "CAIP-2 blockchain network identifier (e.g. eip155:8453)",
  }),
  amount: Schema.NonEmptyTrimmedString.annotations({
    description: "Exact payment amount in atomic units (wei)",
  }),
  asset: Address.annotations({
    description: "Token contract address (e.g., USDC)",
  }),
  payTo: Address.annotations({
    description: "Seller address to receive payment",
  }),
  maxTimeoutSeconds: Schema.Number.annotations({
    description: "Maximum timeout for payment completion",
  }),
  resource: ResourceInfo.annotations({
    description: "Information about the resource being paid for",
  }),
  extra: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })).annotations({
    description: "Additional payment metadata (e.g. EIP-712 domain fields)",
  }),
}) {}

/**
 * Result of settling a payment with a facilitator.
 *
 * Not an Effect Schema class because the ampersend API doesn't currently
 * model settlements on its own wire surface — this is a seller-side SDK
 * type used by MCP/HTTP middleware. Adapters translate to/from the x402
 * v1 `SettleResponse` shape at the boundary.
 */
export interface SettlementResult {
  readonly success: boolean
  /** Address that paid */
  readonly payer?: string
  /** On-chain transaction hash (empty or omitted on failure) */
  readonly transaction?: string
  /** CAIP-2 network identifier */
  readonly network: string
  /** Machine-readable error code, if settlement failed */
  readonly errorReason?: string
  /** Human-readable error message, if settlement failed */
  readonly errorMessage?: string
}

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

// ============ Protocol Envelope ============

/**
 * Protocol identifier + version tag carried inside wire envelopes.
 *
 * The envelope is ampersend's mechanism for marking a payment-related blob
 * with how to decode it. Collapsing protocol and version into a single
 * opaque string keeps dispatch simple: one enum value, one decoder.
 *
 * Add new values as new protocols land (e.g. `"mpp-v1"`).
 *
 * TODO(multi-protocol): when a non-x402 protocol (e.g. MPP) lands, consider
 * renaming the API's top-level field `options` → `accepts` (matches HTTP's
 * `Accept` semantics and is protocol-neutral). That rename isn't worth doing
 * speculatively; do it when the first non-x402 integration is concrete.
 */
export const Protocol = Schema.Literal("x402-v1", "x402-v2")
export type Protocol = typeof Protocol.Type

/**
 * Wire envelope wrapping a payment option.
 *
 * The `data` field carries the canonical (protocol-semantic) shape — not
 * byte-exact seller-sent bytes. For v1/v2 today, `data` conforms to our
 * `PaymentOption` shape; future protocol values may carry different inner
 * shapes and would widen the Union below.
 *
 * TODO(audit): for evidence-grade replay of server-sent bytes, a separate
 * capture at the HTTP boundary will preserve pre-decode content. This
 * envelope is a decode hint for business logic, not a raw-bytes archive.
 */
export const PaymentOptionEnvelope = Schema.Struct({
  protocol: Protocol.annotations({
    description: "Protocol + version tag for decoding `data`",
  }),
  data: PaymentOption.annotations({
    description: "Canonical payment option shape",
  }),
})
export type PaymentOptionEnvelope = typeof PaymentOptionEnvelope.Type

/**
 * Wire envelope wrapping a signed payment authorization.
 */
export const PaymentAuthorizationEnvelope = Schema.Struct({
  protocol: Protocol.annotations({
    description: "Protocol + version tag for decoding `data`",
  }),
  data: Schema.suspend((): Schema.Schema<PaymentAuthorization> => PaymentAuthorization).annotations({
    description: "Canonical payment authorization shape",
  }),
})
export type PaymentAuthorizationEnvelope = typeof PaymentAuthorizationEnvelope.Type

// ============ Legacy wire shapes (DEPRECATED — delete when legacy traffic is zero) ============
//
// These types exist solely so the server can decode requests from already-deployed
// old-SDK clients that predate the envelope rollout, and so it can encode responses
// back in the shape those clients expect. The new SDK emits envelope shape
// exclusively.
//
// Removal criteria: telemetry on `_wireDialect` shows zero "legacy" requests for
// N days. When that's met, delete in one shot:
//   - `LegacyPaymentOption`, `LegacyPaymentAuthorization` (classes)
//   - `NETWORK_NAME_TO_CAIP2`, `CAIP2_TO_NETWORK_NAME`, `legacyNetworkToCaip2`,
//     `legacyToCanonicalOption`, `legacyToCanonicalAuthorization`,
//     `canonicalOptionToLegacyShape` (helpers)
//   - `LegacyAuthorizeRequestWire`, `LegacyPaymentEventReportWire`,
//     `AgentAuthorizeResponseLegacyWire` (wire shapes)
//   - The `"legacy"` arm of `WireDialect` and all dialect-branch logic in the
//     three transforms below
//   - The `_wireDialect` field on `AgentAuthorizeRequest`, `AgentAuthorizeResponse`,
//     and `AgentPaymentEventReport` (becomes unused)

class LegacyPaymentOption extends Schema.Class<LegacyPaymentOption>("LegacyPaymentOption")({
  scheme: Schema.Literal("exact"),
  network: Schema.NonEmptyTrimmedString,
  maxAmountRequired: Schema.NonEmptyTrimmedString,
  resource: Schema.NonEmptyTrimmedString,
  description: Schema.optional(Schema.String),
  mimeType: Schema.optional(Schema.String),
  payTo: Schema.NonEmptyTrimmedString,
  maxTimeoutSeconds: Schema.Number,
  asset: Schema.NonEmptyTrimmedString,
  extra: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
}) {}

const NETWORK_NAME_TO_CAIP2: Record<string, string> = {
  base: "eip155:8453",
  "base-sepolia": "eip155:84532",
  avalanche: "eip155:43114",
  "avalanche-fuji": "eip155:43113",
  polygon: "eip155:137",
  "polygon-amoy": "eip155:80002",
  sei: "eip155:1329",
  "sei-testnet": "eip155:1328",
  iotex: "eip155:4689",
  peaq: "eip155:3338",
}

function legacyNetworkToCaip2(network: string): Caip2IDFormat {
  const caip2 = NETWORK_NAME_TO_CAIP2[network]
  if (caip2) return caip2 as Caip2IDFormat
  if (/^eip155:\d+$/.test(network)) return network as Caip2IDFormat
  throw new Error(`Unknown legacy v1 network: ${network}`)
}

function legacyToCanonicalOption(legacy: LegacyPaymentOption): PaymentOption {
  return new PaymentOption({
    scheme: legacy.scheme,
    network: legacyNetworkToCaip2(legacy.network),
    amount: legacy.maxAmountRequired,
    asset: legacy.asset as Address,
    payTo: legacy.payTo as Address,
    maxTimeoutSeconds: legacy.maxTimeoutSeconds,
    resource: new ResourceInfo({
      url: legacy.resource,
      ...(legacy.description ? { description: legacy.description } : {}),
      ...(legacy.mimeType ? { mimeType: legacy.mimeType } : {}),
    }),
    extra: legacy.extra,
  })
}

class LegacyPaymentAuthorization extends Schema.Class<LegacyPaymentAuthorization>("LegacyPaymentAuthorization")({
  x402Version: Schema.Number,
  scheme: Schema.NonEmptyTrimmedString,
  network: Schema.NonEmptyTrimmedString,
  payload: Schema.Unknown,
}) {}

function legacyToCanonicalAuthorization(legacy: LegacyPaymentAuthorization): PaymentAuthorization {
  return new PaymentAuthorization({
    scheme: legacy.scheme,
    network: legacyNetworkToCaip2(legacy.network),
    body: legacy.payload as Readonly<Record<string, unknown>>,
  })
}

// ============ Agent Authorize ============

/**
 * Wire dialect tag.
 *
 * Carried on canonical request and response objects so the server can respond
 * in the same dialect the client sent. `"envelope"` is the new SDK shape;
 * `"legacy"` is the pre-envelope shape that already-deployed old SDKs use.
 *
 * Delete when legacy traffic reaches zero.
 *
 * TODO(audit): the envelope's `data` currently carries the canonical shape
 * (not byte-exact seller-sent bytes). For evidence-grade replay of server-sent
 * bytes we'll want a separate capture at the HTTP boundary that preserves the
 * pre-decode body. That's a follow-up; the envelope itself is only a decode
 * hint for business logic.
 */
export const WireDialect = Schema.Literal("envelope", "legacy")
export type WireDialect = typeof WireDialect.Type

/**
 * Request body for POST /api/v1/agents/:agent/payment/authorize.
 *
 * Canonical internal shape: `{ options: Array<PaymentOption>, context?, _wireDialect }`.
 *
 * On the wire, `AgentAuthorizeRequestWire` (below) accepts either:
 *   - New envelope shape: `{ options: [{ protocol, data }, ...], context? }`
 *   - Legacy v1-flat shape: `{ requirements: [<v1 flat>, ...], context? }`
 *
 * The new SDK always emits the envelope shape. The legacy decode path exists
 * solely so already-deployed old SDKs keep working. Delete it once legacy
 * traffic reaches zero.
 *
 * `_wireDialect` is set by the wire transform and carries forward so the
 * response encoder can match the client's dialect.
 */
export class AgentAuthorizeRequest extends Schema.Class<AgentAuthorizeRequest>("AgentAuthorizeRequest")({
  options: Schema.NonEmptyArray(PaymentOption).annotations({
    description: "List of payment options the agent wants authorized",
  }),
  context: Schema.optional(
    Schema.Struct({
      method: Schema.optional(Schema.NonEmptyTrimmedString),
      serverUrl: Schema.optional(Schema.NonEmptyTrimmedString),
      params: Schema.optional(Schema.Unknown),
    }),
  ).annotations({
    description: "Optional protocol call context for debugging (MCP method, A2A action, etc)",
  }),
  _wireDialect: Schema.optionalWith(WireDialect, { default: () => "envelope" as const }).annotations({
    description: "Internal dialect tag (envelope vs legacy); not part of wire shape. Defaults to 'envelope'.",
  }),
}) {}

const AuthorizeContext = Schema.Struct({
  method: Schema.optional(Schema.NonEmptyTrimmedString),
  serverUrl: Schema.optional(Schema.NonEmptyTrimmedString),
  params: Schema.optional(Schema.Unknown),
})

const EnvelopeAuthorizeRequestWire = Schema.Struct({
  options: Schema.NonEmptyArray(PaymentOptionEnvelope),
  context: Schema.optional(AuthorizeContext),
})

const LegacyAuthorizeRequestWire = Schema.Struct({
  requirements: Schema.NonEmptyArray(LegacyPaymentOption),
  context: Schema.optional(AuthorizeContext),
})

/**
 * Wire-boundary transform for the authorize request body.
 *
 * Used by the API route's `setPayload(...)` so both dialects arrive at the
 * handler as canonical `AgentAuthorizeRequest`. Used by the SDK client's
 * outbound encode so new-SDK traffic is always envelope-shaped.
 */
export const AgentAuthorizeRequestWire = Schema.transform(
  Schema.Union(EnvelopeAuthorizeRequestWire, LegacyAuthorizeRequestWire),
  AgentAuthorizeRequest,
  {
    strict: true,
    decode: (input) => {
      if ("options" in input) {
        return new AgentAuthorizeRequest({
          options: input.options.map((env) => env.data) as unknown as AgentAuthorizeRequest["options"],
          context: input.context,
          _wireDialect: "envelope",
        })
      }
      return new AgentAuthorizeRequest({
        options: input.requirements.map(legacyToCanonicalOption) as unknown as AgentAuthorizeRequest["options"],
        context: input.context,
        _wireDialect: "legacy",
      })
    },
    encode: (canonical) => {
      return {
        options: canonical.options.map((opt) => ({
          protocol: "x402-v1" as const,
          data: opt,
        })) as unknown as readonly [PaymentOptionEnvelope, ...Array<PaymentOptionEnvelope>],
        context: canonical.context,
      }
    },
  },
)

/**
 * Co-signature material for a co-signed agent key.
 *
 * Holds the ERC-3009 authorization data + server signature the agent will
 * combine with its own signature. Scheme-specific today (exact EVM).
 *
 * TODO(second-scheme): when a second payment scheme lands, wrap the payload
 * in a `{ scheme, data }` sub-envelope analogous to `PaymentOptionEnvelope`
 * so different schemes can carry different co-signature shapes. Don't
 * pre-emptively wrap today — the current shape reads cleanly with one
 * scheme, and wrapping without a concrete second scheme risks designing the
 * wrapper wrong.
 */
export class CoSignature extends Schema.Class<CoSignature>("CoSignature")({
  authorizationData: ERC3009AuthorizationData.annotations({
    description: "Server-generated ERC-3009 authorization data",
  }),
  serverSignature: Schema.String.annotations({
    description: "Server's co-signature (65 bytes as hex string)",
  }),
}) {}

const AuthorizedLimits = Schema.Struct({
  dailyRemaining: Schema.NonEmptyTrimmedString.annotations({
    description: "Remaining daily budget after this option (in wei)",
  }),
  monthlyRemaining: Schema.NonEmptyTrimmedString.annotations({
    description: "Remaining monthly budget after this option (in wei)",
  }),
})

/**
 * Response body for POST /api/v1/agents/:agent/payment/authorize.
 *
 * Canonical internal shape:
 * ```
 * {
 *   authorized: {
 *     selected: { option, limits, coSignature? } | null,
 *     alternatives: [{ option, limits }],
 *   },
 *   rejected: [{ option, reason }],
 *   _wireDialect: "envelope" | "legacy",
 * }
 * ```
 *
 * `AgentAuthorizeResponseWire` encodes to either the envelope shape or the
 * legacy shape (pre-reshape, pre-envelope) based on `_wireDialect`. The
 * handler always builds the canonical shape; the wire transform picks the
 * right output based on the dialect the client sent.
 */
const SuggestedNonce = Schema.Struct({
  nonce: Schema.NonEmptyTrimmedString.annotations({
    description: "Suggested EIP-3009 nonce (0x-prefixed, 32 bytes). Use for strong reconciliation matching.",
  }),
  validBefore: Schema.NonEmptyTrimmedString.annotations({
    description: "Suggested validBefore (Unix timestamp in seconds). Capped by ampersend TTL policy.",
  }),
})

export class AgentAuthorizeResponse extends Schema.Class<AgentAuthorizeResponse>("AgentAuthorizeResponse")({
  authorized: Schema.Struct({
    selected: Schema.NullOr(
      Schema.Struct({
        option: PaymentOption.annotations({
          description: "The selected payment option — the recommended one, or the only one",
        }),
        limits: AuthorizedLimits.annotations({
          description: "Remaining spend limits after this option is used",
        }),
        coSignature: Schema.optional(
          CoSignature.annotations({
            description:
              "Server co-signature material for co-signed keys. Present only for co-signed keys when authorization passes; absent for full-access keys.",
          }),
        ),
      }),
    ).annotations({
      description:
        "The selected authorized option (with optional co-signature), or null when no option could be authorized",
    }),
    alternatives: Schema.Array(
      Schema.Struct({
        option: PaymentOption.annotations({
          description: "An authorized alternative to the selected option",
        }),
        limits: AuthorizedLimits,
      }),
    ).annotations({
      description: "Other authorized options the client can fall back to if the selected one fails",
    }),
  }),
  rejected: Schema.Array(
    Schema.Struct({
      option: PaymentOption.annotations({
        description: "Rejected payment option",
      }),
      reason: Schema.NonEmptyTrimmedString.annotations({
        description: "Reason why this option was rejected",
      }),
    }),
  ).annotations({
    description: "List of rejected payment options with reasons",
  }),
  suggested: Schema.optional(SuggestedNonce).annotations({
    description:
      "Suggested EIP-3009 nonce and validBefore for full-access keys to use when signing. Present only when authorization passes and a suggestion is available.",
  }),
  _wireDialect: Schema.optionalWith(WireDialect, { default: () => "envelope" as const }).annotations({
    description: "Internal dialect tag (envelope vs legacy); not part of wire shape. Defaults to 'envelope'.",
  }),
}) {}

// ============ Response Wire (dialect-matched) ============

// New envelope response shape: matches canonical but options are wrapped.
const AgentAuthorizeResponseEnvelopeWire = Schema.Struct({
  authorized: Schema.Struct({
    selected: Schema.NullOr(
      Schema.Struct({
        option: PaymentOptionEnvelope,
        limits: AuthorizedLimits,
        coSignature: Schema.optional(CoSignature),
      }),
    ),
    alternatives: Schema.Array(
      Schema.Struct({
        option: PaymentOptionEnvelope,
        limits: AuthorizedLimits,
      }),
    ),
  }),
  rejected: Schema.Array(
    Schema.Struct({
      option: PaymentOptionEnvelope,
      reason: Schema.NonEmptyTrimmedString,
    }),
  ),
  suggested: Schema.optional(SuggestedNonce),
})

// Legacy response shape: what old-SDK clients expect. Pre-reshape, pre-envelope.
// Inner option is a LegacyPaymentOption (flat v1 wire shape).
const AgentAuthorizeResponseLegacyWire = Schema.Struct({
  authorized: Schema.Struct({
    recommended: Schema.NullOr(Schema.NonNegativeInt),
    requirements: Schema.Array(
      Schema.Struct({
        requirement: LegacyPaymentOption,
        limits: AuthorizedLimits,
      }),
    ),
  }),
  rejected: Schema.Array(
    Schema.Struct({
      requirement: LegacyPaymentOption,
      reason: Schema.NonEmptyTrimmedString,
    }),
  ),
  payment: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        authorizationData: ERC3009AuthorizationData,
        serverSignature: Schema.String,
        requirement: LegacyPaymentOption,
      }),
    ),
  ),
  suggested: Schema.optional(SuggestedNonce),
})

const CAIP2_TO_NETWORK_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(NETWORK_NAME_TO_CAIP2).map(([name, id]) => [id, name]),
)

function canonicalOptionToLegacyShape(opt: PaymentOption): typeof LegacyPaymentOption.Type {
  const v1Network = CAIP2_TO_NETWORK_NAME[opt.network]
  if (!v1Network) {
    throw new Error(`No legacy v1 name for CAIP-2 network ${opt.network}`)
  }
  return new LegacyPaymentOption({
    scheme: opt.scheme,
    network: v1Network,
    maxAmountRequired: opt.amount,
    resource: opt.resource.url,
    description: opt.resource.description ?? opt.resource.url,
    mimeType: opt.resource.mimeType ?? "",
    payTo: opt.payTo,
    maxTimeoutSeconds: opt.maxTimeoutSeconds,
    asset: opt.asset,
    extra: opt.extra,
  })
}

/**
 * Wire-boundary transform for the authorize response.
 *
 * Handler produces canonical `AgentAuthorizeResponse` (new shape). This
 * transform encodes to envelope or legacy wire based on `_wireDialect`.
 * The decode side is symmetric, though in practice the server never decodes
 * its own responses.
 */
export const AgentAuthorizeResponseWire = Schema.transform(
  Schema.Union(AgentAuthorizeResponseEnvelopeWire, AgentAuthorizeResponseLegacyWire),
  AgentAuthorizeResponse,
  {
    strict: true,
    decode: (input) => {
      // Envelope shape: options already canonical inside `data`.
      if ("alternatives" in input.authorized) {
        const envInput = input as typeof AgentAuthorizeResponseEnvelopeWire.Type
        return new AgentAuthorizeResponse({
          authorized: {
            selected: envInput.authorized.selected
              ? {
                  option: envInput.authorized.selected.option.data,
                  limits: envInput.authorized.selected.limits,
                  coSignature: envInput.authorized.selected.coSignature,
                }
              : null,
            alternatives: envInput.authorized.alternatives.map((a) => ({
              option: a.option.data,
              limits: a.limits,
            })),
          },
          rejected: envInput.rejected.map((r) => ({
            option: r.option.data,
            reason: r.reason,
          })),
          suggested: envInput.suggested,
          _wireDialect: "envelope",
        })
      }
      // Legacy shape: fold recommended into selected, demote rest to alternatives.
      const legInput = input as typeof AgentAuthorizeResponseLegacyWire.Type
      const recommendedIdx = legInput.authorized.recommended
      const requirements = legInput.authorized.requirements
      const selected =
        recommendedIdx !== null && requirements[recommendedIdx] !== undefined
          ? {
              option: legacyToCanonicalOption(requirements[recommendedIdx].requirement),
              limits: requirements[recommendedIdx].limits,
              coSignature: legInput.payment
                ? new CoSignature({
                    authorizationData: legInput.payment.authorizationData,
                    serverSignature: legInput.payment.serverSignature,
                  })
                : undefined,
            }
          : null
      const alternatives = requirements
        .filter((_, i) => i !== recommendedIdx)
        .map((r) => ({
          option: legacyToCanonicalOption(r.requirement),
          limits: r.limits,
        }))
      return new AgentAuthorizeResponse({
        authorized: { selected, alternatives },
        rejected: legInput.rejected.map((r) => ({
          option: legacyToCanonicalOption(r.requirement),
          reason: r.reason,
        })),
        suggested: legInput.suggested,
        _wireDialect: "legacy",
      })
    },
    encode: (canonical) => {
      if (canonical._wireDialect === "envelope") {
        return {
          authorized: {
            selected: canonical.authorized.selected
              ? {
                  option: { protocol: "x402-v1" as const, data: canonical.authorized.selected.option },
                  limits: canonical.authorized.selected.limits,
                  coSignature: canonical.authorized.selected.coSignature,
                }
              : null,
            alternatives: canonical.authorized.alternatives.map((a) => ({
              option: { protocol: "x402-v1" as const, data: a.option },
              limits: a.limits,
            })),
          },
          rejected: canonical.rejected.map((r) => ({
            option: { protocol: "x402-v1" as const, data: r.option },
            reason: r.reason,
          })),
          suggested: canonical.suggested,
        }
      }
      // Legacy encode: flatten selected + alternatives back into recommended + requirements,
      // hoist coSignature back to top-level payment.
      const selected = canonical.authorized.selected
      const alternatives = canonical.authorized.alternatives
      const requirements = selected
        ? [
            { requirement: canonicalOptionToLegacyShape(selected.option), limits: selected.limits },
            ...alternatives.map((a) => ({
              requirement: canonicalOptionToLegacyShape(a.option),
              limits: a.limits,
            })),
          ]
        : alternatives.map((a) => ({
            requirement: canonicalOptionToLegacyShape(a.option),
            limits: a.limits,
          }))
      return {
        authorized: {
          recommended: selected ? 0 : null,
          requirements,
        },
        rejected: canonical.rejected.map((r) => ({
          requirement: canonicalOptionToLegacyShape(r.option),
          reason: r.reason,
        })),
        payment:
          selected?.coSignature !== undefined
            ? {
                authorizationData: selected.coSignature.authorizationData,
                serverSignature: selected.coSignature.serverSignature,
                requirement: canonicalOptionToLegacyShape(selected.option),
              }
            : null,
        suggested: canonical.suggested,
      }
    },
  },
)

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

// ============ Exact EVM Payment ============

export class ExactEvmAuthorization extends Schema.Class<ExactEvmAuthorization>("ExactEvmAuthorization")({
  from: Address.annotations({
    description: "Payer address",
  }),
  to: Address.annotations({
    description: "Payee address",
  }),
  value: Schema.NonEmptyTrimmedString.annotations({
    description: "Payment amount in wei",
  }),
  validAfter: Schema.NonEmptyTrimmedString.annotations({
    description: "Valid after timestamp",
  }),
  validBefore: Schema.NonEmptyTrimmedString.annotations({
    description: "Valid before timestamp",
  }),
  nonce: Schema.NonEmptyTrimmedString.annotations({
    description: "Unique nonce for this authorization",
  }),
}) {}

export class ExactEvmPayload extends Schema.Class<ExactEvmPayload>("ExactEvmPayload")({
  signature: Schema.NonEmptyTrimmedString.annotations({
    description: "EIP-3009 signature",
  }),
  authorization: ExactEvmAuthorization.annotations({
    description: "Payment authorization details",
  }),
}) {}

// ============ Payment Authorization ============

/**
 * Signed payment authorization produced by a wallet, ready to submit.
 *
 * The inner `body` is scheme-specific and protocol-version-agnostic (e.g.
 * `{ signature, authorization }` for the exact EVM scheme). Adapters at the
 * x402 HTTP/MCP boundaries wrap this in a v1 or v2 envelope on the way out.
 */
export class PaymentAuthorization extends Schema.Class<PaymentAuthorization>("PaymentAuthorization")({
  scheme: Schema.NonEmptyTrimmedString.annotations({
    description: "Payment scheme (exact/deferred)",
  }),
  network: Caip2ID.annotations({
    description: "CAIP-2 blockchain network identifier",
  }),
  body: Schema.Union(ExactEvmPayload, Schema.Unknown).annotations({
    description: "Scheme-specific signed body (ExactEvmPayload or DeferredEvmPayload)",
  }),
}) {}

// ============ Agent Payment Event Report ============

/**
 * Request body for POST /api/v1/agents/:agent/payment/events.
 *
 * Canonical internal shape: `{ id, payment: PaymentAuthorization, event }`.
 *
 * On the wire, the wire transform below accepts either:
 *   - New envelope shape: `payment: { protocol, data }`
 *   - Legacy v1 shape: `payment: { x402Version, scheme, network, payload }`
 *
 * On encode, always emits envelope shape. Delete the legacy decode path
 * once legacy traffic reaches zero.
 */
export class AgentPaymentEventReport extends Schema.Class<AgentPaymentEventReport>("AgentPaymentEventReport")({
  id: Schema.NonEmptyTrimmedString.annotations({
    description: "Unique event ID from client",
  }),
  payment: PaymentAuthorization.annotations({
    description: "Signed payment authorization",
  }),
  event: PaymentEventType.annotations({
    description: "Payment lifecycle event",
  }),
  _wireDialect: Schema.optionalWith(WireDialect, { default: () => "envelope" as const }).annotations({
    description: "Internal dialect tag; not part of wire shape. Defaults to 'envelope'.",
  }),
}) {}

const EnvelopePaymentEventReportWire = Schema.Struct({
  id: Schema.NonEmptyTrimmedString,
  payment: PaymentAuthorizationEnvelope,
  event: PaymentEventType,
})

const LegacyPaymentEventReportWire = Schema.Struct({
  id: Schema.NonEmptyTrimmedString,
  payment: LegacyPaymentAuthorization,
  event: PaymentEventType,
})

/**
 * Wire-boundary transform for the payment event report body.
 */
export const AgentPaymentEventReportWire = Schema.transform(
  Schema.Union(EnvelopePaymentEventReportWire, LegacyPaymentEventReportWire),
  AgentPaymentEventReport,
  {
    strict: true,
    decode: (input) => {
      if ("x402Version" in input.payment) {
        return new AgentPaymentEventReport({
          id: input.id,
          payment: legacyToCanonicalAuthorization(input.payment),
          event: input.event,
          _wireDialect: "legacy",
        })
      }
      return new AgentPaymentEventReport({
        id: input.id,
        payment: input.payment.data,
        event: input.event,
        _wireDialect: "envelope",
      })
    },
    encode: (canonical) => {
      return {
        id: canonical.id,
        payment: {
          protocol: "x402-v1" as const,
          data: canonical.payment,
        } as unknown as PaymentAuthorizationEnvelope,
        event: canonical.event,
      }
    },
  },
)

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

// Type alias for PaymentEvent (re-export PaymentEventType as PaymentEvent for convenience)
export type PaymentEvent = PaymentEventType

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
