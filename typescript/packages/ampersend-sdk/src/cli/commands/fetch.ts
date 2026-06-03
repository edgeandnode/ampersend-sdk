import { wrapFetchWithPayment } from "@x402/fetch"
import type { Command } from "commander"

import { createAmpersendHttpClient } from "../../x402/http/factory.ts"
import { wrapFetchWithAmpersendSiwx } from "../../x402/siwx.ts"
import { loadCredentials, type ResolvedCredentials } from "../config.ts"
import { err, ok } from "../envelope.ts"

interface SelectedRequirements {
  amount: string
  asset: string
  network: string
  payTo: string
  scheme: string
}

/**
 * A fetch that pays x402 invoices on the agent's behalf, plus a way to read
 * back what it signed. `getSelected()` returns the requirements captured by
 * the `onAfterPaymentCreation` hook, or undefined if no payment happened —
 * the caller pairs it with the server's `payment-response` header to build a
 * truthful receipt (see `buildPaymentReceipt`).
 */
interface PaidFetch {
  fetchWithPayment: typeof globalThis.fetch
  getSelected: () => SelectedRequirements | undefined
}

/**
 * Wire up the Ampersend paid-fetch path used by every spending command:
 * `createAmpersendHttpClient` → (optional SIWX) → `wrapFetchWithPayment`,
 * with the `onAfterPaymentCreation` hook capturing the signed requirements.
 *
 * One instance captures one payment. Callers making more than one paid
 * request (e.g. `card` minting a token then ordering) build a fresh
 * `createPaidFetch` per request so each capture is isolated.
 *
 * SIWX defaults on, matching `fetch --pay`: it satisfies auth-only routes and
 * re-entry to already-paid resources via signature alone; if the server
 * doesn't speak SIWX or rejects our signature, the 402 falls through to the
 * payment wrapper.
 */
function createPaidFetch(credentials: ResolvedCredentials, opts: { siwx: boolean } = { siwx: true }): PaidFetch {
  const apiUrl = credentials.apiUrl ?? "https://api.ampersend.ai"

  const ampersendClient = createAmpersendHttpClient({
    smartAccountAddress: credentials.agentAccount,
    sessionKeyPrivateKey: credentials.agentKey,
    apiUrl,
    clientName: "ampersend-cli",
  })

  // The hook fires right after createPaymentPayload and before the retry to
  // the server, so by the time fetchWithPayment resolves this is populated
  // iff a payment happened. The amount here is what we authorized — what the
  // server settles can only equal this (it can't settle a different value
  // than was signed).
  let selected: SelectedRequirements | undefined
  ampersendClient.onAfterPaymentCreation(async (ctx) => {
    const r = ctx.selectedRequirements
    selected = { amount: r.amount, asset: r.asset, network: r.network, payTo: r.payTo, scheme: r.scheme }
  })

  const innerFetch = opts.siwx
    ? wrapFetchWithAmpersendSiwx(fetch, {
        smartAccountAddress: credentials.agentAccount,
        sessionKeyPrivateKey: credentials.agentKey,
        apiUrl,
        clientName: "ampersend-cli",
      })
    : fetch

  return {
    fetchWithPayment: wrapFetchWithPayment(innerFetch, ampersendClient),
    getSelected: () => selected,
  }
}

interface FetchOptions {
  method: string
  header?: Array<string>
  data?: string
  inspect: boolean
  pay: boolean
  raw: boolean
  headers: boolean
  siwx: boolean
  context?: string
}

interface ResponseData {
  status: number
  headers?: Record<string, string>
  body: unknown
  payment?: PaymentReceipt
}

interface InspectData {
  url: string
  paymentRequired: boolean
  requirements?: unknown
  headers?: Record<string, string>
}

/**
 * Payment receipt returned in the response envelope when --pay actually paid.
 * Amount/asset/network/payTo come from the requirements the client signed
 * against; txHash/payer come from the facilitator's settle response.
 *
 * `asset` is the token contract address. Symbol/decimals are intentionally
 * not included — agents that need them can look up `(network, asset)`.
 */
