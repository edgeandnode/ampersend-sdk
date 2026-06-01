import { Mutex } from "async-mutex"
import { DateTime, Schema } from "effect"
import { SiweMessage } from "siwe"
import { privateKeyToAccount } from "viem/accounts"

import { VERSION } from "../version.ts"
import type { PaymentAuthorization, PaymentRequest } from "../x402/envelopes.ts"
import {
  AgentAuthorizeRequest,
  AgentAuthorizeResponse,
  AgentPaymentEventReport,
  AgentPaymentEventResponse,
  ApiError,
  SignSiwxResponse,
  SIWELoginResponse,
  SIWENonceResponse,
  type Address,
  type ApiClientOptions,
  type AuthenticationState,
  type PaymentEvent,
  type SIWELoginRequest,
} from "./types.js"

export * from "./types.js"

/**
 * Best-effort summary of an HTTP error body. The server emits Effect Schema
 * decode errors as JSON like `{ _tag: "HttpApiDecodeError", issues: [{ path,
 * message }, ...], message: "<long indented blob>" }`. The raw `message` is
 * unreadable; collapse `issues[]` into a flat string instead. For anything
 * we don't recognise — including non-JSON bodies — return the body verbatim.
 */
function formatServerErrorBody(body: string): string {
  try {
    const { issues, message } = JSON.parse(body) as { issues?: unknown; message?: unknown }
    if (Array.isArray(issues) && issues.length > 0) {
      return issues
        .map((i: { path?: unknown; message?: unknown }) => {
          const path = Array.isArray(i?.path) && i.path.length > 0 ? i.path.join(".") : null
          const msg = typeof i?.message === "string" ? i.message : "validation failed"
          return path ? `${path}: ${msg}` : msg
        })
        .join("; ")
    }
    return typeof message === "string" ? message : body
  } catch {
    return body
  }
}

/**
 * TypeScript SDK for the API
 *
 * Provides simple methods to interact with the payment authorization API,
 * including SIWE authentication and payment lifecycle management.
 */
