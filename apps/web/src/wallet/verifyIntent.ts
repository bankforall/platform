import { decodeFunctionData, getAddress, isAddressEqual, keccak256, toBytes, type Address, type Hex } from "viem";
import {
  FORWARDER_NAME,
  CircleType,
  circleAbi,
  circleFactoryAbi,
  circleTypeLabel,
  type IntentKind,
  type PreparedIntent,
} from "@bankforall/shared";
import { baht, duration, percent, periodLabel, shortAddress } from "@/lib/format";
import type { TrustedChain } from "./chain";

/**
 * Independent check of what a prepared intent asks the device key to sign. The server's `summary`
 * is never trusted: the forward request is decoded locally, checked against what the user tapped,
 * and the confirmation sheet is rendered from the decoded call.
 */

/** Raised when the app refuses to sign; the message is shown to the user as-is. */
export class SigningRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SigningRefusedError";
  }
}

/** Parameters of a circle as entered in the create wizard. */
export interface ExpectedCircleParams {
  type: number;
  principal: string | bigint;
  maxMembers: number;
  hostTakesFirst: boolean;
  fixRateBps: number;
  minReputation: number;
  period: number;
  bidWindow: number;
  revealWindow: number;
  paymentWindow: number;
  grace: number;
  hostSeat: number;
}

/** What the screen asked for; every field present is enforced. */
export interface IntentExpectation {
  kind: IntentKind;
  /** Address of the circle the user is acting on (required for every kind except createCircle). */
  circle?: string | null;
  /** confirmReceipt / rejectPayment */
  payer?: string;
  /** join */
  seat?: number;
  /** commitBid: the hash computed on this device */
  bidHash?: string;
  /** dispute */
  dispute?: { round: number; reason: string };
  /** createCircle: the form values */
  create?: ExpectedCircleParams;
}

/** Extra data used only to describe the decoded call (never to decide what is signed). */
export interface IntentDisplay {
  circleName?: string;
  members?: readonly { address: string; displayName: string }[];
  /** Fix circles: show the seat number on join. */
  fixSeats?: boolean;
  /** declarePayment: amount due, satang */
  amount?: string | null;
  /** commitBid: the bid kept on this device, satang */
  bidAmount?: string;
}

export interface VerifiedIntent {
  kind: IntentKind;
  /** One-line Thai description of the decoded call. */
  headline: string;
  details: { label: string; value: string }[];
  /** Server summary, shown only as secondary text. */
  serverSummary: string;
}

export interface VerifyInput {
  chain: TrustedChain;
  /** Address of the key stored on this device. */
  localAddress: string;
  expect: IntentExpectation;
  display?: IntentDisplay;
}

const CIRCLE_FUNCTIONS = new Set<IntentKind>([
  "join",
  "start",
  "cancel",
  "commitBid",
  "declarePayment",
  "confirmReceipt",
  "rejectPayment",
  "dispute",
]);

const refuse = (why: string): never => {
  throw new SigningRefusedError(`ระบบไม่ลงนามรายการนี้เพื่อความปลอดภัย: ${why}`);
};

function same(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  try {
    return isAddressEqual(getAddress(a), getAddress(b));
  } catch {
    return false;
  }
}

function nameFor(address: string, display: IntentDisplay | undefined): string {
  return display?.members?.find((m) => same(m.address, address))?.displayName ?? shortAddress(address);
}

interface Attestation {
  subject: Address;
  circle: Address;
}

