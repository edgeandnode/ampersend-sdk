import type { Command } from "commander"
import { Schema } from "effect"

import {
  loadCredentials,
  readLasoToken,
  storeLasoToken,
  type ContextSelector,
  type LasoToken,
  type ResolvedCredentials,
} from "../config.ts"
import { err, ok, type JsonEnvelope } from "../envelope.ts"
import { buildReceiptFromResponse, createPaidFetch, type PaymentReceipt } from "./fetch.ts"

/**
 * `ampersend card` — issue and read prepaid Visa cards. This wraps Laso's
 * three-call flow (`/auth` → `/get-card` → `/get-card-data`) so the agent
 * never sees "Laso" or a Bearer token:
 *
 *   issue   → /get-card?amount=  (paid x402; returns a card_id)
 *   details → /get-card-data?card_id=  (free on a warm token; --pay mints one)
 *   list    → /get-card-data  (same, no card_id)
 *
 * `issue` is the only stated-amount spend, so it takes no --pay flag. Reads
 * need a Laso Bearer minted via the paid /auth call; that spend is opt-in
 * behind --pay and the token is cached so warm reads are free.
 *
 * v1 is US virtual cards only (0% fee). Gift / push-to-card / international
 * are fast-follows.
 */

/** Laso's base URL. Reads/issues hit these endpoints directly via the paid-fetch path. */
const LASO_BASE_URL = "https://laso.finance"

/** Inclusive USD bounds Laso accepts for `issue`. */
const MIN_AMOUNT_USD = 5
const MAX_AMOUNT_USD = 1000

// --- Laso response schemas (kept here, not in ampersend/index.ts — Laso isn't
// our domain). Tolerant: we decode only the fields we surface and let Effect
// strip the rest. ---

/**
 * The Bearer token block Laso returns under `auth`, on both `/auth` and
 * `/get-card`. `expires_in` is the lifetime in seconds, sent as a *string*
 * (e.g. "3600"); we coerce it to a number and treat it as optional (absent →
 * 1 hour). The refresh token is ignored — v1 re-mints rather than refreshes.
 */
const LasoAuthCredentials = Schema.Struct({
  id_token: Schema.String,
  expires_in: Schema.optional(Schema.NumberFromString),
})

/** `/auth` → just the Bearer block. */
const LasoAuthResponse = Schema.Struct({
  auth: LasoAuthCredentials,
})

/**
 * `/get-card` → the freshly ordered card, nested under `card`, still
 * provisioning (`status: "pending"`). The response also embeds a free `auth`
 * block (same as `/auth`), which we cache so the poll-after-issue flow is free.
 * `auth` is optional so a shape change never fails the issue itself.
 */
const LasoIssueResponse = Schema.Struct({
  card: Schema.Struct({
    card_id: Schema.String,
    status: Schema.String,
    usd_amount: Schema.optional(Schema.Number),
    timestamp: Schema.optional(Schema.Number),
    card_type: Schema.optional(Schema.String),
  }),
  auth: Schema.optional(LasoAuthCredentials),
})

/** One card transaction. Merchant + amount, not a secret — surfaced unmasked. */
const LasoTransaction = Schema.Struct({
  amount: Schema.optional(Schema.Union(Schema.Number, Schema.String)),
  date: Schema.optional(Schema.Union(Schema.String, Schema.Number)),
  description: Schema.optional(Schema.String),
  is_credit: Schema.optional(Schema.Boolean),
})

/**
 * One card as returned by `/get-card-data`. Secrets live under `card_details`
 * and only once the card is ready; expiry is split into `exp_month`/`exp_year`.
 * `available_balance` (vs `usd_amount`) tells you how much has been spent.
 * Tolerant: we decode only the fields we surface and let Effect strip the rest.
 */
