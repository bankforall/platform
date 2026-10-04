import { getAddress, type Address } from "viem";
import { SigningRefusedError } from "./verifyIntent";

/**
 * Which chain and contracts this build trusts. Production builds pin them at build time
 * (`VITE_CHAIN_ID`, `VITE_FORWARDER_ADDRESS`, `VITE_FACTORY_ADDRESS`) so a compromised API cannot
 * point signatures at other contracts. Development builds may fall back to `GET /api/config`.
 */
export interface TrustedChain {
  chainId: number;
  forwarder: Address;
  factory: Address;
}

/** What `GET /api/config` reports (validated loosely; compared against the pins). */
export interface ApiChainConfig {
  chainId: number;
  forwarder: string;
  factory: string;
}

export interface ChainEnv {
  PROD?: boolean;
  VITE_CHAIN_ID?: string;
  VITE_FORWARDER_ADDRESS?: string;
  VITE_FACTORY_ADDRESS?: string;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const MISCONFIGURED = "แอปเวอร์ชันนี้ตั้งค่าเครือข่ายไม่ถูกต้อง จึงยังลงนามรายการไม่ได้ กรุณาแจ้งผู้ดูแลระบบ";

/** The build-time pins, or null when none are set. Partial or malformed pins are refused. */
export function pinnedChain(env: ChainEnv = import.meta.env as ChainEnv): TrustedChain | null {
  const id = env.VITE_CHAIN_ID?.trim();
  const forwarder = env.VITE_FORWARDER_ADDRESS?.trim();
  const factory = env.VITE_FACTORY_ADDRESS?.trim();
  if (!id && !forwarder && !factory) return null;
  if (!id || !/^\d+$/.test(id) || !forwarder || !ADDRESS.test(forwarder) || !factory || !ADDRESS.test(factory)) {
    throw new SigningRefusedError(MISCONFIGURED);
  }
  return { chainId: Number(id), forwarder: getAddress(forwarder), factory: getAddress(factory) };
}

let warned = false;

/**
 * Resolves the chain to verify intents against. With pins, the API's config must agree with them;
 * without pins (development only) the API's config is used and a warning is logged once.
 */
export async function resolveTrustedChain(
  fetchConfig: () => Promise<ApiChainConfig>,
  env: ChainEnv = import.meta.env as ChainEnv,
): Promise<TrustedChain> {
  const pinned = pinnedChain(env);
  if (!pinned && env.PROD) throw new SigningRefusedError(MISCONFIGURED);
  const config = await fetchConfig();
  if (!ADDRESS.test(config.forwarder) || !ADDRESS.test(config.factory)) throw new SigningRefusedError(MISCONFIGURED);
  const fromApi: TrustedChain = {
    chainId: config.chainId,
    forwarder: getAddress(config.forwarder),
    factory: getAddress(config.factory),
  };
  if (!pinned) {
    if (!warned) {
      warned = true;
      console.warn(
        "[bankforall] VITE_CHAIN_ID / VITE_FORWARDER_ADDRESS / VITE_FACTORY_ADDRESS are not set; " +
          "trusting GET /api/config for signing (development only).",
      );
    }
    return fromApi;
  }
  if (
    fromApi.chainId !== pinned.chainId ||
    fromApi.forwarder !== pinned.forwarder ||
    fromApi.factory !== pinned.factory
  ) {
    throw new SigningRefusedError("ข้อมูลเครือข่ายจากเซิร์ฟเวอร์ไม่ตรงกับแอป จึงไม่ลงนามรายการนี้");
  }
  return pinned;
}

/** For tests. */
export function resetChainWarningForTests() {
  warned = false;
}
