/**
 * Shared EIP-712 type definitions for ERC-3009 TransferWithAuthorization
 */

/**
 * ERC-3009 TransferWithAuthorization message type
 * Used by USDC and other ERC-3009 compliant tokens for gasless transfers
 */
export const TRANSFER_WITH_AUTHORIZATION_TYPE = [
  { name: "from", type: "address" },
  { name: "to", type: "address" },
  { name: "value", type: "uint256" },
  { name: "validAfter", type: "uint256" },
  { name: "validBefore", type: "uint256" },
  { name: "nonce", type: "bytes32" },
] as const