const LasoCardData = Schema.Struct({
  card_id: Schema.String,
  status: Schema.String,
  usd_amount: Schema.optional(Schema.Number),
  timestamp: Schema.optional(Schema.Number),
  card_type: Schema.optional(Schema.String),
  card_details: Schema.optional(
    Schema.Struct({
      card_number: Schema.optional(Schema.String),
      exp_month: Schema.optional(Schema.String),
      exp_year: Schema.optional(Schema.String),
      cvv: Schema.optional(Schema.String),
      available_balance: Schema.optional(Schema.Number),
    }),
  ),
  transactions: Schema.optional(Schema.Array(LasoTransaction)),
})

/** `/get-card-data` with no `card_id` wraps the array under a `cards` key. */
const LasoCardListResponse = Schema.Struct({
  cards: Schema.Array(LasoCardData),
})

const decodeAuth = Schema.decodeUnknownSync(LasoAuthResponse)
const decodeIssue = Schema.decodeUnknownSync(LasoIssueResponse)
const decodeCardData = Schema.decodeUnknownSync(LasoCardData)
const decodeCardList = Schema.decodeUnknownSync(LasoCardListResponse)

/** A decoded Laso card record (raw Laso field names). */
type LasoCard = typeof LasoCardData.Type

/** Default Laso token lifetime when `/auth` omits `expires_in`. */
const DEFAULT_TOKEN_TTL_SECONDS = 60 * 60

interface IssueOptions {
  amount?: string
  raw: boolean
  context?: string
}

interface DetailsOptions {
  pay: boolean
  reveal: boolean
  raw: boolean
  context?: string
}

interface ListOptions {
  pay: boolean
  raw: boolean
  context?: string
}

/** `--context <name>` option, shared across card subcommands. */
const CONTEXT_DESCRIPTION = "Run against a specific context instead of the active one"

/**
 * Validate and normalize the `--amount` flag. Returns the trimmed USD string
 * (Laso wants it verbatim in the query) or an error envelope. Rejects
 * non-numeric, non-positive, and out-of-range values up front so we never
 * spend on a request Laso would bounce.
 */
function validateAmount(raw: string | undefined): JsonEnvelope<string> {
  if (raw == null || raw.trim() === "") {
    return err("INVALID_ARGS", "--amount is required, e.g. --amount 25")
  }
  const value = Number(raw)
  if (!Number.isFinite(value)) {
    return err("INVALID_ARGS", `--amount must be a number, got "${raw}"`)
  }
  if (value < MIN_AMOUNT_USD || value > MAX_AMOUNT_USD) {
    return err(
      "CARD_AMOUNT_OUT_OF_RANGE",
      `--amount must be between $${MIN_AMOUNT_USD} and $${MAX_AMOUNT_USD} (got $${value})`,
    )
  }
  return ok(raw.trim())
}

/** A transaction as surfaced to the agent (load, spends, refunds). Not masked. */
interface TransactionView {
  amount?: number | string
  date?: string | number
  description?: string
  is_credit?: boolean
}

/**
 * A card as surfaced to the agent. A stable shape independent of Laso's wire
 * format: `pan`/`cvv`/`expiry` regardless of how Laso nests them. Secrets are
 * present only on a ready card, and masked unless `--reveal`.
 *
 * `amount` is the original load; `balance` is what's spendable now. Usage is
 * read from the pair: unused when `balance === amount`, spent = `amount - balance`.
 */
interface CardView {
  card_id: string
  status: string
  amount?: number
  balance?: number
  ordered_at?: string
  card_type?: string
  pan?: string
  cvv?: string
  expiry?: string
  transactions?: ReadonlyArray<TransactionView>
}

/**
 * Normalize a decoded Laso card into the agent-facing view. Flattens the
 * `card_details` nesting, composes `expiry` from `exp_month`/`exp_year`
 * (e.g. "09" + "26" → "09/26"), surfaces `balance` (available_balance) next to
 * `amount`, and converts the order `timestamp` (Unix ms) to an ISO string.
 *
 * `includeTransactions` is false for `list` (keep it compact) and true for
 * `details`. Balance/secrets/transactions appear only on ready cards.
 */
