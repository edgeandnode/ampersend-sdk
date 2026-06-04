import {
  Address,
  AgentAuthorizeResponse,
  Caip2ID,
  Hex32Bytes,
  Hex65Bytes,
  NonNegativeIntegerString,
  TxHash,
} from "@/ampersend/types.ts"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"

describe("Primitive Schema Validation Messages", () => {
  describe("Address", () => {
    it("should accept valid Ethereum addresses", () => {
      const validAddress = "0x1234567890123456789012345678901234567890"
      const result = Schema.decodeUnknownResult(Address)(validAddress)
      expect(result._tag).toBe("Success")
    })

    it("should reject invalid addresses with a user-friendly message", () => {
      // This is a 32-byte hash (64 hex chars), not a 20-byte address (40 hex chars)
      const invalidAddress = "0xcabe5e4df05692aea7ab8f0c5efda3c9852d2dcb54df97336241b12bfc909228"
      const result = Schema.decodeUnknownResult(Address)(invalidAddress)

      expect(result._tag).toBe("Failure")
      if (result._tag === "Failure") {
        const errorMessage = String(result.failure)
        expect(errorMessage).toContain("Must be a valid Ethereum address (0x followed by 40 hex characters)")
      }
    })

    it("should reject non-hex strings with a user-friendly message", () => {
      const invalidAddress = "not-an-address"
      const result = Schema.decodeUnknownResult(Address)(invalidAddress)

      expect(result._tag).toBe("Failure")
      if (result._tag === "Failure") {
        const errorMessage = String(result.failure)
        expect(errorMessage).toContain("Must be a valid Ethereum address (0x followed by 40 hex characters)")
      }
    })
  })

  describe("TxHash", () => {
    it("should accept valid transaction hashes", () => {
      const validHash = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
      const result = Schema.decodeUnknownResult(TxHash)(validHash)
      expect(result._tag).toBe("Success")
    })

    it("should reject invalid hashes with a user-friendly message", () => {
      const invalidHash = "not-a-hash"
      const result = Schema.decodeUnknownResult(TxHash)(invalidHash)

      expect(result._tag).toBe("Failure")
      if (result._tag === "Failure") {
        const errorMessage = String(result.failure)
        expect(errorMessage).toContain("Must be a valid transaction hash (0x followed by hex characters)")
      }
    })
  })

  describe("Caip2ID", () => {
    it("should accept valid CAIP-2 chain IDs", () => {
      const validCaip2 = "eip155:1"
      const result = Schema.decodeUnknownResult(Caip2ID)(validCaip2)
      expect(result._tag).toBe("Success")
    })

    it("should accept Base mainnet CAIP-2 ID", () => {
      const validCaip2 = "eip155:8453"
      const result = Schema.decodeUnknownResult(Caip2ID)(validCaip2)
      expect(result._tag).toBe("Success")
    })

    it("should reject invalid CAIP-2 IDs with a user-friendly message", () => {
      const invalidCaip2 = "invalid-chain"
      const result = Schema.decodeUnknownResult(Caip2ID)(invalidCaip2)

      expect(result._tag).toBe("Failure")
      if (result._tag === "Failure") {
        const errorMessage = String(result.failure)
        expect(errorMessage).toContain("Must be a valid CAIP-2 chain ID (e.g., eip155:1)")
      }
    })

    it("should reject malformed CAIP-2 IDs with a user-friendly message", () => {
      const invalidCaip2 = "eip155:" // missing chain number
      const result = Schema.decodeUnknownResult(Caip2ID)(invalidCaip2)

      expect(result._tag).toBe("Failure")
      if (result._tag === "Failure") {
        const errorMessage = String(result.failure)
        expect(errorMessage).toContain("Must be a valid CAIP-2 chain ID (e.g., eip155:1)")
      }
    })
  })

  describe("Hex32Bytes", () => {
    it("should accept a 32-byte hex string", () => {
      const valid = "0x" + "ab".repeat(32)
      const result = Schema.decodeUnknownResult(Hex32Bytes)(valid)
      expect(result._tag).toBe("Success")
    })

    it("should reject a hex string that is too short", () => {
      const tooShort = "0x" + "ab".repeat(31)
      const result = Schema.decodeUnknownResult(Hex32Bytes)(tooShort)
      expect(result._tag).toBe("Failure")
      if (result._tag === "Failure") {
        expect(String(result.failure)).toContain("Must be a 32-byte hex string")
      }
    })

    it("should reject a hex string missing the 0x prefix", () => {
      const noPrefix = "ab".repeat(32)
      const result = Schema.decodeUnknownResult(Hex32Bytes)(noPrefix)
      expect(result._tag).toBe("Failure")
    })

    it("should reject non-hex characters", () => {
      const notHex = "0x" + "zz".repeat(32)
      const result = Schema.decodeUnknownResult(Hex32Bytes)(notHex)
      expect(result._tag).toBe("Failure")
    })
  })

  describe("Hex65Bytes", () => {
    it("should accept a 65-byte hex string (typical ECDSA signature)", () => {
      const valid = "0x" + "ab".repeat(65)
      const result = Schema.decodeUnknownResult(Hex65Bytes)(valid)
      expect(result._tag).toBe("Success")
    })

    it("should reject a 64-byte hex string", () => {
      const tooShort = "0x" + "ab".repeat(64)
      const result = Schema.decodeUnknownResult(Hex65Bytes)(tooShort)
      expect(result._tag).toBe("Failure")
      if (result._tag === "Failure") {
        expect(String(result.failure)).toContain("Must be a 65-byte hex string")
      }
    })
  })

  describe("NonNegativeIntegerString", () => {
    it("should accept a typical wei amount", () => {
      const result = Schema.decodeUnknownResult(NonNegativeIntegerString)("1000000")
      expect(result._tag).toBe("Success")
    })

    it("should accept zero", () => {
      const result = Schema.decodeUnknownResult(NonNegativeIntegerString)("0")
      expect(result._tag).toBe("Success")
    })

    it("should reject negative numbers", () => {
      const result = Schema.decodeUnknownResult(NonNegativeIntegerString)("-1")
      expect(result._tag).toBe("Failure")
      if (result._tag === "Failure") {
        expect(String(result.failure)).toContain("Must be a non-negative integer literal")
      }
    })

    it("should reject decimals", () => {
      const result = Schema.decodeUnknownResult(NonNegativeIntegerString)("1.5")
      expect(result._tag).toBe("Failure")
    })

    it("should reject hex literals", () => {
      const result = Schema.decodeUnknownResult(NonNegativeIntegerString)("0x10")
      expect(result._tag).toBe("Failure")
    })

    it("should reject scientific notation", () => {
      const result = Schema.decodeUnknownResult(NonNegativeIntegerString)("1e6")
      expect(result._tag).toBe("Failure")
    })
  })
})

