import { EVM_NETWORK_CHAIN_ID_MAP } from "@x402/evm/v1"

import { acceptedOf, type PaymentInstruction } from "../../envelopes.ts"

/** v1 looks up the network name; v2 parses `eip155:N`. Returns `null` for unsupported networks. */
export function chainIdOf(instruction: PaymentInstruction): number | null {
  const network = acceptedOf(instruction).network
  if (instruction.protocol === "x402-v1") {
    return (EVM_NETWORK_CHAIN_ID_MAP as Readonly<Record<string, number>>)[network] ?? null
  }
  const match = /^eip155:(\d+)$/.exec(network)
  return match ? Number(match[1]) : null
}
