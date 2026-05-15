import { Effect, Option, Schema, SchemaIssue } from "effect"
import * as SchemaAST from "effect/SchemaAST"
import * as SchemaTransformation from "effect/SchemaTransformation"
import type { ZodType } from "zod"

function jsonSchemaTypeToSchema(jsonSchema: Record<string, unknown>): Schema.Top {
  switch (jsonSchema.type) {
    case "array":
      return Schema.Array(Schema.Unknown)
    case "boolean":
      return Schema.Boolean
    case "integer":
      return Schema.Int
    case "null":
      return Schema.Null
    case "number":
      return Schema.Number
    case "object":
      return Schema.Record(Schema.String, Schema.Unknown)
    case "string":
      return Schema.String
    default:
      return Schema.Unknown
  }
}

/**
 * Embed a Zod schema in an Effect `Schema`. Both directions run `safeParse`
 * (Zod's decode path) — sound only while the wrapped schema is identity. A
 * `.transform`/`.default`/`.coerce` upstream would make `encode` silently
 * normalize outbound wire data; `zod-bridge.test.ts` catches that.
 *
 * Effect v4 derives JSON Schema for declarations from `toCodecJson`, not from
 * the old raw `jsonSchema` annotation. We map the provided JSON Schema's broad
 * type to an Effect schema so OpenAPI generation has a useful encoded shape.
 */
export function fromZod<T>(
  zod: ZodType<T>,
  identifier: string,
  jsonSchema: Record<string, unknown> = { type: "object" },
): Schema.Codec<T> {
  const encodedSchema = jsonSchemaTypeToSchema(jsonSchema)

  return Schema.declareConstructor<T>()(
    [] as const,
    () => (input, ast) => {
      const r = zod.safeParse(input)
      return r.success ? Effect.succeed(r.data) : Effect.fail(new SchemaIssue.InvalidType(ast, Option.some(input)))
    },
    {
      identifier,
      jsonSchema,
      toCodecJson: () => new SchemaAST.Link(encodedSchema.ast, SchemaTransformation.passthrough({ strict: false })),
    },
  )
}
