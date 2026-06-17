# Plan: `ampersend card`

Add a top-level `card` command that lets an agent issue and read prepaid Visa cards via Laso, hiding Laso entirely.
Builds on the `--pay` diff already in flight.

## Why

Today an agent buys a card by hand-chaining three `fetch` calls (`/auth` → `/get-card` → poll `/get-card-data`),
carrying a Bearer token between them. It's the orchestration that's painful, not the payment. `card` folds that into one
command per step. The agent never sees "Laso" or a token.

## Surface

```
ampersend card issue   --amount <usd>          # spends; returns { card_id, status: "pending", payment }
ampersend card details <id> [--pay] [--reveal] # status + card data; reads are free on a warm token cache
ampersend card list    [--pay]                 # all issued cards (masked); free on a warm token cache
```

- `issue` is the only _stated-amount_ spending verb. The amount is in the command, so there is no implicit spend — **no
  `--pay` flag** (unlike `fetch`, where the cost is unknown until the 402).
- `issue` does **not** poll. It returns a `card_id`; the agent polls `details <id>` itself until `status: "ready"`.
- `<id>` is positional, matching `marketplace show <id>`.
- Card secrets are masked unless `--reveal`, and are **never written to disk**. Masking shows PAN last-4
  (`•••• •••• •••• 4242`) and `cvv: "•••"`; `expiry` is shown in clear (not a secret on its own).

### `--pay` on reads (`details` / `list`)

`details`/`list` need a Laso Bearer, minted via the paid `/auth` x402 call (~$0.001). Spend on reads is opt-in, so
`--pay` means the same thing it does everywhere: _authorize a payment if one is required._

- **Default (no `--pay`)** is free-only: use a warm cached token, or — on a cold cache — return `ok:false`
  `TOKEN_REQUIRED` (exit 0) telling the agent to pass `--pay`.
- **`--pay` on a cold cache** mints the token, caches it, proceeds, and emits the `/auth` spend as `data.payment`.
- **`--pay` on a warm cache** is satisfied trivially: no spend, no receipt — exactly like `fetch --pay` against a 200.
- Only `--pay` exists on reads; free-only is the default, so the opposite direction needs no flag.

This makes `--pay` consistent across all spending paths — required to spend on `fetch` (cost unknown until 402) and on
`card` reads (mints the read token), and _absent_ only on `card issue`, where the amount is already stated.

## How it maps to Laso (hidden)

- `issue` → internally `/auth` (get Bearer) then `/get-card?amount=`. Returns only `card_id` + a payment receipt.
- `details` → internally needs a Bearer for `/get-card-data` (see token caching below).
- `list` → `/get-card-data` with no `card_id`.

v1 is US virtual cards only (0% fee). Gift / push-to-card / international are fast-follows.

## Payment path (unchanged guarantees)

Every x402 spend in `card` — `issue`'s `/get-card` and the `/auth` mint behind `--pay` reads — reuses the exact
paid-fetch path `fetch --pay` uses: `createAmpersendHttpClient` → (SIWX wrap) → `wrapFetchWithPayment`. Spend stays
governed by the user's policy via the co-sign. We capture what was spent with the `onAfterPaymentCreation` hook
(inherited from upstream `x402Client`) and emit a `PaymentReceipt`
(`{ amount, asset, network, payTo, scheme, txHash, payer? }`) — reusing `buildReceiptFromResponse` from `fetch.ts`
(which reads the `payment-response` header and calls `buildPaymentReceipt`), so the header-decode lives in one place.

To avoid copying that wiring three times, extract a `createPaidFetch` helper (see Files) that returns
`{ fetchWithPayment, getSelected }`: the wrapped fetch plus a `getSelected()` reading the requirements captured by the
hook for that call. SIWX stays **on** (matching `fetch --pay`). Each paid call gets its own helper instance so the
capture is per-request. `fetch.ts`'s `--pay` branch becomes the first caller; `card` the second.

Note `issue`'s structure is the `fetch.ts` `--pay` branch (paid x402 fetch to `laso.finance`), **not** `fund.ts` — only
the Commander registration boilerplate resembles `fund.ts`. `fund.ts` calls the Ampersend API via `buildClient`, a
different client entirely.