export function verifyIntent(intent: PreparedIntent, input: VerifyInput): VerifiedIntent {
  const { chain, localAddress, expect, display } = input;
  const { domain, message } = intent.typedData;

  // 1. Who signs, on which chain, for which forwarder.
  if (domain.name !== FORWARDER_NAME || domain.version !== "1") refuse("รูปแบบรายการไม่ถูกต้อง");
  if (domain.chainId !== chain.chainId) refuse("รายการนี้เป็นของเครือข่ายอื่น");
  if (!same(domain.verifyingContract, chain.forwarder)) refuse("ผู้รับรองรายการไม่ใช่ระบบของแอปนี้");
  if (!same(message.from, localAddress)) refuse("รายการนี้ไม่ใช่ของกุญแจบนเครื่องนี้");
  if (message.value !== "0") refuse("รายการนี้มีการโอนเงินดิจิทัลแนบมา");

  // 2. What the user tapped.
  if (intent.kind !== expect.kind) refuse("ประเภทรายการไม่ตรงกับที่คุณกด");

  // 3. Decode the call independently of the server.
  const toFactory = same(message.to, chain.factory);
  let functionName: string;
  let args: readonly unknown[];
  try {
    const decoded = toFactory
      ? decodeFunctionData({ abi: circleFactoryAbi, data: message.data as Hex })
      : decodeFunctionData({ abi: circleAbi, data: message.data as Hex });
    functionName = decoded.functionName;
    args = (decoded.args ?? []) as readonly unknown[];
  } catch {
    return refuse("ไม่รู้จักรายการนี้");
  }

  if (functionName !== intent.kind) refuse("ประเภทรายการไม่ตรงกับคำสั่งที่จะลงนาม");

  if (functionName === "createCircle") {
    if (!toFactory) refuse("ปลายทางไม่ใช่ระบบสร้างวง");
  } else {
    if (toFactory || !CIRCLE_FUNCTIONS.has(functionName as IntentKind)) refuse("ไม่รู้จักรายการนี้");
    if (!expect.circle) refuse("วงนี้ยังไม่พร้อมทำรายการ");
    if (!same(message.to, expect.circle)) refuse("ปลายทางไม่ใช่วงที่คุณกำลังทำรายการ");
  }

  const kind = functionName as IntentKind;
  const details: VerifiedIntent["details"] = [];
  if (display?.circleName && kind !== "createCircle") details.push({ label: "วง", value: display.circleName });
  let headline: string;

  switch (kind) {
    case "createCircle": {
      const [p, hostSeat, att] = args as [
        {
          circleType: number;
          hostTakesFirst: boolean;
          maxMembers: number;
          fixRateBps: number;
          minReputation: number;
          principal: bigint;
          period: bigint;
          bidWindow: bigint;
          revealWindow: bigint;
          paymentWindow: bigint;
          grace: bigint;
        },
        number,
        Attestation,
      ];
      if (!same(att.subject, localAddress)) refuse("ใบรับรองสมาชิกไม่ใช่ของคุณ");
      const want = expect.create;
      if (want) {
        const mismatch =
          p.circleType !== want.type ||
          p.hostTakesFirst !== want.hostTakesFirst ||
          p.maxMembers !== want.maxMembers ||
          p.fixRateBps !== want.fixRateBps ||
          p.minReputation !== want.minReputation ||
          p.principal !== BigInt(want.principal) ||
          p.period !== BigInt(want.period) ||
          p.bidWindow !== BigInt(want.bidWindow) ||
          p.revealWindow !== BigInt(want.revealWindow) ||
          p.paymentWindow !== BigInt(want.paymentWindow) ||
          p.grace !== BigInt(want.grace) ||
          hostSeat !== want.hostSeat;
        if (mismatch) refuse("กติกาวงไม่ตรงกับที่คุณกรอก");
      }
      const isFix = p.circleType === CircleType.Fix;
      headline = `สร้างวงแชร์${circleTypeLabel[p.circleType as CircleType] ?? ""}`;
      details.push(
        { label: "เงินต่องวด", value: `${baht(p.principal)} บาท` },
        { label: "จำนวนมือ", value: `${p.maxMembers} มือ` },
        { label: "ความถี่", value: periodLabel(Number(p.period)) },
        { label: "ผ่อนผันหลังกำหนดชำระ", value: duration(Number(p.grace)) },
      );
      if (isFix) {
        details.push({ label: "ที่นั่งของคุณ", value: `ที่นั่งที่ ${hostSeat + 1}` });
        details.push({ label: "ส่วนต่างที่นั่งแรก/ท้าย", value: `±${percent(p.fixRateBps)}` });
      } else {
        details.push({ label: "นายวงรับงวดแรก", value: p.hostTakesFirst ? "ใช่" : "ไม่ใช่" });
      }
      if (p.minReputation > 0) details.push({ label: "คะแนนขั้นต่ำของสมาชิก", value: String(p.minReputation) });
      break;
    }
    case "join": {
      const [seat, att] = args as [number, Attestation];
      if (!same(att.subject, localAddress) || !same(att.circle, message.to)) refuse("ใบรับรองสมาชิกไม่ตรงกับวงนี้");
      if (expect.seat !== undefined && seat !== expect.seat) refuse("ที่นั่งไม่ตรงกับที่คุณเลือก");
      headline = display?.circleName ? `เข้าร่วมวง ${display.circleName}` : "เข้าร่วมวงแชร์";
      if (display?.fixSeats) details.push({ label: "ที่นั่ง", value: `ที่นั่งที่ ${seat + 1}` });
      break;
    }
    case "start":
      headline = "เริ่มวง — เปิดงวดที่ 1";
      break;
    case "cancel":
      headline = "ยกเลิกวงแชร์นี้ (ทำย้อนกลับไม่ได้)";
      break;
    case "commitBid": {
      const [hash] = args as [Hex];
      if (expect.bidHash !== undefined && hash.toLowerCase() !== expect.bidHash.toLowerCase()) {
        refuse("ซองประมูลไม่ตรงกับยอดที่คุณกรอก");
      }
      headline = "ยื่นซองประมูลปิด";
      if (display?.bidAmount) details.push({ label: "ยอดที่เสนอ", value: `${baht(display.bidAmount)} บาท` });
      details.push({ label: "การมองเห็น", value: "ไม่มีใครเห็นยอดจนถึงเวลาเปิดซอง" });
      break;
    }
    case "declarePayment":
      headline = "แจ้งว่าโอนเงินงวดนี้แล้ว พร้อมสลิป";
      if (display?.amount) details.push({ label: "ยอดที่โอน", value: `${baht(display.amount)} บาท` });
      break;
    case "confirmReceipt":
    case "rejectPayment": {
      const [payer] = args as [Address];
      if (expect.payer !== undefined && !same(payer, expect.payer)) refuse("ผู้โอนไม่ตรงกับรายการที่คุณเลือก");
      const who = nameFor(payer, display);
      headline = kind === "confirmReceipt" ? `ยืนยันว่าได้รับเงินจาก ${who}` : `แจ้งว่ายังไม่ได้รับเงินจาก ${who}`;
      break;
    }
    case "dispute": {
      const [round, reasonHash] = args as [number, Hex];
      if (expect.dispute) {
        if (round !== expect.dispute.round) refuse("งวดที่แจ้งปัญหาไม่ตรงกับที่คุณเลือก");
        if (reasonHash.toLowerCase() !== keccak256(toBytes(expect.dispute.reason)).toLowerCase()) {
          refuse("รายละเอียดปัญหาไม่ตรงกับที่คุณพิมพ์");
        }
      }
      headline = `แจ้งปัญหางวดที่ ${round}`;
      break;
    }
    default:
      return refuse("ไม่รู้จักรายการนี้");
  }

  return { kind, headline, details, serverSummary: intent.summary };
}