describe("AgentAuthorizeResponse", () => {
  // Minimal wire payload shape the API would produce. Tests below
  // vary only the `rejected[].reasonCode` presence.
  const wireWithoutReasonCode = {
    authorized: { selected: null, alternatives: [] },
    rejected: [{ acceptsIndex: 0, reason: "Daily spend limit exceeded" }],
  }
  const wireWithReasonCode = {
    authorized: { selected: null, alternatives: [] },
    rejected: [
      {
        acceptsIndex: 0,
        reason: "Daily spend limit exceeded",
        reasonCode: "daily_limit_exceeded",
      },
    ],
  }

  it("decodes a rejected item with reasonCode set", () => {
    const result = Schema.decodeUnknownResult(AgentAuthorizeResponse)(wireWithReasonCode)
    expect(result._tag).toBe("Success")
    if (result._tag === "Success") {
      expect(result.success.rejected[0].reasonCode).toBe("daily_limit_exceeded")
    }
  })

  it("decodes a rejected item without reasonCode (back-compat with older APIs)", () => {
    const result = Schema.decodeUnknownResult(AgentAuthorizeResponse)(wireWithoutReasonCode)
    expect(result._tag).toBe("Success")
    if (result._tag === "Success") {
      expect(result.success.rejected[0].reasonCode).toBeUndefined()
    }
  })

  it("round-trips a reasonCode through encode/decode unchanged", () => {
    const decoded = Schema.decodeUnknownSync(AgentAuthorizeResponse)(wireWithReasonCode)
    const reEncoded = Schema.encodeSync(AgentAuthorizeResponse)(decoded)
    expect((reEncoded.rejected[0] as { reasonCode?: string }).reasonCode).toBe("daily_limit_exceeded")
  })
})
