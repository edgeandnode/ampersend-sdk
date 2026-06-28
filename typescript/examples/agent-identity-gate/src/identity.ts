/**
 * Agent identity verification using @bolyra/sdk.
 *
 * This module is the only Bolyra-specific code in the example. Replace it
 * with any identity/authorization system (SIWE, OAuth, ERC-8004, API keys)
 * by implementing the same interface:
 *
 *   verifyAgentProof(proof, requiredPermissions) => { valid, reason?, ... }
 *
 * The Bolyra implementation verifies a ZKP proving the agent:
 *   1. Is enrolled in an agent registry (Merkle membership)
 *   2. Holds specific permission bits (cumulative encoding)
 *   3. Has a non-expired credential
 */

// In production, import from @bolyra/sdk:
//
//   import {
//     deserializeEnvelope,
//     validateEnvelope,
//     Permission,
//   } from "@bolyra/sdk"
//
// For this example we keep it dependency-light with inline types
// so the example runs without circuit artifacts.

/** Proof payload the agent includes in the x402 payment extra field. */
export interface AgentProofPayload {
  /** Serialized Bolyra ProofEnvelope (application/vnd.bolyra.proof+json) */
  envelope: {
    version: string
    circuit: { name: string; version: string; vkeyHash?: string }
    proofType: string
    publicSignals: string[]
    proof: {
      pi_a: [string, string]
      pi_b: [[string, string], [string, string]]
      pi_c: [string, string]
    }
    metadata?: Record<string, unknown>
  }
}

export interface VerificationResult {
  valid: boolean
  reason?: string
  /** Agent's nullifier — unique pseudonym per session, no PII leaked */
  agentNullifier?: string
  /** Bitmask of permissions the agent proved it holds */
  permissionBitmask?: bigint
}

/**
 * Verify an agent's ZKP credential proof and check required permissions.
 *
 * In production this calls snarkjs.groth16.verify() under the hood via
 * @bolyra/sdk's verifyHandshake(). For this example we do structural
 * validation only — swap in the real verification for deployment.
 */
export async function verifyAgentProof(
  payload: AgentProofPayload,
  requiredPermissions: bigint,
): Promise<VerificationResult> {
  const { envelope } = payload

  // 1. Structural validation
  if (!envelope || envelope.version !== "1.0.0") {
    return { valid: false, reason: "Invalid or unsupported envelope version" }
  }

  if (envelope.circuit?.name !== "AgentPolicy") {
    return {
      valid: false,
      reason: `Expected AgentPolicy circuit, got ${envelope.circuit?.name}`,
    }
  }

  if (!envelope.publicSignals || envelope.publicSignals.length < 3) {
    return {
      valid: false,
      reason: "Proof missing required public signals",
    }
  }

  // 2. Extract public signals
  //    AgentPolicy public signals layout:
  //    [0] = agentNullifier
  //    [1] = permissionBitmask
  //    [2] = expiryTimestamp
  const agentNullifier = envelope.publicSignals[0]
  const permissionBitmask = BigInt(envelope.publicSignals[1])
  const expiryTimestamp = BigInt(envelope.publicSignals[2])

  // 3. Check expiry
  const now = BigInt(Math.floor(Date.now() / 1000))
  if (expiryTimestamp <= now) {
    return {
      valid: false,
      reason: `Agent credential expired at ${expiryTimestamp} (now: ${now})`,
      agentNullifier,
      permissionBitmask,
    }
  }

  // 4. Check permissions (cumulative bit encoding)
  //    Required bits must be a subset of the agent's proven bits
  if ((permissionBitmask & requiredPermissions) !== requiredPermissions) {
    return {
      valid: false,
      reason:
        `Insufficient permissions: required 0b${requiredPermissions.toString(2)}, ` +
        `agent has 0b${permissionBitmask.toString(2)}`,
      agentNullifier,
      permissionBitmask,
    }
  }

  // 5. Verify the ZKP
  //
  // PRODUCTION: uncomment this block and add @bolyra/sdk as a real dependency:
  //
  //   import { deserializeEnvelope, validateEnvelope } from "@bolyra/sdk"
  //   const parsed = deserializeEnvelope(JSON.stringify(envelope))
  //   const validationResult = validateEnvelope(parsed)
  //   if (!validationResult.valid) {
  //     return { valid: false, reason: `Invalid proof envelope: ${validationResult.errors.join(", ")}` }
  //   }
  //   // Then verify the Groth16 proof against the AgentPolicy verification key:
  //   const proofValid = await snarkjs.groth16.verify(agentPolicyVkey, envelope.publicSignals, envelope.proof)
  //   if (!proofValid) {
  //     return { valid: false, reason: "ZKP verification failed" }
  //   }
  //
  // For this example, we accept structurally valid proofs to keep the
  // example runnable without circuit artifacts. DO NOT ship this to production.

  console.log(
    `[identity] Verified agent ${agentNullifier.slice(0, 16)}... ` +
      `permissions=0b${permissionBitmask.toString(2)} ` +
      `expires=${expiryTimestamp}`,
  )

  return {
    valid: true,
    agentNullifier,
    permissionBitmask,
  }
}
