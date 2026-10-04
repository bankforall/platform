import { circleAbi, circleFactoryAbi, forwarderAbi } from "@bankforall/shared";
import { BaseError, ContractFunctionRevertedError, decodeErrorResult, type Hex } from "viem";

const abi = [...circleAbi, ...circleFactoryAbi, ...forwarderAbi];

/** Thai messages for contract errors users can actually hit. */
const messages: Record<string, string> = {
  WrongStatus: "สถานะของวงไม่รองรับรายการนี้",
  NotHost: "เฉพาะนายวงเท่านั้น",
  NotMember: "คุณไม่ได้เป็นสมาชิกของวงนี้",
  Paused: "ระบบปิดปรับปรุงชั่วคราว",
  CircleFull: "วงเต็มแล้ว",
  AlreadyMember: "คุณเป็นสมาชิกวงนี้อยู่แล้ว",
  ReputationTooLow: "คะแนนความน่าเชื่อถือยังไม่ถึงเกณฑ์ของวงนี้",
  SeatTaken: "ที่นั่งนี้มีคนจองแล้ว",
  InvalidSeat: "ที่นั่งไม่ถูกต้อง",
  NotReady: "ยังไม่พร้อม (สมาชิกยังไม่ครบหรือยังชำระไม่ครบ)",
  NotEligible: "คุณไม่มีสิทธิ์ประมูลในรอบนี้",
  OutsideWindow: "ไม่อยู่ในช่วงเวลาที่ทำรายการได้",
  AlreadyCommitted: "คุณยื่นซองประมูลรอบนี้แล้ว",
  BadReveal: "ข้อมูลเปิดซองไม่ตรงกับซองที่ยื่นไว้",
  BidTooHigh: "จำนวนที่เสนอเกินเพดาน",
  AlreadyDecided: "รอบนี้ตัดสินผู้รับแล้ว",
  NotDecided: "ยังไม่ได้ตัดสินผู้รับของรอบนี้",
  NotRecipient: "เฉพาะผู้รับเงินรอบนี้เท่านั้น",
  IsRecipient: "ผู้รับเงินไม่ต้องจ่ายในรอบของตัวเอง",
  BadPaymentStatus: "สถานะการชำระไม่รองรับรายการนี้",
  TooEarly: "ยังไม่ถึงเวลา",
  NotTrusted:
    "ต้องมีคะแนนความน่าเชื่อถืออย่างน้อย 110 จึงจะรับเงินช่วงครึ่งแรกของวงหรือรับมือนายวงได้ (สร้างประวัติการจ่ายดีก่อน)",
  InvalidAttestation: "การยืนยันตัวตนหมดอายุหรือไม่ถูกต้อง กรุณาลองใหม่",
  InvalidParams: "ค่าตั้งวงไม่ถูกต้อง",
  OverLegalCap: "เกินเพดานตามกฎหมาย (จำนวนสมาชิก มูลค่าวง หรือจำนวนวงที่เป็นนายวง)",
  ERC2771ForwarderExpiredRequest: "คำขอหมดอายุ กรุณาลองใหม่",
  ERC2771ForwarderInvalidSigner: "ลายเซ็นไม่ถูกต้อง",
  InvalidAccountNonce: "คำขอนี้ถูกใช้ไปแล้ว กรุณาลองใหม่",
};

export function contractErrorName(err: unknown): string | null {
  if (err instanceof BaseError) {
    const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      if (reverted.data?.errorName) return reverted.data.errorName;
      if (reverted.raw) return decodeRaw(reverted.raw);
    }
    const withData = err.walk((e) => typeof (e as { data?: unknown }).data === "string") as { data?: Hex } | null;
    if (withData?.data) return decodeRaw(withData.data);
  }
  return null;
}

function decodeRaw(data: Hex): string | null {
  try {
    return decodeErrorResult({ abi, data }).errorName;
  } catch {
    return null;
  }
}

export function contractErrorMessage(err: unknown): string {
  const name = contractErrorName(err);
  if (name) return messages[name] ?? name;
  return "บันทึกรายการไม่สำเร็จ กรุณาลองใหม่";
}
