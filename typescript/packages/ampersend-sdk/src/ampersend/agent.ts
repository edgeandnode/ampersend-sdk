import { Schema } from "effect"

import {
  Address,
  Caip2ID,
  ConvertedTimestamp,
  ID,
  NonEmptyTrimmedString,
  NonNegativeInt,
  Scheme,
  TxHash,
} from "./types.ts"

// Response DTOs for `/v1/agents/self/*`. These are the canonical wire shapes
// for the agent-led read surface: the closed-source server imports them from
// this file (via `@ampersend_ai/ampersend-sdk/ampersend`) rather than defining
// its own copies. Keep field sets stable — adding/removing a field here is a
// breaking change for both SDK consumers and server callers.

const DeploymentStatus = Schema.Literals(["deploying", "deployed", "failed"])

/**
 * Full agent snapshot with live USDC balance.
 *
 * All bigint amounts on `AgentSelf*` DTOs are micro-USDC (1 USDC = 10^6). The
 * `_usdc_micro` suffix makes the unit explicit at the wire-format boundary.
 * Note: parent DTOs shared with the dashboard (`AgentSpendConfigDTO`,
 * `AgentAutoCollectConfigDTO`) keep their unsuffixed names to avoid breaking
 * existing dashboard consumers; new agent-facing fields adopt the convention.
 */
export const AgentSelfDTO = Schema.Struct({
  address: Address,
  name: NonEmptyTrimmedString,
  slug: Schema.NullOr(NonEmptyTrimmedString),
  status: DeploymentStatus,
  published: Schema.Boolean,
  registry_id: Schema.NullOr(NonEmptyTrimmedString),
  registry_uri: Schema.NullOr(NonEmptyTrimmedString),
  balance_usdc_micro: Schema.BigInt,
})
export type AgentSelfDTO = typeof AgentSelfDTO.Type

/** Spend policy (per-tx / daily / monthly limits, auto-topup). */
export const AgentSpendConfigDTO = Schema.Struct({
  agent_address: Address,
  daily_limit: Schema.NullOr(Schema.BigInt),
  monthly_limit: Schema.NullOr(Schema.BigInt),
  per_transaction_limit: Schema.NullOr(Schema.BigInt),
  auto_topup_allowed: Schema.Boolean,
  created_at: ConvertedTimestamp,
  updated_at: ConvertedTimestamp,
})
export type AgentSpendConfigDTO = typeof AgentSpendConfigDTO.Type

/**
 * Spend policy plus live remaining-budget figures for the calling agent.
 * `daily_remaining` / `monthly_remaining` are `null` when the corresponding
 * `*_limit` isn't set (i.e. unlimited).
 */
export const AgentSelfSpendConfigDTO = AgentSpendConfigDTO.pipe(
  Schema.fieldsAssign({
    daily_remaining_usdc_micro: Schema.NullOr(Schema.BigInt),
    monthly_remaining_usdc_micro: Schema.NullOr(Schema.BigInt),
  }),
)
export type AgentSelfSpendConfigDTO = typeof AgentSelfSpendConfigDTO.Type

/** Auto-collect (earnings sweep) configuration. */
export const AgentAutoCollectConfigDTO = Schema.Struct({
  agent_address: Address,
  enabled: Schema.Boolean,
  target_address: Schema.NullOr(Address),
  threshold: Schema.BigInt,
  minimum_remaining: Schema.NullOr(Schema.BigInt),
  created_at: ConvertedTimestamp,
  updated_at: ConvertedTimestamp,
})
export type AgentAutoCollectConfigDTO = typeof AgentAutoCollectConfigDTO.Type

/** Outgoing payment as exposed to the calling agent (excludes signature, EIP-3009 nonce, internal row id, signing-key details). */
export const AgentSelfPaymentDTO = Schema.Struct({
  seller_address: Address,
  amount_usdc_micro: Schema.BigInt,
  scheme: Schema.NullOr(Scheme),
  status: Schema.Literals([
    "requested",
    "authorized",
    "denied",
    "settled",
    "expired",
    "unmanaged",
    "success",
    "failure",
    "pending",
  ]),
  tx_hash: Schema.NullOr(TxHash),
  chain_caip2id: Schema.NullOr(Caip2ID),
  created_at: ConvertedTimestamp,
  expires_at: Schema.NullOr(ConvertedTimestamp),
})
export type AgentSelfPaymentDTO = typeof AgentSelfPaymentDTO.Type

/** Single row in the unified spend + earn activity feed. */
export const UnifiedAgentActivityDTO = Schema.Struct({
  type: Schema.Literals(["earn", "spend"]),
  id: Schema.String,
  agent_address: Address,
  receiver: Address,
  amount: Schema.Union([Schema.Number, Schema.NumberFromString]),
  status: Schema.Literals(["received", "settled", "authorized", "failed", "denied"]),
  timestamp: Schema.BigInt,
  tx_hash: Schema.NullOr(Schema.String),
  chain_caip2id: Schema.NullOr(Schema.String),
})
export type UnifiedAgentActivityDTO = typeof UnifiedAgentActivityDTO.Type

/** Paginated unified spend + earn activity response. */
export const AgentActivityResponse = Schema.Struct({
  activity: Schema.Array(UnifiedAgentActivityDTO),
  hasNextPage: Schema.Boolean,
  totalCount: NonNegativeInt,
})
export type AgentActivityResponse = typeof AgentActivityResponse.Type

/** Narrow owner projection: `{ user_id, wallet_address }` — no email, sibling agents, or cross-agent aggregates. */
export const AgentOwnerDTO = Schema.Struct({
  user_id: ID,
  wallet_address: Address,
})
export type AgentOwnerDTO = typeof AgentOwnerDTO.Type

/**
 * Funding link the agent can present to its owner. The URL points at the
 * dashboard's `/fund` page, prefilled per the requested destination. Pure
 * URL formatter on the server — no DB row, no token, no side effects.
 */
export const AgentFundingLinkDTO = Schema.Struct({
  url: Schema.String,
})
export type AgentFundingLinkDTO = typeof AgentFundingLinkDTO.Type
