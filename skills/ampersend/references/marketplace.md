# Ampersend marketplace command reference

Full flag and option reference for `ampersend marketplace`. Read this when the Discovery workflow in
[`SKILL.md`](../SKILL.md) is not enough — for example, when narrowing to a single source or inspecting one provider's
endpoints in detail.

The marketplace is the live, broad-but-curated list of services known to ampersend. `marketplace list` requires an
authenticated agent — run `ampersend setup` first, or the command exits with a credentials error. `marketplace show`
hits an unauthenticated endpoint and needs neither setup nor credentials. It is one way to find services, not the only
place they can come from — `ampersend fetch` works against any x402 endpoint, marketplace listing or not.

## Contents

- [marketplace list](#marketplace-list)
- [marketplace show](#marketplace-show)
- [Pricing units](#pricing-units)
- [Three ways to find services](#three-ways-to-find-services)

## marketplace list

List curated agents, optionally filtered. Filters combine on the server side. Requires an authenticated agent (run
`ampersend setup` first).

By default `list` searches across all sources: ampersend's own curated agents, the Bazaar agents, and the ERC-8004
registry agents. Use `--source` to narrow to one of them.

```bash
ampersend marketplace list [--source <source>] [--category <category>] [--search <query>] [--network <network>] [--raw]
```

| Option                  | Description                                                                                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--source <source>`     | Narrow to one source: `ampersend` (ampersend-curated agents), `bazaar` (Bazaar agents), `registry` (ERC-8004 registry agents), or `catalog`. Omit to search all. |
| `--category <category>` | Filter by category (e.g. `Crypto`, `AI/LLM`, `Data/Search`, `Agent Infra`)                                                                                       |
| `--search <query>`      | Fuzzy match across name, description, tags, and category                                                                                                         |
| `--network <network>`   | Override the default network. Most agents do not need this.                                                                                                      |
| `--raw`                 | Output raw JSON array instead of the standard envelope                                                                                                           |

Returns an array of providers. Each provider includes `id`, `name`, `description`, `category`, `tags`, `endpoints[]`,
and `skills[]`.

## marketplace show

Show details for a single curated agent by id.

```bash
ampersend marketplace show <id> [--raw]
```

| Argument | Description             |
| -------- | ----------------------- |
| `<id>`   | Curated agent id (UUID) |

| Option  | Description                                                 |
| ------- | ----------------------------------------------------------- |
| `--raw` | Output the raw JSON object instead of the standard envelope |

Returns one provider with the same shape as a `list` entry, including full `endpoints[]` and `skills[]`.

## Pricing units

Each endpoint carries a `pricing_config` with the cost per call. Prices come as integers in millionths of a dollar:

- `1000` is $0.001, `1000000` is $1.00.
- `amount` is the price the user sees; `amountAtomicUnit` is the same number used for the transfer. They are usually
  equal.

Always re-confirm a price with `ampersend fetch --inspect <url>` before paying — prices on third-party services drift,
and the marketplace listing is a snapshot.

## Three ways to find services

Pick the right surface for the intent:

- **First-try / hand-held**: [`example-services.md`](example-services.md) — a hand-picked set with ready-to-run
  examples, the ones we know work well. Use this when the user just wants to see ampersend work.
- **Exploring known services**: `ampersend marketplace list` — the broader live catalog. Use this when the user has a
  workflow or capability in mind and wants options.
- **Anything else**: `ampersend fetch` against any x402 URL. The marketplace is one way to find services, not the only
  place they can come from — endpoints that are not listed still work as long as they speak x402.
