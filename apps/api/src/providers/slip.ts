import type { Config } from "../config.js";

export type SlipResult =
  | { status: "VERIFIED"; detail: Record<string, unknown> }
  | { status: "FAILED"; detail: Record<string, unknown> }
  | { status: "SKIPPED"; detail: Record<string, unknown> };

export interface SlipVerifier {
  verify(input: { image: Buffer; contentType: string; expectedAmount: bigint; receiverPromptPayId: string }): Promise<SlipResult>;
}

/**
 * No automatic verification: the recipient's on-chain confirmation is what settles a payment.
 * Plug a bank slip-verification API (it reads the QR on Thai bank slips) in here; a VERIFIED
 * result makes the worker call `attestSlip` so the slip is marked as checked on-chain.
 */
class NoSlipVerifier implements SlipVerifier {
  async verify() {
    return { status: "SKIPPED" as const, detail: { reason: "no slip verification provider configured" } };
  }
}

export function createSlipVerifier(config: Config): SlipVerifier {
  switch (config.SLIP_VERIFIER) {
    case "none":
      return new NoSlipVerifier();
  }
}