interface PaymentReceipt {
  amount: string
  asset: string
  network: string
  payTo: string
  scheme: string
  txHash: string
  payer?: string
}

/**
 * Parse headers from CLI format "Key: Value" to Headers object
 */
function parseHeaders(headerArgs: Array<string> | undefined): Headers {
  const headers = new Headers()
  for (const h of headerArgs ?? []) {
    const colonIndex = h.indexOf(":")
    if (colonIndex === -1) {
      console.error(`Invalid header format: ${h} (expected "Key: Value")`)
      process.exit(1)
    }
    const key = h.slice(0, colonIndex).trim()
    const value = h.slice(colonIndex + 1).trim()
    headers.set(key, value)
  }
  return headers
}

/**
 * Format headers for display
 */
function headersToObject(headers: Headers): Record<string, string> {
  const obj: Record<string, string> = {}
  headers.forEach((value, key) => {
    obj[key] = value
  })
  return obj
}

/**
 * Decode a base64-encoded JSON header value.
 * x402 v2 headers (PAYMENT-REQUIRED, PAYMENT-SIGNATURE, PAYMENT-RESPONSE) are base64-encoded.
 */
function decodeBase64Header(value: string): unknown {
  const decoded = Buffer.from(value, "base64").toString("utf-8")
  return JSON.parse(decoded)
}

/**
 * Extract x402 payment requirements from a 402 response. Tries v2 header first
 * (base64-encoded JSON in `payment-required`), then falls back to v1 body.
 * Throws if neither produces parseable JSON.
 */
async function extractPaymentRequirements(response: Response): Promise<unknown> {
  const v2Header = response.headers.get("payment-required")
  if (v2Header) {
    return decodeBase64Header(v2Header)
  }
  const body = await response.text()
  if (body) {
    return JSON.parse(body)
  }
  throw new Error("402 response had no payment-required header and no body")
}

/**
 * Build a PaymentReceipt by combining the requirements the client signed
 * against (truthful amount/asset) with the facilitator's settle response
 * (truthful txHash/payer).
 */
function buildPaymentReceipt(
  selected: SelectedRequirements,
  settle: { transaction: string; payer?: string },
): PaymentReceipt {
  return {
    amount: selected.amount,
    asset: selected.asset,
    network: selected.network,
    payTo: selected.payTo,
    scheme: selected.scheme,
    txHash: settle.transaction,
    ...(settle.payer ? { payer: settle.payer } : {}),
  }
}

/**
 * Build a PaymentReceipt from a paid response, or undefined when no payment
 * happened (no captured `selected`, e.g. a free/warm-cache path) or the server
 * sent no settle header. Combines the signed requirements with the facilitator's
 * `payment-response` settle header.
 */
function buildReceiptFromResponse(
  selected: SelectedRequirements | undefined,
  response: Response,
): PaymentReceipt | undefined {
  const paymentResponse = response.headers.get("payment-response")
  if (!paymentResponse || !selected) return undefined
  const settle = decodeBase64Header(paymentResponse) as { transaction: string; payer?: string }
  return buildPaymentReceipt(selected, settle)
}

/**
 * Build RequestInit from options, handling undefined body correctly
 */
function buildRequestInit(options: FetchOptions, headers: Headers): RequestInit {
  const init: RequestInit = {
    method: options.method,
    headers,
  }
  if (options.data !== undefined) {
    init.body = options.data
  }
  return init
}

/**
 * Inspect mode: fetch URL and display payment requirements without paying
 */
