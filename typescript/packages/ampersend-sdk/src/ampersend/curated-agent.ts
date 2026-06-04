import * as Schema from "effect/Schema"

import { Address, ConvertedTimestamp, ID, NonEmptyTrimmedString, Scheme } from "./types.js"

export const CuratedAgentSource = Schema.Literals(["catalog", "bazaar", "ampersend", "registry"])
export type CuratedAgentSource = typeof CuratedAgentSource.Type

export const HTTPMethod = Schema.Literals(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
export type HTTPMethod = typeof HTTPMethod.Type

export const x402ProtocolVersion = Schema.Literals([1, 2])
export type x402ProtocolVersion = typeof x402ProtocolVersion.Type

export const CuratedAgentEndpointX402PricingConfig = Schema.Struct({
  amount: Schema.BigIntFromString.annotate({
    jsonSchema: {},
    description: "The amount charged per request to the endpoint",
    examples: [1000n],
  }),
  amountAtomicUnit: Schema.BigIntFromString.annotate({
    jsonSchema: {},
    description:
      "atomic unit of the accepted asset for the payment to the endpoint. USDC has 6 decimals → $0.001 = '1000'",
    examples: [100000n],
  }),
  currency: Schema.String.annotate({
    examples: ["USDC"],
  }),
  networkCaip2ID: NonEmptyTrimmedString.annotate({
    examples: ["eip155:8453"],
  }),
  assetAddress: Address,
  payTo: Schema.NullOr(Address),
  x402Schema: Schema.NullOr(Scheme),
}).annotate({
  identifier: "Ampersend/db/tables/CuratedAgentEndpoint/CuratedAgentEndpointX402PricingConfig",
})
export type CuratedAgentEndpointX402PricingConfig = typeof CuratedAgentEndpointX402PricingConfig.Type

export const CuratedAgentEndpointPricingConfig = Schema.Union([CuratedAgentEndpointX402PricingConfig])
export type CuratedAgentEndpointPricingConfig = typeof CuratedAgentEndpointPricingConfig.Type

export const CuratedAgentEndpointDTO = Schema.Struct({
  id: ID.annotate({
    identifier: "curated_agent_endpoint.id",
  }),
  curated_agent_id: ID.annotate({
    identifier: "curated_agent_endpoint.curated_agent_id",
  }),
  url: NonEmptyTrimmedString.annotate({
    identifier: "curated_agent_endpoint.url",
    examples: ["https://api.venice.ai/api/v1/chat/completions"],
  }),
  methods: Schema.Array(HTTPMethod).annotate({
    identifier: "curated_agent_endpoint.methods",
    description: "What HTTP method(s) does the endpoint allow/support",
  }),
  x402_enabled: Schema.Boolean.annotate({
    identifier: "curated_agent_endpoint.x402_enabled",
  }),
  x402_protocol_version: x402ProtocolVersion.annotate({
    identifier: "curated_agent_endpoint.x402_protocol_version",
    description:
      "Identified which version of x402 the endpoint supports, which shows how to use the endpoint correctly",
  }),
  network: Schema.NullOr(Schema.String).annotate({
    identifier: "curated_agent_endpoint.network",
    description: "The network supported for payment to the endpoint; if the endpoint is x402 enabled",
    examples: ["base", "base-sepolia", "solana"],
  }),
  description: Schema.NullOr(Schema.String).annotate({
    identifier: "curated_agent_endpoint.description",
  }),
  enabled: Schema.Boolean.annotate({
    identifier: "curated_agent_endpoint.enabled",
  }),
  pricing_config: CuratedAgentEndpointPricingConfig.annotate({
    identifier: "curated_agent_endpoint.pricing_config",
    description: "Contains the required pricing information for paying for the service",
  }),
  created_at: ConvertedTimestamp,
  updated_at: ConvertedTimestamp,
}).annotate({
  identifier: "Ampersend/domain/CuratedAgentEndpointDTO",
})
export type CuratedAgentEndpointDTO = typeof CuratedAgentEndpointDTO.Type

export const CuratedAgentSkillDTO = Schema.Struct({
  id: ID.annotate({
    identifier: "curated_agent_skill.id",
  }),
  curated_agent_id: ID.annotate({
    identifier: "curated_agent_skill.curated_agent_id",
  }),
  name: NonEmptyTrimmedString.annotate({
    identifier: "curated_agent_skill.name",
  }),
  instructions: Schema.Unknown.annotate({
    identifier: "curated_agent_skill.instructions",
    description: "Provided setup/install instructions for how to use the skill",
  }),
  docs_url: Schema.NullOr(Schema.String).annotate({
    identifier: "curated_agent_skill.docs_url",
    description: "Link to any docs for using the skill",
  }),
  skillmd_url: Schema.NullOr(Schema.String).annotate({
    identifier: "curated_agent_skill.skillmd_url",
    description: "Link to the skill.md file",
  }),
  created_at: ConvertedTimestamp,
  updated_at: ConvertedTimestamp,
}).annotate({
  identifier: "Ampersend/domain/CuratedAgentSkillDTO",
})
export type CuratedAgentSkillDTO = typeof CuratedAgentSkillDTO.Type

export const CuratedAgentDTO = Schema.Struct({
  id: ID.annotate({
    identifier: "curated_agent.id",
  }),
  name: NonEmptyTrimmedString.annotate({
    identifier: "curated_agent.name",
  }),
  description: Schema.NullOr(Schema.String).annotate({
    identifier: "curated_agent.description",
  }),
  source: CuratedAgentSource.annotate({
    identifier: "curated_agent.source",
  }),
  enabled: Schema.Boolean.annotate({
    identifier: "curated_agent.enabled",
  }),
  category: NonEmptyTrimmedString.annotate({
    identifier: "curated_agent.category",
  }),
  tags: Schema.Array(NonEmptyTrimmedString).annotate({
    identifier: "curated_agent.tags",
  }),
  url: Schema.NullOr(Schema.String).annotate({
    identifier: "curated_agent.url",
  }),
  logo_url: Schema.NullOr(Schema.String).annotate({
    identifier: "curated_agent.logo_url",
  }),
  docs_url: Schema.NullOr(Schema.String).annotate({
    identifier: "curated_agent.docs_url",
  }),
  ampersend_agent_address: Schema.NullOr(Address).annotate({
    identifier: "curated_agent.ampersend_agent_address",
    description: "FK to the agent.address if the curated agent is also registered in ampersend.",
  }),
  created_at: ConvertedTimestamp,
  updated_at: ConvertedTimestamp,
  endpoints: Schema.Array(CuratedAgentEndpointDTO),
  skills: Schema.Array(CuratedAgentSkillDTO),
}).annotate({
  identifier: "Ampersend/domain/CuratedAgentDTO",
})
export type CuratedAgentDTO = typeof CuratedAgentDTO.Type

export const AgentMarketplaceListQueryParams = Schema.Struct({
  source: CuratedAgentSource.pipe(Schema.optional),
  category: Schema.String.pipe(Schema.optional),
  search: Schema.String.pipe(Schema.optional),
  network: Schema.String.pipe(Schema.optional),
}).annotate({
  identifier: "Ampersend/domain/AgentMarketplaceListQueryParams",
})
export type AgentMarketplaceListQueryParams = typeof AgentMarketplaceListQueryParams.Type
