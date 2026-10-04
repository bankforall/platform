import type { Address, Hex } from "viem";
import type { Config } from "../config.js";
import {
  attestSlipTx,
  issueAttestation,
  PolicyError,
  rotationSignatures,
  type RotationSignature,
  type SignedAttestation,
  type SignerCtx,
} from "./policy.js";

/** The only way the api/worker obtain attester signatures. */
export interface Signer {
  attestation(subject: Address, circle: Address): Promise<SignedAttestation>;
  attestSlip(slipId: string): Promise<Hex>;
  rotationSignatures(requestId: string): Promise<RotationSignature[]>;
}

/** Development/tests: same policy, in-process. Refused in production by config validation. */
export class LocalSigner implements Signer {
  constructor(private readonly ctx: SignerCtx) {}
  attestation(subject: Address, circle: Address) {
    return issueAttestation(this.ctx, subject, circle);
  }
  attestSlip(slipId: string) {
    return attestSlipTx(this.ctx, slipId);
  }
  rotationSignatures(requestId: string) {
    return rotationSignatures(this.ctx, requestId);
  }
}

const big = (_: string, v: unknown) => (typeof v === "bigint" ? `${v}n` : v);
const unbig = (_: string, v: unknown) => (typeof v === "string" && /^\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v);

export function encodeJson(value: unknown): string {
  return JSON.stringify(value, big);
}

/** Production: calls the signer service on the internal network. */
export class HttpSigner implements Signer {
  constructor(private readonly config: Config) {}

  private async call<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(new URL(path, this.config.SIGNER_URL), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.config.SIGNER_TOKEN}` },
      body: encodeJson(body),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    if (!res.ok) {
      const err = JSON.parse(text || "{}") as { code?: string; message?: string };
      throw new PolicyError(err.code ?? "SIGNER_ERROR", err.message ?? `signer responded ${res.status}`);
    }
    return JSON.parse(text, unbig) as T;
  }

  attestation(subject: Address, circle: Address) {
    return this.call<SignedAttestation>("/attestation", { subject, circle });
  }
  attestSlip(slipId: string) {
    return this.call<{ hash: Hex }>("/attest-slip", { slipId }).then((r) => r.hash);
  }
  rotationSignatures(requestId: string) {
    return this.call<RotationSignature[]>("/rotation-signatures", { requestId });
  }
}

export function createSigner(config: Config, ctx: SignerCtx): Signer {
  return config.SIGNER_URL ? new HttpSigner(config) : new LocalSigner(ctx);
}
