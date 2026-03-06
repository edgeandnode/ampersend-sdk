import { Address, Caip2ID, TxHash } from "@/ampersend/types.ts"
import { TestSchema } from "effect/testing"
import { describe, it } from "vitest"

describe("Primitive Schema Validation Messages", () => {
  describe("Address", () => {
    it("should accept valid Ethereum addresses", async () => {
      const asserts = new TestSchema.Asserts(Address)
      const decoding = asserts.decoding()

      const validAddress = "0x1234567890123456789012345678901234567890"
      await decoding.succeed(validAddress)
    })

    it("should reject invalid addresses with a user-friendly message", async () => {
      const asserts = new TestSchema.Asserts(Address)
      const decoding = asserts.decoding()

      // This is a 32-byte hash (64 hex chars), not a 20-byte address (40 hex chars)
      const invalidAddress = "0xcabe5e4df05692aea7ab8f0c5efda3c9852d2dcb54df97336241b12bfc909228"
      await decoding.fail(invalidAddress, "Must be a valid Ethereum address (0x followed by 40 hex characters)")
    })

    it("should reject non-hex strings with a user-friendly message", async () => {
      const asserts = new TestSchema.Asserts(Address)
      const decoding = asserts.decoding()

      const invalidAddress = "not-an-address"
      await decoding.fail(invalidAddress, "Must be a valid Ethereum address (0x followed by 40 hex characters)")
    })
  })

  describe("TxHash", () => {
    it("should accept valid transaction hashes", async () => {
      const asserts = new TestSchema.Asserts(TxHash)
      const decoding = asserts.decoding()

      const validHash = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
      await decoding.succeed(validHash)
    })

    it("should reject invalid hashes with a user-friendly message", async () => {
      const asserts = new TestSchema.Asserts(TxHash)
      const decoding = asserts.decoding()

      const invalidHash = "not-a-hash"
      await decoding.fail(invalidHash, "Must be a valid transaction hash (0x followed by hex characters)")
    })
  })

  describe("Caip2ID", () => {
    it("should accept valid CAIP-2 chain IDs", async () => {
      const asserts = new TestSchema.Asserts(Caip2ID)
      const decoding = asserts.decoding()

      const validCaip2 = "eip155:1"
      await decoding.succeed(validCaip2)
    })

    it("should accept Base mainnet CAIP-2 ID", async () => {
      const asserts = new TestSchema.Asserts(Caip2ID)
      const decoding = asserts.decoding()

      const validCaip2 = "eip155:8453"
      await decoding.succeed(validCaip2)
    })

    it("should reject invalid CAIP-2 IDs with a user-friendly message", async () => {
      const asserts = new TestSchema.Asserts(Caip2ID)
      const decoding = asserts.decoding()

      const invalidCaip2 = "invalid-chain"
      await decoding.fail(invalidCaip2, "Must be a valid CAIP-2 chain ID (e.g., eip155:1)")
    })

    it("should reject malformed CAIP-2 IDs with a user-friendly message", async () => {
      const asserts = new TestSchema.Asserts(Caip2ID)
      const decoding = asserts.decoding()

      const invalidCaip2 = "eip155:" // missing chain number
      await decoding.fail(invalidCaip2, "Must be a valid CAIP-2 chain ID (e.g., eip155:1)")
    })
  })
})
