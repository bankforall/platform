import { z } from "zod";
import { CircleType } from "./circle-math.js";

/**
 * Default legal caps under the Chit Fund Act B.E. 2534 (พ.ร.บ.การเล่นแชร์ พ.ศ. 2534).
 * NOT legally verified — confirm with counsel before launch. The on-chain values live in
 * CircleFactory and can be changed by the admin; keep both in sync.
 */
export const LEGAL_CAPS = {
  maxMembers: 30,
  /** principal × maxMembers, in satang (300,000 baht). */
  maxPoolValue: 300_000n * 100n,
  maxActiveCirclesPerHost: 3,
} as const;

const HOUR = 3600;
const DAY = 24 * HOUR;

const satang = z.coerce.bigint().positive();

/** Payload for creating a circle; shared by the API (validation) and the web wizard (form). */
export const createCircleSchema = z
  .object({
    name: z.string().trim().min(3).max(60),
    type: z.nativeEnum(CircleType),
    principal: satang,
    maxMembers: z.number().int().min(2).max(LEGAL_CAPS.maxMembers),
    hostTakesFirst: z.boolean().default(true),
    /** Fix only: ±rate ladder across seats, in basis points (max ±50%). */
    fixRateBps: z.number().int().min(0).max(5000).default(0),
    minReputation: z.number().int().min(0).max(1000).default(0),
    period: z.number().int().min(DAY).max(366 * DAY),
    bidWindow: z.number().int().min(HOUR),
    revealWindow: z.number().int().min(HOUR),
    paymentWindow: z.number().int().min(HOUR),
    grace: z.number().int().min(0).max(14 * DAY),
    private: z.boolean().default(true),
  })
  .refine((c) => c.principal * BigInt(c.maxMembers) <= LEGAL_CAPS.maxPoolValue, {
    message: "มูลค่าทุนของวงเกินเพดานตามกฎหมาย",
    path: ["principal"],
  })
  .refine((c) => c.bidWindow + c.revealWindow + c.paymentWindow + c.grace <= c.period, {
    message: "ช่วงประมูล + เปิดซอง + ชำระ + ผ่อนผัน ต้องไม่เกินระยะเวลาต่องวด",
    path: ["period"],
  });

export type CreateCircleInput = z.infer<typeof createCircleSchema>;