async function runInspect(url: string, options: FetchOptions): Promise<void> {
  const headers = parseHeaders(options.header)
  const response = await fetch(url, buildRequestInit(options, headers))

  const data: InspectData = {
    url,
    paymentRequired: response.status === 402,
  }

  // Include headers if requested
  if (options.headers) {
    data.headers = headersToObject(response.headers)
  }

  if (response.status === 402) {
    try {
      data.requirements = await extractPaymentRequirements(response)
    } catch (e) {
      const message = `Failed to parse payment requirements: ${e instanceof Error ? e.message : String(e)}`
      if (options.raw) {
        console.error(`Error: ${message}`)
        process.exit(1)
      }
      console.log(JSON.stringify(err("PARSE_ERROR", message), null, 2))
      return
    }
  }

  if (options.raw) {
    if (data.paymentRequired) {
      console.log(`Payment Required: YES`)
      console.log(`URL: ${url}`)
      if (data.requirements) {
        console.log(`\nRequirements:`)
        console.log(JSON.stringify(data.requirements, null, 2))
      }
    } else {
      console.log(`Payment Required: NO`)
      console.log(`URL: ${url}`)
      console.log(`Status: ${response.status} ${response.statusText}`)
    }
  } else {
    console.log(JSON.stringify(ok(data), null, 2))
  }
}

/**
 * Emit a successful response envelope (status < 400, or paid 200 via --pay).
 *
 * `selected` carries the requirements the client signed against, captured via
 * the x402Client's onAfterPaymentCreation hook. It's undefined when no payment
 * happened (free endpoint), in which case no `data.payment` is emitted.
 */
async function emitSuccessResponse(
  response: Response,
  options: FetchOptions,
  selected?: SelectedRequirements,
): Promise<void> {
  if (options.raw) {
    const body = await response.text()
    console.log(body)
    return
  }

  const body = await response.text()
  const contentType = response.headers.get("content-type") ?? ""
  let parsedBody: unknown = body
  if (contentType.includes("application/json")) {
    try {
      parsedBody = JSON.parse(body)
    } catch {
      // Keep as string if parsing fails
    }
  }
  const data: ResponseData = {
    status: response.status,
    body: parsedBody,
  }

  if (options.headers) {
    data.headers = headersToObject(response.headers)
  }

  // Build receipt only when both halves are present: the signed requirements
  // (what we authorized) and the settle response (proof it landed).
  const receipt = buildReceiptFromResponse(selected, response)
  if (receipt) {
    data.payment = receipt
  }

  console.log(JSON.stringify(ok(data), null, 2))
}

/**
 * Emit a PAYMENT_REQUIRED error envelope for a 402 response when --pay was not set.
 *
 * Exit-code policy: in JSON mode we exit 0 even when the server's 402 is
 * unparseable — the CLI ran fine, the remote misbehaved, and the agent reads
 * the envelope. In --raw mode we exit 1 to play nice with shell pipelines.
 */
async function emitPaymentRequiredError(response: Response, options: FetchOptions): Promise<void> {
  let requirements: unknown
  try {
    requirements = await extractPaymentRequirements(response)
  } catch (e) {
    const message = `Failed to parse payment requirements: ${e instanceof Error ? e.message : String(e)}`
    if (options.raw) {
      console.error(`Error: ${message}`)
      process.exit(1)
    }
    console.log(JSON.stringify(err("PARSE_ERROR", message), null, 2))
    return
  }

  if (options.raw) {
    console.error("Error: Payment required (pass --pay to authorize)")
    console.error(JSON.stringify(requirements, null, 2))
    return
  }

  console.log(
    JSON.stringify(
      {
        ok: false,
        error: {
          code: "PAYMENT_REQUIRED",
          message: "Payment required (pass --pay to authorize)",
          requirements,
        },
      },
      null,
      2,
    ),
  )
}

/**
 * Execute fetch. Without --pay: behaves like a plain fetch, errors on 402.
 * With --pay: wraps fetch with x402 payment handling and pays as authorized
 * by the configured treasurer.
 */
