import { Mutex } from "async-mutex"
import { SiweMessage } from "siwe"
import { privateKeyToAccount } from "viem/accounts"

import {
  ApiError,
  type Address,
  type AgentPaymentAuthRequest,
  type AgentPaymentAuthResponse,
  type AgentPaymentEventReport,
  type AgentPaymentEventResponse,
  type ApiClientOptions,
  type AuthenticationState,
  type PaymentEvent,
  type PaymentPayload,
  type PaymentRequirements,
  type SIWELoginRequest,
  type SIWELoginResponse,
  type SIWENonceResponse,
} from "./types.js"

export * from "./types.js"

/**
 * TypeScript SDK for the API
 *
 * Provides simple methods to interact with the payment authorization API,
 * including SIWE authentication and payment lifecycle management.
 */
export class ApiClient {
  private baseUrl: string
  private sessionKeyPrivateKey: `0x${string}` | undefined
  private timeout: number
  private authMutex = new Mutex()
  private auth: AuthenticationState = {
    token: null,
    agentAddress: null,
    expiresAt: null,
  }

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "") // Remove trailing slash
    this.sessionKeyPrivateKey = options.sessionKeyPrivateKey
    this.timeout = options.timeout ?? 30000
  }

  /**
   * Internal method to perform authentication without mutex (for use within mutex)
   */
  private async performAuthentication(): Promise<void> {
    if (!this.sessionKeyPrivateKey) {
      throw new ApiError("Session key private key is required for authentication")
    }

    try {
      const account = privateKeyToAccount(this.sessionKeyPrivateKey)
      const sessionKeyAddress = account.address

      // Step 1: Get nonce
      const nonceResponse = await this.fetch<SIWENonceResponse>("/api/v1/agents/auth/nonce", {
        method: "GET",
      })
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
      }

      const loginResponse = await this.fetch<SIWELoginResponse>("/api/v1/agents/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(loginRequest),
      })

      // Store authentication state
      this.auth = {
        token: loginResponse.token,
        agentAddress: loginResponse.agentAddress,
        expiresAt: new Date(loginResponse.expiresAt as unknown as string), // Hack because the API is sending "expiresAt": "2026-09-04T19:24:27.358Z"
      }
    } catch (error) {
      if (error instanceof ApiError) {
        throw error
      }
      throw new ApiError(`Authentication failed: ${error}`)
    }
  }

  /**
   * Request authorization for a payment
   */
  async authorizePayment(
    requirements: readonly [PaymentRequirements, ...Array<PaymentRequirements>],
    context?: AgentPaymentAuthRequest["context"],
  ): Promise<AgentPaymentAuthResponse> {
    await this.ensureAuthenticated()

    const request: AgentPaymentAuthRequest = {
      requirements,
      context,
    }

    return this.fetch<AgentPaymentAuthResponse>(`/api/v1/agents/${this.auth.agentAddress}/payment/authorize`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.auth.token}`,
      },
      body: JSON.stringify(request),
    })
  }

  /**
   * Report a payment lifecycle event
   */
  async reportPaymentEvent(
    eventId: string,
    payment: PaymentPayload,
    event: PaymentEvent,
  ): Promise<AgentPaymentEventResponse> {
    await this.ensureAuthenticated()

    const report: AgentPaymentEventReport = {
      id: eventId,
      payment,
      event,
    }

    return this.fetch<AgentPaymentEventResponse>(`/api/v1/agents/${this.auth.agentAddress}/payment/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.auth.token}`,
      },
      body: JSON.stringify(report),
    })
  }

  /**
   * Clear the current authentication state
   */
  clearAuth(): void {
    this.auth = {
      token: null,
      agentAddress: null,
      expiresAt: null,
    }
  }

  /**
   * Get the current agent address (if authenticated)
   */
  getAgentAddress(): Address | null {
    return this.auth.agentAddress
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
   * Internal fetch wrapper with error handling
   */
  private async fetch<T>(path: string, init: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`

    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(this.timeout),
      })

      if (!response.ok) {
        let errorMessage = `HTTP ${response.status} ${response.statusText}`
        try {
          const errorBody = await response.text()
          if (errorBody) {
            errorMessage += `: ${errorBody}`
          }
        } catch {
          // Ignore error body parsing failures
        }
        throw new ApiError(errorMessage, response.status, response)
      }

      const data = await response.json()
      return data as T
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
