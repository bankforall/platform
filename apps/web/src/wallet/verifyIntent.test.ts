import { describe, expect, it } from "vitest";
import { encodeFunctionData, getAddress, keccak256, toBytes, zeroAddress, type Hex } from "viem";
import { circleAbi, circleFactoryAbi, CircleType, type IntentKind, type PreparedIntent } from "@bankforall/shared";
import { SigningRefusedError, verifyIntent, type IntentExpectation, type VerifyInput } from "./verifyIntent";
import type { TrustedChain } from "./chain";

const ME = "0x1111111111111111111111111111111111111111";
const CIRCLE = "0x00000000000000000000000000000000000000c1";
const OTHER_CIRCLE = "0x00000000000000000000000000000000000000c2";
const PAYER = "0x00000000000000000000000000000000000000a1";
const chain: TrustedChain = {
  chainId: 84532,
  forwarder: getAddress("0x00000000000000000000000000000000000000f0"),
  factory: getAddress("0x00000000000000000000000000000000000000fa"),
};
const SIG = ("0x" + "11".repeat(65)) as Hex;
const att = (circle: `0x${string}`) => ({ subject: ME as `0x${string}`, circle, reputation: 100, deadline: 1_900_000_000n });

const params = {
  circleType: CircleType.Float,
  hostTakesFirst: true,
  maxMembers: 5,
  fixRateBps: 0,
  minReputation: 0,
  principal: 100_000n,
  period: 30n * 86400n,
  bidWindow: 2n * 86400n,
  revealWindow: 86400n,
  paymentWindow: 5n * 86400n,
  grace: 86400n,
};
const createForm = {
  type: CircleType.Float,
  principal: "100000",
  maxMembers: 5,
  hostTakesFirst: true,
  fixRateBps: 0,
  minReputation: 0,
  period: 30 * 86400,
  bidWindow: 2 * 86400,
  revealWindow: 86400,
  paymentWindow: 5 * 86400,
  grace: 86400,
  hostSeat: 0,
};

const data = {
  createCircle: encodeFunctionData({
    abi: circleFactoryAbi,
    functionName: "createCircle",
    args: [params, 0, att(zeroAddress), SIG],
  }),
  join: encodeFunctionData({ abi: circleAbi, functionName: "join", args: [2, att(CIRCLE), SIG] }),
  confirmReceipt: encodeFunctionData({ abi: circleAbi, functionName: "confirmReceipt", args: [PAYER] }),
  rejectPayment: encodeFunctionData({ abi: circleAbi, functionName: "rejectPayment", args: [PAYER] }),
  commitBid: encodeFunctionData({ abi: circleAbi, functionName: "commitBid", args: [("0x" + "ab".repeat(32)) as Hex] }),
  markDefault: encodeFunctionData({ abi: circleAbi, functionName: "markDefault", args: [PAYER] }),
  dispute: encodeFunctionData({ abi: circleAbi, functionName: "dispute", args: [1, keccak256(toBytes("ไม่ได้รับเงิน"))] }),
};

function intent(kind: IntentKind, to: string, callData: Hex, patch: Partial<PreparedIntent["typedData"]["domain"]> = {}): PreparedIntent {
  return {
    id: "int_1",
    kind,
    summary: "ข้อความจากเซิร์ฟเวอร์",
    typedData: {
      domain: { name: "BankForAllForwarder", version: "1", chainId: chain.chainId, verifyingContract: chain.forwarder, ...patch },
      primaryType: "ForwardRequest",
      message: { from: ME, to, value: "0", gas: "300000", nonce: "1", deadline: 1_900_000_000, data: callData },
    },
  };
}

const members = [{ address: PAYER, displayName: "สมหญิง" }];
const input = (expect: IntentExpectation, extra: Partial<VerifyInput> = {}): VerifyInput => ({
  chain,
  localAddress: ME,
  expect,
  display: { circleName: "วงออฟฟิศ", members, fixSeats: true },
  ...extra,
});

function refused(fn: () => unknown, message?: RegExp) {
  expect(fn).toThrow(SigningRefusedError);
  if (message) expect(fn).toThrow(message);
}

describe("verifyIntent — accepted", () => {
  it("createCircle: decodes the factory call and matches the form", () => {
    const v = verifyIntent(intent("createCircle", chain.factory, data.createCircle), input({ kind: "createCircle", create: createForm }));
    expect(v.headline).toBe("สร้างวงแชร์ประมูลดอกตาม (Float)");
    expect(v.details).toEqual(
      expect.arrayContaining([
        { label: "เงินต่องวด", value: "1,000 บาท" },
        { label: "จำนวนมือ", value: "5 มือ" },
        { label: "ความถี่", value: "ทุกเดือน" },
        { label: "นายวงรับงวดแรก", value: "ใช่" },
      ]),
    );
    expect(v.serverSummary).toBe("ข้อความจากเซิร์ฟเวอร์");
  });

  it("join: shows the circle and seat", () => {
    const v = verifyIntent(intent("join", CIRCLE, data.join), input({ kind: "join", circle: CIRCLE, seat: 2 }));
    expect(v.headline).toBe("เข้าร่วมวง วงออฟฟิศ");
    expect(v.details).toContainEqual({ label: "ที่นั่ง", value: "ที่นั่งที่ 3" });
  });

  it("confirmReceipt: names the payer", () => {
    const v = verifyIntent(
      intent("confirmReceipt", CIRCLE, data.confirmReceipt),
      input({ kind: "confirmReceipt", circle: CIRCLE, payer: PAYER }),
    );
    expect(v.headline).toBe("ยืนยันว่าได้รับเงินจาก สมหญิง");
  });

  it("rejectPayment: names the payer (short address when unknown)", () => {
    const v = verifyIntent(
      intent("rejectPayment", CIRCLE, data.rejectPayment),
      input({ kind: "rejectPayment", circle: CIRCLE, payer: PAYER }, { display: {} }),
    );
    expect(v.headline).toMatch(/^แจ้งว่ายังไม่ได้รับเงินจาก 0x0000…00a1$/i);
  });

  it("commitBid: sealed bid with the local amount", () => {
    const v = verifyIntent(
      intent("commitBid", CIRCLE, data.commitBid),
      input({ kind: "commitBid", circle: CIRCLE, bidHash: "0x" + "AB".repeat(32) }, { display: { bidAmount: "5000" } }),
    );
    expect(v.headline).toBe("ยื่นซองประมูลปิด");
    expect(v.details).toContainEqual({ label: "ยอดที่เสนอ", value: "50 บาท" });
  });

  it("accepts checksummed vs lowercase addresses", () => {
    const i = intent("confirmReceipt", CIRCLE.toUpperCase().replace("0X", "0x"), data.confirmReceipt, {
      verifyingContract: chain.forwarder.toLowerCase(),
    });
    expect(() => verifyIntent(i, input({ kind: "confirmReceipt", circle: CIRCLE, payer: PAYER }))).not.toThrow();
  });
});

