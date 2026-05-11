# Ampersend marketplace command reference

Full flag and option reference for `ampersend marketplace`. Read this when the Discovery workflow in
[`SKILL.md`](../SKILL.md) is not enough — for example, when filtering by network, narrowing to a single source, or
inspecting one provider's endpoints in detail.

The marketplace is the live, broad-but-curated list of services known to ampersend. Endpoints are unauthenticated, so no
setup or agent key is needed to query them. It is not a whitelist — `ampersend fetch` works against any x402 endpoint,
marketplace listing or not.

## Contents

- [marketplace list](#marketplace-list)
- [marketplace show](#marketplace-show)
- [Pricing units](#pricing-units)
- [Three discovery tiers](#three-discovery-tiers)

## marketplace list

List curated agents, optionally filtered. Filters combine on the server side.

```bash
ampersend marketplace list [--source <source>] [--category <category>] [--search <query>] [--network <network>] [--raw]
```

| Option                  | Description                                                                |
| ----------------------- | -------------------------------------------------------------------------- |
| `--source <source>`     | One of: `catalog`, `bazaar`, `ampersend`                                   |
| `--category <category>` | Filter by category (e.g. `Crypto`, `AI/LLM`, `Data/Search`, `Agent Infra`) |
| `--search <query>`      | Fuzzy match across name, description, tags, and category                   |
| `--network <network>`   | Filter by supported network (e.g. `base`, `base-sepolia`)                  |
| `--raw`                 | Output raw JSON array instead of the standard envelope                     |

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

Each endpoint carries a `pricing_config` with the cost per call. Amounts are atomic units of the named `currency`:

- USDC has 6 decimals, so `1000` is $0.001 and `1000000` is $1.00.
- `amount` is the user-facing price; `amountAtomicUnit` is the on-chain transfer size. They are usually equal.

Always re-confirm a price with `ampersend fetch --inspect <url>` before paying — prices on third-party services drift,
and the marketplace listing is a snapshot.

## Three discovery tiers

Pick the right surface for the intent:

- **First-try / hand-held**: [`example-services.md`](example-services.md) — marketing-curated set with concrete
  invocations, vetted to work end-to-end. Use this when the user just wants to see ampersend work.
- **Exploring known services**: `ampersend marketplace list` — the broader live catalog. Use this when the user has a
  workflow or capability in mind and wants options.
- **Anything else**: `ampersend fetch` against any x402 URL. The marketplace is not a whitelist; endpoints that are not
  listed still work as long as they speak x402.
