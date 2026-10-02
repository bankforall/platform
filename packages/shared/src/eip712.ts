import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";

/**
 * EIP-712 definitions shared by the browser (signing) and the API (verification + relaying).
 * They must match CircleFactory.sol and OpenZeppelin's ERC2771Forwarder.
 */

export const FORWARDER_NAME = "BankForAllForwarder";
export const FACTORY_NAME = "BankForAll";

export const forwardRequestTypes = {
  ForwardRequest: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "gas", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint48" },
    { name: "data", type: "bytes" },
  ],
} as const;

export const attestationTypes = {
  Attestation: [
    { name: "subject", type: "address" },
    { name: "circle", type: "address" },
    { name: "reputation", type: "uint32" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

export const keyRotationTypes = {
  KeyRotation: [
    { name: "circle", type: "address" },
    { name: "oldMember", type: "address" },
    { name: "newMember", type: "address" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

export function forwarderDomain(chainId: number, forwarder: Address) {
  return { name: FORWARDER_NAME, version: "1", chainId, verifyingContract: forwarder } as const;
}

export function factoryDomain(chainId: number, factory: Address) {
  return { name: FACTORY_NAME, version: "1", chainId, verifyingContract: factory } as const;
}

/** Forward request as signed by the user; amounts are decimal strings in JSON transport. */
export interface ForwardRequestMessage {
  from: Address;
  to: Address;
  value: bigint;
  gas: bigint;
  nonce: bigint;
  deadline: number;
  data: Hex;
}

/** Same as `Circle.bidHash(round, member, amount, salt)`. */
export function bidHash(circle: Address, round: number, member: Address, amount: bigint, salt: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint8" }, { type: "address" }, { type: "uint128" }, { type: "bytes32" }],
      [circle, round, member, amount, salt],
    ),
  );
}