describe("verifyIntent — refused", () => {
  const confirmExpect: IntentExpectation = { kind: "confirmReceipt", circle: CIRCLE, payer: PAYER };

  it("tampered `to` (another circle)", () => {
    refused(() => verifyIntent(intent("confirmReceipt", OTHER_CIRCLE, data.confirmReceipt), input(confirmExpect)), /ปลายทาง/);
  });

  it("createCircle not sent to the factory", () => {
    refused(() => verifyIntent(intent("createCircle", CIRCLE, data.createCircle), input({ kind: "createCircle", create: createForm })));
  });

  it("circle call sent to the factory", () => {
    refused(() => verifyIntent(intent("confirmReceipt", chain.factory, data.confirmReceipt), input(confirmExpect)));
  });

  it("unknown selector", () => {
    refused(() => verifyIntent(intent("confirmReceipt", CIRCLE, "0xdeadbeef00"), input(confirmExpect)), /ไม่รู้จัก/);
  });

  it("known but disallowed function (markDefault)", () => {
    refused(() => verifyIntent(intent("confirmReceipt", CIRCLE, data.markDefault), input(confirmExpect)));
  });

  it("wrong chain id", () => {
    refused(() => verifyIntent(intent("confirmReceipt", CIRCLE, data.confirmReceipt, { chainId: 1 }), input(confirmExpect)), /เครือข่าย/);
  });

  it("wrong forwarder", () => {
    refused(() =>
      verifyIntent(intent("confirmReceipt", CIRCLE, data.confirmReceipt, { verifyingContract: OTHER_CIRCLE }), input(confirmExpect)),
    );
  });

  it("wrong domain name or version", () => {
    refused(() => verifyIntent(intent("confirmReceipt", CIRCLE, data.confirmReceipt, { name: "Evil" }), input(confirmExpect)));
    refused(() => verifyIntent(intent("confirmReceipt", CIRCLE, data.confirmReceipt, { version: "2" }), input(confirmExpect)));
  });

  it("server kind does not match the decoded function", () => {
    refused(() => verifyIntent(intent("confirmReceipt", CIRCLE, data.rejectPayment), input(confirmExpect)));
  });

  it("server kind does not match what the user tapped", () => {
    refused(() =>
      verifyIntent(intent("rejectPayment", CIRCLE, data.rejectPayment), input(confirmExpect)),
      /ไม่ตรงกับที่คุณกด/,
    );
  });

  it("`from` is not the local key", () => {
    refused(() => verifyIntent(intent("confirmReceipt", CIRCLE, data.confirmReceipt), input(confirmExpect, { localAddress: PAYER })), /กุญแจ/);
  });

  it("different payer than the one tapped", () => {
    refused(() =>
      verifyIntent(intent("confirmReceipt", CIRCLE, data.confirmReceipt), input({ ...confirmExpect, payer: OTHER_CIRCLE })),
    );
  });

  it("createCircle with different rules than the form", () => {
    refused(
      () =>
        verifyIntent(
          intent("createCircle", chain.factory, data.createCircle),
          input({ kind: "createCircle", create: { ...createForm, principal: "10000" } }),
        ),
      /กติกา/,
    );
  });

  it("join with another seat or an attestation for another circle", () => {
    refused(() => verifyIntent(intent("join", CIRCLE, data.join), input({ kind: "join", circle: CIRCLE, seat: 0 })));
    const joinOther = encodeFunctionData({ abi: circleAbi, functionName: "join", args: [2, att(OTHER_CIRCLE), SIG] });
    refused(() => verifyIntent(intent("join", CIRCLE, joinOther), input({ kind: "join", circle: CIRCLE, seat: 2 })));
  });

  it("dispute with another reason", () => {
    refused(() =>
      verifyIntent(intent("dispute", CIRCLE, data.dispute), input({ kind: "dispute", circle: CIRCLE, dispute: { round: 1, reason: "อื่น" } })),
    );
  });

  it("non-zero value", () => {
    const i = intent("confirmReceipt", CIRCLE, data.confirmReceipt);
    i.typedData.message.value = "1";
    refused(() => verifyIntent(i, input(confirmExpect)));
  });

  it("missing circle address for a circle action", () => {
    refused(() => verifyIntent(intent("confirmReceipt", CIRCLE, data.confirmReceipt), input({ ...confirmExpect, circle: null })));
  });
});
