import { describe, expect, it } from "vitest";
import { crc16, formatBaht, parsePromptPayId, promptPayPayload } from "../src/promptpay.js";

// Expected payloads were cross-checked against the `promptpay-qr` npm package (v0.5.0).
describe("promptPayPayload", () => {
  it.each([
    ["0812345678", undefined, "00020101021129370016A000000677010111011300668123456785802TH530376463045D82"],
    ["0812345678", 422n, "00020101021229370016A000000677010111011300668123456785802TH530376454044.2263045D49"],
    ["1234567890123", 55000n, "00020101021229370016A000000677010111021312345678901235802TH53037645406550.0063046195"],
    ["123456789012345", 1010050n, "00020101021229390016A00000067701011103151234567890123455802TH5303764540810100.50630426B8"],
    ["089-999-9999", 1n, "00020101021229370016A000000677010111011300668999999995802TH530376454040.016304F70A"],
  ])("%s / %s satang", (id, amount, expected) => {
    expect(promptPayPayload(parsePromptPayId(id), amount)).toBe(expected);
  });

  it("rejects malformed IDs and non-positive amounts", () => {
    expect(() => parsePromptPayId("12345")).toThrow();
    expect(() => promptPayPayload(parsePromptPayId("0812345678"), 0n)).toThrow();
  });

  it("computes CRC-16/CCITT-FALSE", () => {
    expect(crc16("123456789")).toBe("29B1");
  });

  it("formats baht", () => {
    expect(formatBaht(123456789n)).toBe("1,234,567.89");
    expect(formatBaht(5n)).toBe("0.05");
    expect(formatBaht(-100n, false)).toBe("-1.00");
  });
});