function toCardView(card: LasoCard, includeTransactions = false): CardView {
  const view: CardView = { card_id: card.card_id, status: card.status }
  if (card.usd_amount !== undefined) view.amount = card.usd_amount
  if (card.card_type !== undefined) view.card_type = card.card_type
  if (card.timestamp !== undefined) view.ordered_at = new Date(card.timestamp).toISOString()
  const d = card.card_details
  if (d?.available_balance !== undefined) view.balance = d.available_balance
  if (d?.card_number !== undefined) view.pan = d.card_number
  if (d?.cvv !== undefined) view.cvv = d.cvv
  if (d?.exp_month !== undefined && d.exp_year !== undefined) {
    view.expiry = `${d.exp_month}/${d.exp_year}`
  }
  if (includeTransactions && card.transactions !== undefined) {
    view.transactions = card.transactions.map((t) => {
      const tx: TransactionView = {}
      if (t.amount !== undefined) tx.amount = t.amount
      if (t.date !== undefined) tx.date = t.date
      if (t.description !== undefined) tx.description = t.description
      if (t.is_credit !== undefined) tx.is_credit = t.is_credit
      return tx
    })
  }
  return view
}

/**
 * Mask a PAN to its last four digits in groups of four: e.g. `4242424242424242`
 * → `•••• •••• •••• 4242`. Tolerates spaces/dashes in the input and short
 * inputs (fewer than four digits are shown as-is behind a single dot group).
 */
function maskPan(pan: string): string {
  const digits = pan.replace(/\D/g, "")
  const last4 = digits.slice(-4)
  return `•••• •••• •••• ${last4}`
}

/**
 * Apply masking to an agent-facing card view unless `reveal` is set. Only the
 * two secrets — PAN and CVV — are masked; everything else (including `expiry`,
 * which isn't a secret on its own) passes through. Returns a copy.
 */
function maskCard(card: CardView, reveal: boolean): CardView {
  if (reveal) return card
  return {
    ...card,
    ...(card.pan !== undefined ? { pan: maskPan(card.pan) } : {}),
    ...(card.cvv !== undefined ? { cvv: "•••" } : {}),
  }
}

/** Compute a token's expiry ISO string from `/auth`'s `expires_in` (seconds). */
function tokenExpiry(expiresInSeconds: number | undefined): string {
  const ttl = (expiresInSeconds ?? DEFAULT_TOKEN_TTL_SECONDS) * 1000
  return new Date(Date.now() + ttl).toISOString()
}

/** Print an envelope to stdout (JSON) or, in --raw mode, the inner data only. */
function emit<T>(envelope: JsonEnvelope<T>, raw: boolean): void {
  if (raw) {
    if (envelope.ok) {
      console.log(JSON.stringify(envelope.data, null, 2))
    } else {
      console.error(`Error: ${envelope.error.message}`)
      process.exit(1)
    }
    return
  }
  console.log(JSON.stringify(envelope, null, 2))
}

/** Load credentials or print the err envelope and exit 1 (caller misuse / missing config). */
function requireCredentials(raw: boolean, opts: ContextSelector = {}): ResolvedCredentials {
  const result = loadCredentials(opts)
  if (!result.ok) {
    emit(result.error, raw)
    process.exit(1)
  }
  return result.credentials
}

/**
 * Detect Laso's US-IP region block. Laso fronts card issuance with a 451 (or a
 * 403 naming the region) when the caller's IP is outside the US. We surface
 * that as the domain error `CARD_REGION_BLOCKED` rather than a raw HTTP error.
 */
function isRegionBlocked(status: number, body: string): boolean {
  if (status === 451) return true
  return status === 403 && /region|country|geo|US[- ]only/i.test(body)
}

/**
 * Stamp a decoded Laso `auth` block with the active identity/URL and cache it.
 * Shared by the `/auth` mint (`ensureToken`) and the free token that rides
 * along on `/get-card` (`executeIssue`). Returns the stored token.
 */
function cacheAuthCredentials(
  auth: typeof LasoAuthCredentials.Type,
  credentials: ResolvedCredentials,
  opts: ContextSelector = {},
): LasoToken {
  const token: LasoToken = {
    idToken: auth.id_token,
    expiresAt: tokenExpiry(auth.expires_in),
    agentKey: credentials.agentKey,
    ...(credentials.apiUrl ? { apiUrl: credentials.apiUrl } : {}),
  }
  storeLasoToken(token, opts)
  return token
}