async function runFetch(url: string, options: FetchOptions): Promise<void> {
  const headers = parseHeaders(options.header)
  const init = buildRequestInit(options, headers)

  if (!options.pay) {
    // Default: probe only. 402 is an error from the caller's perspective —
    // they did not authorize a payment, so they did not get the resource.
    const response = await fetch(url, init)
    if (response.status === 402) {
      await emitPaymentRequiredError(response, options)
      return
    }
    await emitSuccessResponse(response, options)
    return
  }

  // --pay: authorize payment if the server requires it.
  const configResult = loadCredentials({ context: options.context })
  if (!configResult.ok) {
    console.log(JSON.stringify(configResult.error, null, 2))
    process.exit(1)
  }

  const { fetchWithPayment, getSelected } = createPaidFetch(configResult.credentials, { siwx: options.siwx })
  const response = await fetchWithPayment(url, init)
  await emitSuccessResponse(response, options, getSelected())
}

/**
 * Execute the fetch command
 */
async function executeFetch(url: string, options: FetchOptions): Promise<void> {
  if (options.pay && options.inspect) {
    const message = "--pay and --inspect are mutually exclusive"
    if (options.raw) {
      console.error(`Error: ${message}`)
    } else {
      console.log(JSON.stringify(err("INVALID_ARGS", message), null, 2))
    }
    process.exit(1)
  }

  try {
    if (options.inspect) {
      await runInspect(url, options)
    } else {
      await runFetch(url, options)
    }
  } catch (error) {
    // Camp-B exit policy: a thrown fetch (network error, DNS failure, bad URL)
    // is a remote/runtime failure, not a CLI misuse. Emit the envelope and
    // exit 0 in JSON mode so the agent reads the envelope, not $?. In --raw
    // mode we exit 1 to stay shell-pipeline friendly.
    const message = error instanceof Error ? error.message : String(error)
    if (options.raw) {
      console.error(`Error: ${message}`)
      process.exit(1)
    }
    console.log(JSON.stringify(err("REQUEST_ERROR", message), null, 2))
  }
}

/**
 * Register the fetch subcommand on a Commander program
 */
export function registerFetchCommand(program: Command): void {
  program
    .command("fetch")
    .description("Make HTTP requests. By default, errors on 402 unless --pay is passed.")
    .argument("<url>", "URL to request")
    .option("-X, --method <method>", "HTTP method", "GET")
    .option("-H, --header <header...>", "HTTP header (format: 'Key: Value')")
    .option("-d, --data <data>", "Request body data")
    .option("--pay", "Authorize payment if the server returns 402", false)
    .option("--inspect", "Show payment requirements without executing payment", false)
    .option("--raw", "Output raw response body instead of JSON", false)
    .option("--headers", "Include response headers in JSON output", false)
    .option("--no-siwx", "Disable Sign-In-With-X — skip signature auth and go straight to payment")
    .option("--context <name>", "Run against a specific context instead of the active one")
    .addHelpText(
      "after",
      `
Modes:
  ampersend fetch <url>            Probe only. 402 → error envelope (PAYMENT_REQUIRED).
  ampersend fetch --pay <url>      Authorize payment if the server returns 402.
  ampersend fetch --inspect <url>  Report payment requirements without fetching the resource.

Configuration (--pay only):
  Run 'ampersend setup start' to set up, or use environment variables:
  AMPERSEND_AGENT_SECRET           Combined format: agent_key:::agent_account
  AMPERSEND_API_URL                Ampersend API URL (optional)

Examples:
  ampersend fetch https://api.example.com/endpoint
  ampersend fetch --pay https://api.example.com/paid-endpoint
  ampersend fetch --inspect https://api.example.com/paid-endpoint
  ampersend fetch --pay -X POST -H "Content-Type: application/json" -d '{"q":"x"}' https://api.example.com/
`,
    )
    .action(async (url: string, options: FetchOptions) => {
      await executeFetch(url, options)
    })
}

export {
  buildPaymentReceipt,
  buildReceiptFromResponse,
  buildRequestInit,
  createPaidFetch,
  decodeBase64Header,
  executeFetch,
  headersToObject,
  parseHeaders,
  runFetch,
  runInspect,
}
export type { PaidFetch, PaymentReceipt, SelectedRequirements }
