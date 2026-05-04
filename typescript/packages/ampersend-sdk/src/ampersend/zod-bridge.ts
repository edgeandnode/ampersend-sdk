import { ParseResult, Schema } from "effect"
import type { ZodType } from "zod"

/**
 * Embed a Zod schema in an Effect `Schema`. Both directions run `safeParse`
 * (Zod's decode path) — sound only while the wrapped schema is identity. A
 * `.transform`/`.default`/`.coerce` upstream would make `encode` silently
 * normalize outbound wire data; `zod-bridge.test.ts` catches that.
 *
 * The default `jsonSchema` must include a key `isOverrideAnnotation` treats as
 * an override (`type`/`oneOf`/`anyOf`/`$ref`) — otherwise Effect's JSON Schema
 * walker still throws "Missing annotation" on this `Declaration` node, breaking
 * `@effect/platform` OpenAPI generation at Layer-build time.
 */
export function fromZod<T>(
  zod: ZodType<T>,
  identifier: string,
  jsonSchema: Record<string, unknown> = { type: "object" },
): Schema.Schema<T> {
  return Schema.declare(
    [] as const,
    {
      decode: () => (input, _opts, ast) => {
        const r = zod.safeParse(input)
        return r.success
          ? ParseResult.succeed(r.data)
          : ParseResult.fail(new ParseResult.Type(ast, input, r.error.message))
      },
      encode: () => (input, _opts, ast) => {
        const r = zod.safeParse(input)
        return r.success
          ? ParseResult.succeed(r.data)
          : ParseResult.fail(new ParseResult.Type(ast, input, r.error.message))
      },
    },
    { identifier, jsonSchema },
  )
}