/**
 * Ensure a usable Laso Bearer for reads. Returns a warm cached token with no
 * spend, or — when `pay` is set — mints one via the paid `/auth` call, caches
 * it, and returns it alongside the payment receipt. When the cache is cold and
 * `pay` is false, returns a `TOKEN_REQUIRED` error so the agent can opt in.
 */
async function ensureToken(
  credentials: ResolvedCredentials,
  pay: boolean,
  opts: ContextSelector = {},
): Promise<JsonEnvelope<{ token: LasoToken; receipt?: PaymentReceipt }>> {
  const cached = readLasoToken(credentials, opts)
  if (cached) {
    return ok({ token: cached })
  }
  if (!pay) {
    return err(
      "TOKEN_REQUIRED",
      "Reading cards needs a Laso access token (~$0.001 to mint). Pass --pay to authorize it.",
    )
  }

  // Cold cache + --pay: mint via the paid x402 /auth call.
  const { fetchWithPayment, getSelected } = createPaidFetch(credentials)
  const response = await fetchWithPayment(`${LASO_BASE_URL}/auth`)
  const body = await response.text()
  if (!response.ok) {
    return err("AUTH_FAILED", `Laso /auth returned HTTP ${response.status}: ${body}`)
  }

  const { auth } = decodeAuth(JSON.parse(body))
  const token = cacheAuthCredentials(auth, credentials, opts)

  const receipt = buildReceiptFromResponse(getSelected(), response)
  return ok({ token, ...(receipt ? { receipt } : {}) })
}

/**
 * `card issue --amount <usd>`: order a card. This is the stated-amount spend,
 * so there is no --pay flag. Returns `{ card_id, status, payment }`; the agent
 * polls `details <id>` until `status: "ready"`.
 */
async function executeIssue(options: IssueOptions): Promise<void> {
  const amountResult = validateAmount(options.amount)
  if (!amountResult.ok) {
    emit(amountResult, options.raw)
    process.exit(1)
  }
  const amount = amountResult.data

  const credentials = requireCredentials(options.raw, options)
  const { fetchWithPayment, getSelected } = createPaidFetch(credentials)

  const url = `${LASO_BASE_URL}/get-card?amount=${encodeURIComponent(amount)}`
  const response = await fetchWithPayment(url)
  const body = await response.text()

  if (isRegionBlocked(response.status, body)) {
    emit(err("CARD_REGION_BLOCKED", "Card issuance is available from US IP addresses only."), options.raw)
    return
  }
  if (!response.ok) {
    emit(err("CARD_ISSUE_FAILED", `Laso /get-card returned HTTP ${response.status}: ${body}`), options.raw)
    return
  }

  const { auth, card } = decodeIssue(JSON.parse(body))
  // Cache the free token that rides along on /get-card so the agent's first
  // details/list poll needs no --pay. Best-effort: absent → reads mint their own.
  if (auth) cacheAuthCredentials(auth, credentials, options)

  const receipt = buildReceiptFromResponse(getSelected(), response)
  emit(
    ok({
      card_id: card.card_id,
      status: card.status,
      ...(card.usd_amount !== undefined ? { amount: card.usd_amount } : {}),
      ...(card.card_type !== undefined ? { card_type: card.card_type } : {}),
      ...(card.timestamp !== undefined ? { ordered_at: new Date(card.timestamp).toISOString() } : {}),
      ...(receipt ? { payment: receipt } : {}),
    }),
    options.raw,
  )
}

/**
 * `card details <id> [--pay] [--reveal]`: fetch one card's status and (once
 * ready) its data. A still-provisioning card returns `ok:true` with
 * `status: "pending"` and no card data — not an error.
 */
