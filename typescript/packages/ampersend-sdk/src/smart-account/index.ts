/**
 * Smart Account utilities for ERC-3009 payment signing
 *
 * This module provides signing functionality for smart accounts using
 * the OwnableValidator pattern and ERC-1271 signature validation.
 */

export { OWNABLE_VALIDATOR } from "./constants.ts"
export { signERC3009Authorization, signSmartAccountTypedData } from "./signing.ts"
export type { ERC3009AuthorizationData } from "./types.ts"
