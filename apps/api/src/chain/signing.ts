import { attestationTypes, factoryDomain, keyRotationTypes } from "@bankforall/shared";
import type { Address, Hex } from "viem";
import { chainNow, type Chain } from "./clients.js";

const ATTESTATION_TTL = 30 * 60;

export interface SignedAttestation {
  attestation: { subject: Address; circle: Address; reputation: number; deadline: bigint };
  signature: Hex;
}

/** Backend statement that `subject` passed KYC (circle = 0x0 to create a circle). */
export async function signAttestation(
  chain: Chain,
  subject: Address,
  circle: Address,
  reputation: number,
): Promise<SignedAttestation> {
  const attestation = {
    subject,
    circle,
    reputation: Math.max(0, Math.min(reputation, 2 ** 32 - 1)),
    deadline: BigInt((await chainNow(chain)) + ATTESTATION_TTL),
  };
  const signature = await chain.attester.signTypedData!({
    domain: factoryDomain(chain.chainId, chain.factory),
    types: attestationTypes,
    primaryType: "Attestation",
    message: attestation,
  });
  return { attestation, signature };
}

export async function signKeyRotation(chain: Chain, circle: Address, oldMember: Address, newMember: Address) {
  const deadline = BigInt((await chainNow(chain)) + ATTESTATION_TTL);
  const signature = await chain.attester.signTypedData!({
    domain: factoryDomain(chain.chainId, chain.factory),
    types: keyRotationTypes,
    primaryType: "KeyRotation",
    message: { circle, oldMember, newMember, deadline },
  });
  return { deadline, signature };
}
