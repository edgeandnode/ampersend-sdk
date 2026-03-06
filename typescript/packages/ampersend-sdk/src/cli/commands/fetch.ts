import { wrapFetchWithPayment } from "@x402/fetch"
import type { Command } from "commander"

import { NETWORKS, parseEnvConfig } from "../../ampersend/env.ts"
import { createAmpersendHttpClient } from "../../x402/http/factory.ts"
import { createDebugFetch, createLogger } from "../debug.ts"

interface FetchOptions {
  method: string
  header?: Array<string>
  data?: string
  inspect: boolean
  raw: boolean
  headers: boolean
  debug: boolean
}

/** Envelope for all JSON output - consistent top-level structure */
type JsonEnvelope<T> = { ok: true; data: T } | { ok: false; error: string }

interface ResponseData {
  status: number
  headers?: Record<string, string>
  body: string
  payment?: unknown
}

interface InspectData {
  url: string
  paymentRequired: boolean
  requirements?: unknown
  headers?: Record<string, string>
}

function ok<T>(data: T): JsonEnvelope<T> {
  return { ok: true, data }
}

function err(error: string): JsonEnvelope<never> {
  return { ok: false, error }
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
  const logger = createLogger(options.debug)
  const headers = parseHeaders(options.header)

  logger.debug("cli.inspect", `Fetching ${url} to check payment requirements`, { url })

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
    // Try to parse payment requirements
    try {
      // Check for v2 header first (base64-encoded JSON)
      const v2Header = response.headers.get("X-Payment-Required")
      if (v2Header) {
        const decoded = Buffer.from(v2Header, "base64").toString("utf-8")
        data.requirements = JSON.parse(decoded)
      } else {
        // Fall back to body (v1)
        const body = await response.text()
        if (body) {
          data.requirements = JSON.parse(body)
        }
      }
    } catch (e) {
      // Return error envelope for parse failures
      if (!options.raw) {
        console.log(
          JSON.stringify(
            err(`Failed to parse payment requirements: ${e instanceof Error ? e.message : String(e)}`),
            null,
            2,
          ),
        )
        return
      }
      console.error(`Error: Failed to parse payment requirements: ${e instanceof Error ? e.message : String(e)}`)
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
 * Handle response output
 */
async function handleResponse(response: Response, options: FetchOptions): Promise<void> {
  if (options.raw) {
    const body = await response.text()
    console.log(body)
  } else {
    const body = await response.text()
    const data: ResponseData = {
      status: response.status,
      body,
    }

    // Include headers only if requested
    if (options.headers) {
      data.headers = headersToObject(response.headers)
    }

    // Check if payment was made (look for payment response header)
    const paymentResponse = response.headers.get("X-Payment-Response") || response.headers.get("Payment-Response")
    if (paymentResponse) {
      data.payment = JSON.parse(paymentResponse)
    }

    console.log(JSON.stringify(ok(data), null, 2))
  }
}

/**
 * Execute fetch with automatic x402 payment handling
 */
async function runFetch(url: string, options: FetchOptions): Promise<void> {
  const logger = createLogger(options.debug)
  logger.debug("cli.init", "Starting ampersend fetch", { url, method: options.method })

  let config
  try {
    config = parseEnvConfig()
    logger.debug("cli.config", "Loaded environment config", {
      smart_account_address: config.SMART_ACCOUNT_ADDRESS,
      network: config.NETWORK,
      api_url: config.API_URL ?? "(default)",
      session_key: "[REDACTED]",
    })
  } catch (e) {
    if (e instanceof Error && e.message.includes("Missing wallet configuration")) {
      console.error("Error: Wallet not configured.")
      console.error("")
      console.error("Set environment variables:")
      console.error("  AMPERSEND_AGENT_KEY=address:::session_key")
      console.error("")
      console.error("Or separately:")
      console.error("  AMPERSEND_SMART_ACCOUNT_ADDRESS - Your smart account address")
      console.error("  AMPERSEND_SESSION_KEY - Session key private key")
      console.error("")
      console.error("Optional:")
      console.error("  AMPERSEND_NETWORK - Network (default: base)")
      console.error("  AMPERSEND_API_URL - Ampersend API URL")
      process.exit(1)
    }
    throw e
  }

  // Create Ampersend HTTP client
  logger.debug("cli.setup", "Creating Ampersend HTTP client")
  const ampersendClient = createAmpersendHttpClient({
    smartAccountAddress: config.SMART_ACCOUNT_ADDRESS as `0x${string}`,
    sessionKeyPrivateKey: config.SESSION_KEY as `0x${string}`,
    apiUrl: config.API_URL ?? "https://api.ampersend.ai",
    network: config.NETWORK as "base" | "base-sepolia",
  })

  // Wrap fetch with payment handling
  logger.debug("cli.setup", "Wrapping fetch with x402 payment handler")
  const debugFetch = options.debug ? createDebugFetch(logger) : fetch
  const fetchWithPayment = wrapFetchWithPayment(
    debugFetch,
    ampersendClient as unknown as Parameters<typeof wrapFetchWithPayment>[1],
  )

  // Build request
  const headers = parseHeaders(options.header)

  // Execute request
  logger.debug("cli.exec", "Executing request with payment handler")
  const response = await fetchWithPayment(url, buildRequestInit(options, headers))

  logger.debug("cli.done", `Final response: ${response.status} ${response.statusText}`, { status: response.status })

  await handleResponse(response, options)
}

/**
 * Execute the fetch command
 */
async function executeFetch(url: string, options: FetchOptions): Promise<void> {
  try {
    if (options.inspect) {
      await runInspect(url, options)
    } else {
      await runFetch(url, options)
    }
  } catch (error) {
    if (options.raw) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
    } else {
      console.log(JSON.stringify(err(error instanceof Error ? error.message : String(error)), null, 2))
    }
    process.exit(1)
  }
}

/**
 * Register the fetch subcommand on a Commander program
 */
export function registerFetchCommand(program: Command): void {
  program
    .command("fetch")
    .description("Make HTTP requests with automatic x402 payment handling")
    .argument("<url>", "URL to request")
    .option("-X, --method <method>", "HTTP method", "GET")
    .option("-H, --header <header...>", "HTTP header (format: 'Key: Value')")
    .option("-d, --data <data>", "Request body data")
    .option("--inspect", "Show payment requirements without executing payment", false)
    .option("--raw", "Output raw response body instead of JSON", false)
    .option("--headers", "Include response headers in JSON output", false)
    .option("--debug", "Show detailed debug logging for troubleshooting", false)
    .addHelpText(
      "after",
      `
Environment Variables:
  AMPERSEND_AGENT_KEY            Combined format: address:::session_key
  -- or --
  AMPERSEND_SMART_ACCOUNT_ADDRESS  Smart account address
  AMPERSEND_SESSION_KEY            Session key private key
  AMPERSEND_NETWORK                Network: ${NETWORKS.join(", ")} (default: base)
  AMPERSEND_API_URL                Ampersend API URL (optional)

Examples:
  # Simple GET request
  ampersend fetch https://api.example.com/paid-endpoint

  # POST with JSON body
  ampersend fetch -X POST -H "Content-Type: application/json" -d '{"query":"test"}' https://api.example.com/

  # Inspect payment requirements without paying
  ampersend fetch --inspect https://api.example.com/paid-endpoint

  # Debug mode to troubleshoot payment issues
  ampersend fetch --debug https://api.example.com/paid-endpoint

  # Raw response body (disable JSON output)
  ampersend fetch --raw https://api.example.com/paid-endpoint
`,
    )
    .action(async (url: string, options: FetchOptions) => {
      await executeFetch(url, options)
    })
}

export { executeFetch, runFetch, runInspect }
