/**
 * Structured debug logging utilities for CLI tools.
 *
 * Design principles:
 * - Outputs to stderr (stdout reserved for program output)
 * - JSON Lines format (one JSON object per line)
 * - Machine-parseable event types
 * - Correlation IDs for request/response tracing
 * - Decodes base64 x402 headers for readability
 */

import type { Authorization, PaymentContext, PaymentStatus, X402Treasurer } from "../x402/treasurer.ts"

/** Log levels in order of severity */
export type LogLevel = "debug" | "info" | "warn" | "error"

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

/** Structured log entry - JSON Lines format */
export interface LogEntry {
  ts: string
  level: LogLevel
  event: string
  msg: string
  request_id?: number
  [key: string]: unknown
}

/** Logger configuration */
export interface LoggerOptions {
  /** Minimum log level to output (default: "debug") */
  minLevel?: LogLevel
  /** Custom output function (default: console.error) */
  output?: (text: string) => void
}

/**
 * Logger interface - logs structured events.
 */
export interface Logger {
  debug(event: string, msg: string, data?: Record<string, unknown>): void
  info(event: string, msg: string, data?: Record<string, unknown>): void
  warn(event: string, msg: string, data?: Record<string, unknown>): void
  error(event: string, msg: string, data?: Record<string, unknown>): void
}

/**
 * Structured logger for CLI debugging.
 *
 * @example
 * ```typescript
 * const logger = new DebugLogger({ format: "pretty" })
 * logger.debug("HTTP", "Request started", { url, method })
 * logger.info("PAYMENT", "Payment authorized", { amount })
 * logger.error("NETWORK", "Connection failed", { error: e.message })
 * ```
 */
export class DebugLogger implements Logger {
  private readonly minLevel: LogLevel
  private readonly outputFn: (text: string) => void

  constructor(options: LoggerOptions = {}) {
    this.minLevel = options.minLevel ?? "debug"
    this.outputFn = options.output ?? ((text: string) => console.error(text))
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[this.minLevel]
  }

  private formatEntry(entry: LogEntry): string {
    // Always output single-line JSON (JSONL format)
    return JSON.stringify(entry)
  }

  /** @internal */
  _log(level: LogLevel, event: string, msg: string, data?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return

    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      event,
      msg,
      ...data,
    }

    this.outputFn(this.formatEntry(entry))
  }

  debug(event: string, msg: string, data?: Record<string, unknown>): void {
    this._log("debug", event, msg, data)
  }

  info(event: string, msg: string, data?: Record<string, unknown>): void {
    this._log("info", event, msg, data)
  }

  warn(event: string, msg: string, data?: Record<string, unknown>): void {
    this._log("warn", event, msg, data)
  }

  error(event: string, msg: string, data?: Record<string, unknown>): void {
    this._log("error", event, msg, data)
  }
}

/** No-op logger that discards all output */
class NullLogger implements Logger {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
}

export const nullLogger: Logger = new NullLogger()

/**
 * Create a logger that only logs when enabled.
 */
export function createLogger(enabled: boolean, options?: LoggerOptions): Logger {
  if (!enabled) return nullLogger
  return new DebugLogger(options)
}

/**
 * Decode a base64-encoded JSON string, returning the parsed object or null on failure.
 */
function decodeBase64Json(base64: string): unknown {
  try {
    const decoded = Buffer.from(base64, "base64").toString("utf-8")
    return JSON.parse(decoded)
  } catch {
    return null
  }
}

/**
 * Truncate a hex string (like a signature) to show first and last N characters.
 */
function truncateHex(hex: string, chars: number = 8): string {
  if (hex.length <= chars * 2 + 3) return hex
  return `${hex.slice(0, chars + 2)}...${hex.slice(-chars)}`
}

/**
 * Truncate signatures in a decoded payment object for readability.
 */
function truncateSignatures(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") return obj
  if (Array.isArray(obj)) return obj.map(truncateSignatures)

  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (key === "signature" && typeof value === "string" && value.startsWith("0x")) {
      result[key] = truncateHex(value)
    } else if (typeof value === "object" && value !== null) {
      result[key] = truncateSignatures(value)
    } else {
      result[key] = value
    }
  }
  return result
}

/**
 * Wrap a treasurer with debug logging.
 */