## Bearer token caching

`details`/`list` need a Laso Bearer from `/auth` (~$0.001). Cache it so a warm read costs nothing; minting it is the
opt-in `--pay` spend described above.

- Store on `StoredConfigV1` as `lasoToken?: { idToken, expiresAt, agentKey, apiUrl? }` (schema strips unknown keys, so
  no migration). File is already `0o600`.
- **Invalidate when the active identity or API URL changes** — drop the token (don't re-thread it) in `promotePending`
  (`setup finish`), `setConfig`, and `setApiUrl`. Do **not** clear on `storePendingApproval` / `clearPendingApproval`
  (active agent unchanged).
- At read time, treat the token as absent if expired or if its stamped `agentKey`/`apiUrl` no longer match the active
  config (covers env-var overrides). Self-correcting.

## Errors & exit codes

Domain errors as `ok:false` envelopes, exit 0 (JSON mode), per the `fetch` policy: `CARD_AMOUNT_OUT_OF_RANGE`,
`CARD_REGION_BLOCKED` (US-IP), `TOKEN_REQUIRED` (cold token cache on a read without `--pay`). Exit 1 only for caller
misuse / missing config.

A still-provisioning card is **not** an error: `details <id>` on a pending card returns `ok:true` with
`{ card_id, status: "pending" }` and no card data. The agent polls on `data.status`, not on `ok`. (No `CARD_NOT_READY`.)

## Files

| File                                              | Change                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/cli/commands/card.ts` (new)                  | The command. Registration boilerplate from `fund.ts`; spending path (per call) from the `fetch.ts` `--pay` branch via `createPaidFetch`.                                                                                                                                                                                                                                                                      |
| `src/cli/ampersend.ts`                            | `registerCardCommand(program)`.                                                                                                                                                                                                                                                                                                                                                                               |
| `src/cli/commands/fetch.ts`                       | Extract & export `createPaidFetch(creds, { siwx })` → `{ fetchWithPayment, getSelected }`, so `card` and `fetch` share the client + SIWX + hook wiring (one place, two callers; fresh instance per paid call). Also extract & export `buildReceiptFromResponse(selected, response)` (reads the `payment-response` header + builds the receipt) so both commands share it instead of duplicating the decode.   |
| `src/cli/config.ts`                               | `lasoToken` field + schema; `store/readLasoToken`; omit token in the three identity/URL writes.                                                                                                                                                                                                                                                                                                               |
| Laso types (next to `card.ts`)                    | Small response schemas. **Not** added to `ampersend/index.ts` — Laso isn't our domain.                                                                                                                                                                                                                                                                                                                        |
| `tests/cli/card.test.ts` (new)                    | Mirror `fetch.test.ts`: parsers; masking (PAN last-4, cvv, expiry-in-clear); amount validation; token-invalidation; read-flag matrix — warm (free, no receipt), cold+`--pay` (mints, receipt), cold no-flag (`TOKEN_REQUIRED`); pending-card returns `ok:true status:pending`. Receipt-build coverage lives in `fetch.test.ts` (`buildReceiptFromResponse`), not here, since that helper moved to `fetch.ts`. |
| `skills/ampersend/references/example-services.md` | Replace the manual 3-call Laso entry with `card issue` / `card details`.                                                                                                                                                                                                                                                                                                                                      |
| `skills/ampersend/SKILL.md`                       | Real-world-purchases line points at `card`; bump `version`.                                                                                                                                                                                                                                                                                                                                                   |
| `skills/ampersend/references/commands.md`         | Flag reference for `card`.                                                                                                                                                                                                                                                                                                                                                                                    |
| `docs/spec/ampersend-skill/{SPEC,CONFORMANCE}.md` | Regenerate — line counts shift.                                                                                                                                                                                                                                                                                                                                                                               |

## Out of scope (v1)

Dashboard handoff (Laso `/get-auth-link`), token refresh (`POST /auth`), gift / push / international cards.
