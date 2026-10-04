import { afterEach, describe, expect, it, vi } from "vitest";
import { getAddress } from "viem";
import { pinnedChain, resetChainWarningForTests, resolveTrustedChain } from "./chain";
import { SigningRefusedError } from "./verifyIntent";

const FWD = "0x00000000000000000000000000000000000000f0";
const FAC = "0x00000000000000000000000000000000000000fa";
const pins = { VITE_CHAIN_ID: "84532", VITE_FORWARDER_ADDRESS: FWD, VITE_FACTORY_ADDRESS: FAC };
const apiConfig = (patch: object = {}) => () => Promise.resolve({ chainId: 84532, forwarder: FWD, factory: FAC, ...patch });

describe("trusted chain", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetChainWarningForTests();
  });

  it("uses the build-time pins when the API agrees", async () => {
    const chain = await resolveTrustedChain(apiConfig(), { PROD: true, ...pins });
    expect(chain).toEqual({ chainId: 84532, forwarder: getAddress(FWD), factory: getAddress(FAC) });
  });

  it.each([
    ["chain id", { chainId: 1 }],
    ["forwarder", { forwarder: "0x00000000000000000000000000000000000000e0" }],
    ["factory", { factory: "0x00000000000000000000000000000000000000e0" }],
  ])("refuses when /api/config reports another %s", async (_name, patch) => {
    await expect(resolveTrustedChain(apiConfig(patch), { PROD: true, ...pins })).rejects.toBeInstanceOf(SigningRefusedError);
  });

  it("refuses in production without pins", async () => {
    const fetchConfig = vi.fn(apiConfig());
    await expect(resolveTrustedChain(fetchConfig, { PROD: true })).rejects.toBeInstanceOf(SigningRefusedError);
    expect(fetchConfig).not.toHaveBeenCalled();
  });

  it("refuses malformed or partial pins", () => {
    expect(() => pinnedChain({ VITE_CHAIN_ID: "84532" })).toThrow(SigningRefusedError);
    expect(() => pinnedChain({ ...pins, VITE_FACTORY_ADDRESS: "0x123" })).toThrow(SigningRefusedError);
  });

  it("falls back to /api/config in development with a warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const chain = await resolveTrustedChain(apiConfig(), { PROD: false });
    expect(chain.chainId).toBe(84532);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("reads the pins from import.meta.env (set for tests in vite.config.ts)", () => {
    expect(pinnedChain()?.chainId).toBe(84532);
  });
});