export function wrapTreasurerWithDebug(treasurer: X402Treasurer, logger: Logger): X402Treasurer {
  return {
    async onPaymentRequired(
      requirements: Parameters<X402Treasurer["onPaymentRequired"]>[0],
      context?: PaymentContext,
    ): Promise<Authorization | null> {
      logger.debug("treasurer.payment_required", "Payment authorization requested", {
        requirements_count: requirements.length,
        context: context ? { method: context.method, params: context.params, metadata: context.metadata } : undefined,
        requirements: requirements.map((r) => ({
          scheme: r.scheme,
          network: r.network,
          maxAmountRequired: r.maxAmountRequired,
          asset: r.asset,
          payTo: r.payTo,
        })),
      })

      const result = await treasurer.onPaymentRequired(requirements, context)

      if (result) {
        logger.info("treasurer.authorized", "Payment authorized", {
          authorization_id: result.authorizationId,
          scheme: result.payment.scheme,
          network: result.payment.network,
          payload: truncateSignatures(result.payment.payload) as Record<string, unknown>,
        })
      } else {
        logger.warn("treasurer.declined", "Payment declined")
      }

      return result
    },

    async onStatus(status: PaymentStatus, authorization: Authorization, context?: PaymentContext): Promise<void> {
      logger.debug("treasurer.status", `Payment status: ${status}`, {
        status,
        authorization_id: authorization.authorizationId,
        context: context ? { method: context.method, params: context.params, metadata: context.metadata } : undefined,
      })

      return treasurer.onStatus(status, authorization, context)
    },
  }
}

/**
 * Extract headers as a plain object, optionally decoding payment headers.
 */
function extractHeaders(headers: Headers): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase()
    // Decode base64-encoded x402 headers
    if (lowerKey === "x-payment-required" || lowerKey === "payment-signature") {
      const decoded = decodeBase64Json(value)
      if (decoded) {
        result[key] = truncateSignatures(decoded)
        return
      }
    }
    result[key] = value
  })
  return result
}

/**
 * Extract request headers from various input formats.
 */
function extractRequestHeaders(input: RequestInfo | URL, init?: RequestInit): Record<string, unknown> {
  const headers: Record<string, unknown> = {}

  // From Request object
  if (typeof input !== "string" && !(input instanceof URL) && input.headers) {
    input.headers.forEach((v, k) => {
      const lowerKey = k.toLowerCase()
      if (lowerKey === "payment-signature") {
        const decoded = decodeBase64Json(v)
        if (decoded) {
          headers[k] = truncateSignatures(decoded)
          return
        }
      }
      headers[k] = v
    })
  }

  // From init.headers
  if (init?.headers) {
    if (init.headers instanceof Headers) {
      init.headers.forEach((v, k) => {
        const lowerKey = k.toLowerCase()
        if (lowerKey === "payment-signature") {
          const decoded = decodeBase64Json(v)
          if (decoded) {
            headers[k] = truncateSignatures(decoded)
            return
          }
        }
        headers[k] = v
      })
    } else if (Array.isArray(init.headers)) {
      init.headers.forEach(([k, v]) => {
        headers[k] = v
      })
    } else {
      Object.entries(init.headers).forEach(([k, v]) => {
        headers[k] = String(v)
      })
    }
  }

  return headers
}

/**
 * Create a fetch wrapper that logs all requests and responses as single-line JSON events.
 */
export function createDebugFetch(logger: Logger): typeof fetch {
  let requestCounter = 0

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const requestId = ++requestCounter
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    const method = init?.method ?? (typeof input !== "string" && !(input instanceof URL) ? input.method : "GET")

    // Build request log data
    const requestData: Record<string, unknown> = {
      request_id: requestId,
      method,
      url,
      headers: extractRequestHeaders(input, init),
    }

    if (init?.body) {
      const bodyStr = typeof init.body === "string" ? init.body : "[non-string body]"
      try {
        requestData.body = JSON.parse(bodyStr)
      } catch {
        requestData.body = bodyStr.length > 500 ? bodyStr.slice(0, 500) + "..." : bodyStr
      }
    }

    // Log request as single event
    logger.debug("http.request", `${method} ${url}`, requestData)

    // Execute request
    const startTime = Date.now()
    const response = await fetch(input, init)
    const durationMs = Date.now() - startTime

    // Build response log data
    const responseData: Record<string, unknown> = {
      request_id: requestId,
      status: response.status,
      status_text: response.statusText,
      duration_ms: durationMs,
      headers: extractHeaders(response.headers),
    }

    // For 402 responses, include body
    if (response.status === 402) {
      const cloned = response.clone()
      try {
        const bodyText = await cloned.text()
        responseData.body = JSON.parse(bodyText)
      } catch {
        responseData.body = "[unparseable]"
      }
      logger.info("http.response", `${response.status} ${response.statusText}`, responseData)
    } else {
      logger.debug("http.response", `${response.status} ${response.statusText}`, responseData)
    }

    return response
  }
}