export class ApiClient {
  private readonly baseUrl: string
  private readonly sessionKeyPrivateKey: `0x${string}` | undefined
  private readonly agentAddress: Address | undefined
  private readonly timeout: number
  /**
   * `Ampersend-Client` header value sent on every authenticated request.
   * Format: `<name>/<version>`. Used by the API for product-analytics
   * client attribution. Defaults to `sdk-typescript/<VERSION>`; the
   * `ampersend` CLI overrides `clientName` to `ampersend-cli`.
   */
  private clientHeader: string
  private authMutex = new Mutex()
  private auth: AuthenticationState = {
    token: null,
    expiresAt: null,
  }

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "") // Remove trailing slash
    this.sessionKeyPrivateKey = options.sessionKeyPrivateKey
    this.agentAddress = options.agentAddress
    this.timeout = options.timeout ?? 30000
    const clientName = options.clientName ?? "sdk-typescript"
    this.clientHeader = `${clientName}/${VERSION}`
  }

  /**
   * Internal method to perform authentication without mutex (for use within mutex)
   */
  private async performAuthentication(): Promise<void> {
    if (!this.sessionKeyPrivateKey) {
      throw new ApiError("Session key private key is required for authentication")
    }
    if (!this.agentAddress) {
      throw new ApiError("Agent address is required for authentication")
    }

    try {
      const account = privateKeyToAccount(this.sessionKeyPrivateKey)
      const sessionKeyAddress = account.address

      // Step 1: Get nonce
      const nonceResponse = await this.fetch("/api/v1/agents/auth/nonce", { method: "GET" }, SIWENonceResponse)
      const nonce = nonceResponse.nonce
      const sessionId = nonceResponse.sessionId

      // Step 2: Create SIWE message
      const domain = new URL(this.baseUrl).host
      const siweMessage = new SiweMessage({
        domain,
        address: sessionKeyAddress,
        statement: "Sign in to API",
        uri: this.baseUrl,
        version: "1",
        chainId: 1, // Could be configurable
        nonce,
        issuedAt: new Date().toISOString(),
      })

      // Step 3: Sign the message
      const message = siweMessage.prepareMessage()
      const signature = await account.signMessage({ message })

      // Step 4: Login with signature
      const loginRequest: SIWELoginRequest = {
        message,
        signature,
        sessionId,
        agentAddress: this.agentAddress,
      }

      const loginResponse = await this.fetch(
        "/api/v1/agents/auth/login",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(loginRequest),
        },
        SIWELoginResponse,
      )

      // Verify returned agentAddress matches what we configured
      if (loginResponse.agentAddress.toLowerCase() !== this.agentAddress.toLowerCase()) {
        throw new ApiError(`Agent address mismatch: requested ${this.agentAddress}, got ${loginResponse.agentAddress}`)
      }

      // Store authentication state (agentAddress comes from config, not server)
      this.auth = {
        token: loginResponse.token,
        expiresAt: DateTime.toDateUtc(loginResponse.expiresAt),
      }
    } catch (error) {
      if (error instanceof ApiError) {
        throw error
      }
      throw new ApiError(`Authentication failed: ${error}`)
    }
  }

  async authorizePayment(
    paymentRequest: PaymentRequest,
    context?: AgentAuthorizeRequest["context"],
  ): Promise<typeof AgentAuthorizeResponse.Type> {
    await this.ensureAuthenticated()

    const request: AgentAuthorizeRequest = { paymentRequest, context }
    const wireBody = Schema.encodeSync(AgentAuthorizeRequest)(request)

    const response = await this.fetch(
      `/api/v1/agents/${this.agentAddress}/payment/authorize`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.auth.token}`,
        },
        body: JSON.stringify(wireBody),
      },
      AgentAuthorizeResponse,
    )

    // A bad acceptsIndex from the server would silently point the wallet at
    // the wrong line-item. Catch it here rather than letting it fall through.
    const acceptsLen = paymentRequest.data.accepts.length
    const checkIndex = (idx: number, where: string): void => {
      if (!Number.isInteger(idx) || idx < 0 || idx >= acceptsLen) {
        throw new ApiError(
          `authorize response: ${where} acceptsIndex=${idx} out of bounds (accepts.length=${acceptsLen})`,
        )
      }
    }
    if (response.authorized.selected) checkIndex(response.authorized.selected.acceptsIndex, "selected")
    for (const alt of response.authorized.alternatives) checkIndex(alt.acceptsIndex, "alternatives")
    for (const rej of response.rejected) checkIndex(rej.acceptsIndex, "rejected")

    return response
  }

  /**
   * Ask the Ampersend API to co-sign a Sign-In-With-X (CAIP-122 / EIP-4361)
   * message. The service parses the message, verifies it claims this agent's
   * smart account, and signs `hashMessage(message)` with the service key.
   *
   * The buyer concatenates this with its own session-key signature and wraps
   * via CoSignerValidator for ERC-1271 verification.
   */
  async signSiwxChallenge(message: string): Promise<typeof SignSiwxResponse.Type> {
    await this.ensureAuthenticated()

    return this.fetch(
      `/api/v1/agents/${this.agentAddress}/auth/sign-siwx`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.auth.token}`,
        },
        body: JSON.stringify({ message }),
      },
      SignSiwxResponse,
    )
  }

  async reportPaymentEvent(
    eventId: string,
    payment: PaymentAuthorization,
    event: PaymentEvent,
  ): Promise<AgentPaymentEventResponse> {
    await this.ensureAuthenticated()

    const report: AgentPaymentEventReport = { id: eventId, payment, event }
    const wireBody = Schema.encodeSync(AgentPaymentEventReport)(report)

    return this.fetch(
      `/api/v1/agents/${this.agentAddress}/payment/events`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.auth.token}`,
        },
        body: JSON.stringify(wireBody),
      },
      AgentPaymentEventResponse,
    )
  }

  /**
   * Authenticated GET against a path on the API. Performs SIWE auth first
   * if needed, then decodes the response against `schema`. Use this from
   * read-only clients that share auth with the rest of the SDK.
   */
  async getAuthorized<A, I>(path: string, schema: Schema.Schema<A, I>): Promise<A> {
    await this.ensureAuthenticated()
    return this.fetch(
      path,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${this.auth.token}` },
      },
      schema,
    )
  }

  /**
   * Clear the current authentication state
   */
  clearAuth(): void {
    this.auth = {
      token: null,
      expiresAt: null,
    }
  }

  /**
   * Get the configured agent address, or `undefined` if the client was
   * constructed for unauthenticated reads only.
   */
  getAgentAddress(): Address | undefined {
    return this.agentAddress
  }

  /**
   * Check if currently authenticated and token is valid
   */
  isAuthenticated(): boolean {
    return !!(this.auth.token && this.auth.expiresAt && this.auth.expiresAt > new Date())
  }

  /**
   * Ensure the client is authenticated, performing authentication if needed
   */
  private async ensureAuthenticated(): Promise<void> {
    return this.authMutex.runExclusive(async () => {
      if (!this.isAuthenticated()) {
        await this.performAuthentication()
      }
    })
  }

  /**
   * Internal fetch wrapper with error handling and schema decoding
   */
  async fetch<A, I>(path: string, init: RequestInit, schema: Schema.Schema<A, I>): Promise<A> {
    const url = `${this.baseUrl}${path}`

    try {
      // Merge in the Ampersend-Client header so the API can attribute
      // product-analytics events to SDK vs CLI vs library callers.
      // Caller-supplied headers win on conflict.
      const headers = new Headers(init.headers)
      if (!headers.has("Ampersend-Client")) {
        headers.set("Ampersend-Client", this.clientHeader)
      }

      const response = await fetch(url, {
        ...init,
        headers,
        signal: AbortSignal.timeout(this.timeout),
      })

      if (!response.ok) {
        let errorMessage = `HTTP ${response.status} ${response.statusText}`
        try {
          const errorBody = await response.text()
          if (errorBody) {
            errorMessage += `: ${formatServerErrorBody(errorBody)}`
          }
        } catch {
          // Ignore error body parsing failures
        }
        throw new ApiError(errorMessage, response.status, response)
      }

      const data = await response.json()
      return Schema.decodeUnknownSync(schema)(data)
    } catch (error) {
      if (error instanceof ApiError) {
        throw error
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw new ApiError(`Request timeout after ${this.timeout}ms`)
      }
      throw new ApiError(`Request failed: ${error}`)
    }
  }
}
