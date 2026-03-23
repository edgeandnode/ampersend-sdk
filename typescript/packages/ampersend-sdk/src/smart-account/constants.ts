/**
 * Smart account constants
 */

/**
 * OwnableValidator address - ERC-7579 validator for smart accounts
 * This is the standard validator used by most smart account implementations
 * @see https://github.com/rhinestonewtf/sdk/blob/main/src/modules/validators/core.ts
 */
export const OWNABLE_VALIDATOR = "0x000000000013fdB5234E4E3162a810F54d9f7E98" as const

/**
 * CoSignerValidator address - ERC-7579 validator requiring dual ECDSA signatures
 * Deployed via CREATE2 (same address on all chains)
 */
export const COSIGNER_VALIDATOR = "0x375992f0Eff108D87eAcD355B610bE2263B49bF8" as const