async function executeDetails(id: string, options: DetailsOptions): Promise<void> {
  const credentials = requireCredentials(options.raw, options)

  const tokenResult = await ensureToken(credentials, options.pay, options)
  if (!tokenResult.ok) {
    emit(tokenResult, options.raw)
    return
  }
  const { receipt, token } = tokenResult.data

  const url = `${LASO_BASE_URL}/get-card-data?card_id=${encodeURIComponent(id)}`
  const response = await fetch(url, { headers: { authorization: `Bearer ${token.idToken}` } })
  const body = await response.text()
  if (response.status === 404) {
    emit(err("CARD_NOT_FOUND", `No card with id "${id}"`), options.raw)
    return
  }
  if (!response.ok) {
    emit(err("CARD_READ_FAILED", `Laso /get-card-data returned HTTP ${response.status}: ${body}`), options.raw)
    return
  }

  const card = maskCard(toCardView(decodeCardData(JSON.parse(body)), true), options.reveal)
  emit(ok({ ...card, ...(receipt ? { payment: receipt } : {}) }), options.raw)
}

/**
 * `card list [--pay]`: all issued cards (always masked). Same token rules as
 * `details`.
 */
async function executeList(options: ListOptions): Promise<void> {
  const credentials = requireCredentials(options.raw, options)

  const tokenResult = await ensureToken(credentials, options.pay, options)
  if (!tokenResult.ok) {
    emit(tokenResult, options.raw)
    return
  }
  const { receipt, token } = tokenResult.data

  const response = await fetch(`${LASO_BASE_URL}/get-card-data`, {
    headers: { authorization: `Bearer ${token.idToken}` },
  })
  const body = await response.text()
  if (!response.ok) {
    emit(err("CARD_READ_FAILED", `Laso /get-card-data returned HTTP ${response.status}: ${body}`), options.raw)
    return
  }

  const cards = decodeCardList(JSON.parse(body)).cards.map((c) => maskCard(toCardView(c), false))
  emit(ok({ cards, ...(receipt ? { payment: receipt } : {}) }), options.raw)
}

/** Top-level error guard: a thrown network/parse error is a remote/runtime failure, exit 0 in JSON mode. */
async function guard(raw: boolean, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (raw) {
      console.error(`Error: ${message}`)
      process.exit(1)
    }
    console.log(JSON.stringify(err("CARD_ERROR", message), null, 2))
  }
}

/**
 * Register the `card` subcommand on a Commander program.
 */
export function registerCardCommand(program: Command): void {
  const card = program.command("card").description("Issue and read prepaid Visa cards")

  card
    .command("issue")
    .description("Order a prepaid card. Spends the stated amount; returns a card_id to poll with `card details`.")
    .requiredOption("--amount <usd>", `Card value in USD ($${MIN_AMOUNT_USD}–$${MAX_AMOUNT_USD})`)
    .option("--raw", "Print only the inner data, no JSON envelope", false)
    .option("--context <name>", CONTEXT_DESCRIPTION)
    .action(async (options: IssueOptions) => {
      await guard(options.raw, () => executeIssue(options))
    })

  card
    .command("details")
    .description("Show a card's status and, once ready, its data (masked unless --reveal)")
    .argument("<id>", "Card id returned by `card issue`")
    .option("--pay", "Authorize minting a read token (~$0.001) if none is cached", false)
    .option("--reveal", "Show full PAN and CVV instead of masking", false)
    .option("--raw", "Print only the inner data, no JSON envelope", false)
    .option("--context <name>", CONTEXT_DESCRIPTION)
    .action(async (id: string, options: DetailsOptions) => {
      await guard(options.raw, () => executeDetails(id, options))
    })

  card
    .command("list")
    .description("List all issued cards (always masked)")
    .option("--pay", "Authorize minting a read token (~$0.001) if none is cached", false)
    .option("--raw", "Print only the inner data, no JSON envelope", false)
    .option("--context <name>", CONTEXT_DESCRIPTION)
    .action(async (options: ListOptions) => {
      await guard(options.raw, () => executeList(options))
    })
}

export { executeDetails, executeIssue, executeList, maskCard, maskPan, toCardView, tokenExpiry, validateAmount }
