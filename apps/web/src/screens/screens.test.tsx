import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, fireEvent, within } from "@testing-library/react";
import { verifyMessage } from "viem";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  circleDetail,
  circleSummary,
  keyRotationMessage,
  meResponse,
  walletProofMessage,
  type CircleDetail,
  type MeResponse,
} from "@bankforall/shared";
import { ToastProvider } from "@/components/overlay";
import { IntentProvider } from "@/hooks/useIntent";
import { clearDevice, localAddress, newPrivateKey, pendingBackup, storeLocalKey } from "@/wallet/device";
import App from "@/App";

// WebAuthn needs a real authenticator: the browser ceremonies are mocked, the API calls around them are not
const webauthn = vi.hoisted(() => ({
  startRegistration: vi.fn(async () => ({ id: "cred-new", rawId: "cred-new", type: "public-key", response: {} })),
  startAuthentication: vi.fn(async () => ({ id: "cred-1", rawId: "cred-1", type: "public-key", response: {} })),
}));
vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: () => true,
  startRegistration: webauthn.startRegistration,
  startAuthentication: webauthn.startAuthentication,
}));

const securityView = (over: Record<string, unknown> = {}) => ({
  required: true,
  passkeys: [{ id: "pk1", name: "มือถือ", createdAt: new Date().toISOString(), lastUsedAt: null }],
  stepUpExpiresAt: null,
  enrolment: "step-up",
  ...over,
});
const apiError = (status: number, code: string, message: string) =>
  Promise.resolve(new Response(JSON.stringify({ error: { code, message } }), { status }));
const kycItem = () => ({
  id: "k1",
  userId: "u9",
  displayName: "ใหม่",
  fullName: "นาย ใหม่ ทดสอบ",
  nationalIdLast4: "1234",
  status: "PENDING",
  createdAt: new Date().toISOString(),
});

const now = Math.floor(Date.now() / 1000);
let ME: `0x${string}`;
const A1 = "0x00000000000000000000000000000000000000a1";
const A2 = "0x00000000000000000000000000000000000000a2";

/** Per-test tweaks of the fixtures. */
let meOverrides: Partial<MeResponse> = {};
let recipientIsMe = false;
/** Mutates the raw circle fixture before it is validated. */
let tweakCircle: (c: Record<string, any>) => void = () => {};
let extraRoutes: (path: string, init?: RequestInit) => Promise<Response> | null = () => null;

function me(): MeResponse {
  return meResponse.parse({
    ...meDefaults(),
    ...meOverrides,
  });
}

function meDefaults() {
  return {
    id: "u1",
    displayName: "สมชาย",
    pictureUrl: null,
    role: "ADMIN",
    phone: "0812345678",
    phoneVerified: true,
    promptPayId: "0812345678",
    consentVersion: "2026-10-01",
    walletAddress: ME,
    hasWalletBackup: true,
    kycStatus: "APPROVED",
    kycReason: null,
    reputation: 120,
    onboarding: [],
    outstandingDefaults: 0,
    pendingKeyRotation: null,
  };
}

function circle(): CircleDetail {
  const members = [ME, A1, A2].map((address, i) => ({
    address,
    userId: `u${i + 1}`,
    displayName: ["สมชาย", "สมหญิง", "มานี"][i]!,
    pictureUrl: null,
    index: i,
    seat: i,
    reputation: 100,
    hasWon: i === 0,
    wonRound: i === 0 ? 1 : null,
    wonBid: "0",
    defaulted: false,
    trusted: false,
  }));
  const raw: Record<string, any> = {
    id: "c1",
    name: "วงออฟฟิศ",
    address: "0x00000000000000000000000000000000000000c1",
    status: "ACTIVE",
    type: 1,
    principal: "100000",
    maxMembers: 3,
    memberCount: 3,
    fixRateBps: 0,
    period: 30 * 86400,
    isPrivate: true,
    currentRound: 2,
    host: { id: "u1", displayName: "สมชาย" },
    takenSeats: [0, 1, 2],
    maxBid: "1232",
    trustedReputation: 110,
    openUntil: null,
    me: { isHost: true, seat: 0, hasWon: true, defaulted: false, dueNow: { amount: "100000", to: "สมหญิง", deadline: now + 86400, status: "NONE" } },
    description: null,
    inviteCode: "KnFsGdeT",
    hostTakesFirst: true,
    minReputation: 0,
    bidWindow: 86400,
    revealWindow: 86400,
    paymentWindow: 3 * 86400,
    grace: 86400,
    members,
    explorerUrl: null,
    rounds: [
      {
        number: 1,
        startedAt: now - 40 * 86400,
        bidding: false,
        biddingEnds: null,
        revealEnds: null,
        decided: true,
        recipient: ME,
        recipientName: "สมชาย",
        winningBid: "0",
        paymentDeadline: now - 37 * 86400,
        defaultAfter: now - 36 * 86400,
        acceptAfter: now - 35 * 86400,
        payments: [
          { payer: A1, payerName: "สมหญิง", amount: "100000", status: "CONFIRMED", slipId: "s1", slipVerify: "VERIFIED", txHash: "0xab" },
          { payer: A2, payerName: "มานี", amount: "100000", status: "CONFIRMED", slipId: null, slipVerify: null, txHash: "0xcd" },
        ],
        committed: [],
        revealed: [],
      },
      {
        number: 2,
        startedAt: now - 3 * 86400,
        bidding: true,
        biddingEnds: now - 2 * 86400,
        revealEnds: now - 86400,
        decided: true,
        recipient: recipientIsMe ? ME : A1,
        recipientName: recipientIsMe ? "สมชาย" : "สมหญิง",
        winningBid: "5000",
        paymentDeadline: now + 2 * 86400,
        defaultAfter: now + 3 * 86400,
        acceptAfter: now + 4 * 86400,
        payments: [
          recipientIsMe
            ? { payer: A1, payerName: "สมหญิง", amount: "100000", status: "ATTESTED", slipId: "s1", slipVerify: "VERIFIED", txHash: "0x01" }
            : { payer: ME, payerName: "สมชาย", amount: "100000", status: "NONE", slipId: null, slipVerify: null, txHash: null },
          { payer: A2, payerName: "มานี", amount: "100000", status: "DECLARED", slipId: "s2", slipVerify: "PENDING", txHash: "0xef" },
        ],
        committed: [A1, A2],
        revealed: [
          { member: A1, amount: "5000" },
          { member: A2, amount: "3000" },
        ],
      },
    ],
  };
  // every payment fixture without an explicit set-off has none
  for (const round of raw.rounds) for (const p of round.payments) p.offset ??= "0";
  tweakCircle(raw);
  return circleDetail.parse(raw);
}

/** Round 2 of a 5-member circle, still taking sealed bids; I have not received the pool yet. */
function openBidding(c: Record<string, any>, opts: { meTrusted: boolean; otherTrusted: boolean }) {
  c.maxMembers = 5;
  c.members[0] = { ...c.members[0], hasWon: false, wonRound: null, trusted: opts.meTrusted, reputation: opts.meTrusted ? 120 : 100 };
  c.members[1] = { ...c.members[1], hasWon: true, wonRound: 1 };
  c.members[2] = { ...c.members[2], trusted: opts.otherTrusted, reputation: opts.otherTrusted ? 120 : 100 };
  c.me = { ...c.me, hasWon: false, dueNow: null };
  Object.assign(c.rounds[1], {
    biddingEnds: now + 86400,
    revealEnds: now + 2 * 86400,
    decided: false,
    recipient: null,
    recipientName: null,
    winningBid: "0",
    paymentDeadline: null,
    defaultAfter: null,
    acceptAfter: null,
    payments: [],
    committed: [],
    revealed: [],
  });
}

/** Sets my payment in round 2 (recipient สมหญิง). */
function myPayment(c: Record<string, any>, fields: Record<string, unknown>) {
  Object.assign(c.rounds[1].payments[0], fields);
}

function json(data: unknown) {
  return Promise.resolve(new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } }));
}

function routes(url: string, init?: RequestInit): Promise<Response> {
  const path = url.replace(/^\/api/, "").split("?")[0]!;
  const extra = extraRoutes(path, init);
  if (extra) return extra;
  if (path === "/config")
    return json({ chainId: 84532, forwarder: "0x00000000000000000000000000000000000000f0", factory: "0x00000000000000000000000000000000000000fa", explorerUrl: "https://sepolia.basescan.org", lineLoginEnabled: true, devLoginEnabled: true });
  if (path === "/me") return json(me());
  if (path === "/me/notifications") return json([{ id: "n1", kind: "due", title: "ถึงกำหนดจ่าย", body: "จ่าย 1,000 บาท", circleId: "c1", createdAt: new Date().toISOString(), readAt: null }]);
  if (path === "/circles" || path === "/circles/discover") return json([circleSummary.parse(circle())]);
  if (path === "/circles/c1") return json(circle());
  if (path === "/circles/c1/promptpay")
    return json({ payload: "00020101021229370016A000000677010111011300668123456785802TH530376463045D82", amount: "100000", recipientName: "สมหญิง", promptPayMasked: "081-xxx-5678" });
  if (path.startsWith("/admin/kyc")) return json([]);
  if (path.startsWith("/admin/key-rotations")) return json([]);
  if (path === "/admin/security") return json(securityView());
  return Promise.resolve(new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "ไม่พบ" } }), { status: 404 }));
}

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <ToastProvider>
          <IntentProvider>
            <App />
          </IntentProvider>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("screens render with contract-valid data", () => {
  const errors: unknown[] = [];
  beforeEach(async () => {
    await clearDevice();
    ME = await storeLocalKey(newPrivateKey());
    meOverrides = {};
    recipientIsMe = false;
    tweakCircle = () => {};
    extraRoutes = () => null;
    webauthn.startRegistration.mockClear();
    webauthn.startAuthentication.mockClear();
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => routes(url, init)));
    vi.spyOn(console, "error").mockImplementation((...args) => errors.push(["error", ...args]));
    vi.spyOn(console, "warn").mockImplementation((...args) => errors.push(["warn", ...args]));
    HTMLCanvasElement.prototype.getContext = vi.fn() as never;
    errors.length = 0;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("home shows the next due payment", async () => {
    renderAt("/");
    expect(await screen.findByText(/ถัดไป:/)).toBeInTheDocument();
    expect(screen.getAllByText("วงออฟฟิศ").length).toBeGreaterThan(0);
  });

  it.each(["members", "pool", "bidding", "payment", "history"])("circle detail tab %s", async (tab) => {
    renderAt(`/circles/c1?tab=${tab}`);
    expect(await screen.findByRole("tabpanel")).toBeInTheDocument();
  });

  it("payment tab shows PromptPay amount for the payer", async () => {
    renderAt("/circles/c1?tab=payment");
    expect(await screen.findByText("ยอดที่ต้องโอนงวดนี้")).toBeInTheDocument();
    expect(screen.getByText("โอนแล้ว — อัปโหลดสลิป")).toBeInTheDocument();
  });

  it("create circle shows a payment preview and seat ladder for Fix", async () => {
    renderAt("/circles/new");
    expect(await screen.findByText("ตัวอย่างตารางรับ-จ่าย")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/เลือกที่นั่ง \(Fix\)/));
    // the default ±1% ladder stays within 15% a year for a monthly circle
    expect(await screen.findByText(/1\. 1,010 บาท/)).toBeInTheDocument();
    expect(screen.getByText(/ตั้งได้สูงสุด ±1\.23%/)).toBeInTheDocument();
  });

  it("create circle shows the bid cap for bidding circles", async () => {
    renderAt("/circles/new");
    expect(await screen.findByTestId("bid-cap")).toHaveTextContent("ดอกที่เสนอได้สูงสุด 12.32 บาท/งวด (เพดาน 15% ต่อปี)");
    fireEvent.change(screen.getByLabelText("เงินต่องวด"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "รายวัน" }));
    expect(await screen.findByText("เงินต้นหรือระยะงวดน้อยเกินไปสำหรับวงประมูล")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "สร้างวง" })).toBeDisabled();
  });

  it("host-first is disabled for a host below the trusted reputation", async () => {
    meOverrides = { reputation: 100 };
    renderAt("/circles/new");
    const box = await screen.findByLabelText(/มือนายวง/);
    expect(box).toBeDisabled();
    expect(box).not.toBeChecked();
    expect(screen.getByText(/ใช้ได้เฉพาะนายวงที่น่าเชื่อถือ \(คะแนน 110 ขึ้นไป ตอนนี้คุณมี 100\)/)).toBeInTheDocument();
  });

  it("host-first stays available for a trusted host", async () => {
    renderAt("/circles/new");
    const box = await screen.findByLabelText(/มือนายวง/);
    expect(box).toBeEnabled();
    expect(box).toBeChecked();
  });

  it("payment tab: partial set-off shows what is left to transfer", async () => {
    tweakCircle = (c) => myPayment(c, { amount: "60000", offset: "40000" });
    renderAt("/circles/c1?tab=payment");
    expect(await screen.findByTestId("set-off")).toHaveTextContent("หักกลบหนี้ที่ สมหญิง ค้างคุณ 400 บาท — โอนเพิ่ม 600 บาท");
    expect(await screen.findByText("ยอดที่ต้องโอนงวดนี้")).toBeInTheDocument();
  });

  it("payment tab: full set-off needs no transfer", async () => {
    tweakCircle = (c) => myPayment(c, { amount: "0", offset: "100000", status: "CONFIRMED", txHash: "0x02" });
    renderAt("/circles/c1?tab=payment");
    expect(await screen.findByTestId("set-off")).toHaveTextContent("ไม่ต้องโอน — หักกลบครบแล้ว ✓");
    expect(screen.getByTestId("set-off")).toHaveTextContent("หักกลบหนี้ที่ สมหญิง ค้างคุณ 1,000 บาท");
    expect(screen.queryByText("ยอดที่ต้องโอนงวดนี้")).not.toBeInTheDocument();
    expect(screen.queryByText("โอนแล้ว — อัปโหลดสลิป")).not.toBeInTheDocument();
  });

  it("recipient sees the set-off per payer", async () => {
    recipientIsMe = true;
    tweakCircle = (c) => Object.assign(c.rounds[1].payments[1], { amount: "70000", offset: "30000" });
    renderAt("/circles/c1?tab=payment");
    const row = (await screen.findByText("มานี")).closest("li")!;
    expect(row).toHaveTextContent("หักกลบหนี้ที่คุณค้าง 300 บาท");
  });

  it("bidding: a newcomer is told their bid cannot win an early round", async () => {
    tweakCircle = (c) => openBidding(c, { meTrusted: false, otherTrusted: true });
    renderAt("/circles/c1?tab=bidding");
    expect(await screen.findByText(/ซองของคุณจะไม่ชนะงวดนี้/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ยื่นซอง" })).toBeInTheDocument();
    expect(screen.getByText("สมาชิกที่น่าเชื่อถือ")).toBeInTheDocument();
  });

  it("bidding: no early-round notice when no trusted member can still receive", async () => {
    tweakCircle = (c) => openBidding(c, { meTrusted: false, otherTrusted: false });
    renderAt("/circles/c1?tab=bidding");
    expect(await screen.findByRole("button", { name: "ยื่นซอง" })).toBeInTheDocument();
    expect(screen.queryByText(/ซองของคุณจะไม่ชนะงวดนี้/)).not.toBeInTheDocument();
  });

  it("bidding: the keypad refuses a bid above the interest cap", async () => {
    tweakCircle = (c) => openBidding(c, { meTrusted: true, otherTrusted: false });
    renderAt("/circles/c1?tab=bidding");
    const input = await screen.findByLabelText("ดอกต่องวด (บาท)");
    expect(screen.getByText("เสนอได้สูงสุด 12.32 บาท/งวด (เพดาน 15% ต่อปี)")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "12.33" } });
    expect(input).toHaveValue("");
    expect(screen.getByText("เกินเพดาน — เสนอได้สูงสุด 12.32 บาท/งวด (เพดาน 15% ต่อปี)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ยื่นซอง" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "12.32" } });
    expect(input).toHaveValue("12.32");
    expect(screen.getByRole("button", { name: "ยื่นซอง" })).toBeEnabled();
  });

  it("members tab marks trusted members", async () => {
    tweakCircle = (c) => Object.assign(c.members[1], { trusted: true, reputation: 115 });
    renderAt("/circles/c1?tab=members");
    const row = (await screen.findByText(/คะแนนความน่าเชื่อถือ 115/)).closest("li")!;
    expect(row).toHaveTextContent("สมาชิกที่น่าเชื่อถือ");
  });

  it("open circles show when they close automatically", async () => {
    tweakCircle = (c) => Object.assign(c, { status: "OPEN", currentRound: 0, openUntil: now - 60 });
    renderAt("/circles/c1?tab=members");
    expect(await screen.findByText(/วงนี้จะถูกระบบยกเลิกโดยอัตโนมัติ/)).toBeInTheDocument();
  });

  it("home blocks create/join while defaults are outstanding", async () => {
    meOverrides = { outstandingDefaults: 2 };
    renderAt("/");
    expect(
      await screen.findByText("มีหนี้ผิดนัดค้าง 2 รายการ — ชำระย้อนหลังให้ผู้รับยืนยันก่อน จึงจะสร้างหรือเข้าวงใหม่ได้"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ สร้างวง" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "ค้นหาวง" })).toBeDisabled();
  });

  it("admin KYC approval defaults to reputation 100 and explains the trusted level", async () => {
    extraRoutes = (path) =>
      path === "/admin/kyc"
        ? json([{ id: "k1", userId: "u9", displayName: "ใหม่", fullName: "นาย ใหม่ ทดสอบ", nationalIdLast4: "1234", status: "PENDING", createdAt: new Date().toISOString() }])
        : null;
    renderAt("/admin");
    const input = await screen.findByLabelText("คะแนนเริ่มต้น");
    expect(input).toHaveValue(100);
    expect(screen.getByText(/110 ขึ้นไป = "น่าเชื่อถือ"/)).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "120" } });
    expect(screen.getByText(/สมาชิกที่น่าเชื่อถือ/)).toBeInTheDocument();
  });

  it.each(["/circles", "/profile", "/notifications", "/admin", "/how-it-works"])("%s renders", async (path) => {
    const { container } = renderAt(path);
    await screen.findAllByRole("heading");
    expect(container.textContent?.length).toBeGreaterThan(20);
  });

  it("recipient answers each declared payment: confirm or not received", async () => {
    recipientIsMe = true;
    renderAt("/circles/c1?tab=payment");
    expect(await screen.findByText("งวดนี้คุณเป็นผู้รับเงินกองกลาง 🎉")).toBeInTheDocument();
    const declared = screen.getByText("มานี").closest("li")!;
    expect(declared).toHaveTextContent("ยืนยันได้รับเงิน");
    expect(declared).toHaveTextContent("ยังไม่ได้รับเงิน");
    const attested = screen.getByText("สมหญิง").closest("li")!;
    expect(attested).toHaveTextContent("ตรวจสลิปกับธนาคารแล้ว ✓");
    expect(attested).not.toHaveTextContent("ยังไม่ได้รับเงิน");
    expect(screen.getByText(/ยืนยันแล้ว 1\/2 คน/)).toBeInTheDocument();
    expect(screen.getByText(/ถ้าไม่ตอบภายในเวลานี้ ระบบจะถือว่าคุณได้รับเงิน/)).toBeInTheDocument();
  });

  it("changing PromptPay asks for a step-up OTP and explains RECIPIENT_LOCKED", async () => {
    const bodies: unknown[] = [];
    extraRoutes = (path, init) => {
      if (path === "/me/step-up/otp") return json({ ok: true, devCode: "123456" });
      if (path === "/me/promptpay") {
        bodies.push(JSON.parse(String(init?.body)));
        return Promise.resolve(
          new Response(JSON.stringify({ error: { code: "RECIPIENT_LOCKED", message: "locked" } }), { status: 409 }),
        );
      }
      return null;
    };
    renderAt("/profile");
    fireEvent.click(await screen.findByRole("button", { name: "แก้ไข" }));
    fireEvent.change(screen.getByLabelText("พร้อมเพย์"), { target: { value: "0899999999" } });
    fireEvent.click(screen.getByRole("button", { name: "ส่งรหัสยืนยัน" }));
    expect(await screen.findByTestId("dev-otp")).toHaveTextContent("123456");
    fireEvent.change(screen.getByLabelText("รหัสยืนยันทาง SMS"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    expect(await screen.findByText("เปลี่ยนไม่ได้ระหว่างที่คุณเป็นผู้รับเงินของรอบที่ยังไม่ปิด")).toBeInTheDocument();
    expect(bodies).toEqual([{ promptPayId: "0899999999", code: "123456" }]);
  });

  it("restore offers key recovery when the recovery code is lost", async () => {
    meOverrides = { walletAddress: A2 };
    renderAt("/restore");
    fireEvent.click(await screen.findByRole("button", { name: "ลืมรหัสกู้คืนหรือทำเครื่องหาย" }));
    expect(await screen.findByText(/ต้องมีผู้ดูแล 2 คนอนุมัติ/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เริ่มสร้างกุญแจใหม่" })).toBeEnabled();
  });

  it("key recovery creates a new key here and requests the rotation with a proof", async () => {
    meOverrides = { walletAddress: A2 };
    const requests: { newAddress: `0x${string}`; proof: `0x${string}` }[] = [];
    extraRoutes = (path, init) => {
      if (path === "/me/key-rotation" && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        requests.push(body);
        meOverrides = {
          walletAddress: A2,
          pendingKeyRotation: { id: "kr1", newAddress: body.newAddress, approvals: 0, executeAfter: null, createdAt: new Date().toISOString() },
        };
        return json(me());
      }
      return null;
    };
    const pinPad = async (pin: string) => {
      for (const d of pin) await act(async () => fireEvent.click(screen.getByRole("button", { name: d })));
    };
    renderAt("/restore");
    fireEvent.click(await screen.findByRole("button", { name: "ลืมรหัสกู้คืนหรือทำเครื่องหาย" }));
    fireEvent.click(await screen.findByRole("button", { name: "เริ่มสร้างกุญแจใหม่" }));
    await pinPad("482913");
    await screen.findByText("ยืนยัน PIN อีกครั้ง");
    await pinPad("482913");
    const code = (await screen.findByTestId("recovery-code")).getAttribute("data-code")!;
    fireEvent.click(screen.getByRole("button", { name: "บันทึกรหัสแล้ว" }));
    const label = (await screen.findByText(/พิมพ์รหัสชุดที่ \d/)).textContent!;
    fireEvent.change(screen.getByLabelText(/พิมพ์รหัสชุดที่/), { target: { value: code.split("-")[Number(label.match(/\d/)![0]) - 1] } });
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันและส่งคำขอ" }));

    expect(await screen.findByText("ส่งคำขอเปลี่ยนกุญแจแล้ว", {}, { timeout: 15_000 })).toBeInTheDocument();
    const newAddress = (await localAddress())!;
    expect(requests).toHaveLength(1);
    expect(requests[0]!.newAddress).toBe(newAddress);
    expect(await verifyMessage({ address: newAddress, message: keyRotationMessage("u1", newAddress), signature: requests[0]!.proof })).toBe(true);
    // the backup waits on this device until the rotation executes; nothing was uploaded yet
    const pending = (await pendingBackup())!;
    expect(pending.address).toBe(newAddress);
    expect(await verifyMessage({ address: newAddress, message: walletProofMessage("u1", newAddress), signature: pending.proof })).toBe(true);
    const fetchMock = vi.mocked(fetch);
    expect(fetchMock.mock.calls.some(([u]) => String(u) === "/api/me/wallet")).toBe(false);
  });

  it("uploads the pending backup once the rotation has executed", async () => {
    const local = (await localAddress())!;
    const { savePendingBackup } = await import("@/wallet/device");
    await savePendingBackup({ address: local, proof: "0xabcd", backup: { v: 1, salt: "s", iv: "i", ciphertext: "c" } });
    const uploads: unknown[] = [];
    extraRoutes = (path, init) => {
      if (path === "/me/wallet" && init?.method === "PUT") {
        uploads.push(JSON.parse(String(init.body)));
        return json({ ok: true });
      }
      return null;
    };
    renderAt("/");
    expect(await screen.findByText(/ถัดไป:/)).toBeInTheDocument();
    expect(uploads).toEqual([{ address: local, proof: "0xabcd", backup: { v: 1, salt: "s", iv: "i", ciphertext: "c" } }]);
    expect(await pendingBackup()).toBeNull();
  });

  it("restore shows the status of a rotation requested from this device", async () => {
    meOverrides = {
      walletAddress: A2,
      pendingKeyRotation: { id: "kr1", newAddress: ME, approvals: 2, executeAfter: now + 3600, createdAt: new Date().toISOString() },
    };
    renderAt("/restore");
    expect(await screen.findByText("ส่งคำขอเปลี่ยนกุญแจแล้ว")).toBeInTheDocument();
    expect(screen.getByText("2/2")).toBeInTheDocument();
    expect(screen.getByText("จะเปลี่ยนได้หลัง")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ยกเลิกคำขอ" })).toBeInTheDocument();
  });

  it("home warns about a rotation requested from another device", async () => {
    meOverrides = {
      pendingKeyRotation: { id: "kr1", newAddress: A2, approvals: 1, executeAfter: null, createdAt: new Date().toISOString() },
    };
    renderAt("/");
    expect(await screen.findByText("มีคำขอย้ายบัญชีนี้ไปใช้กุญแจบนเครื่องอื่น")).toBeInTheDocument();
  });

  it("admin reviews key rotation requests", async () => {
    extraRoutes = (path) =>
      path === "/admin/key-rotations"
        ? json([
            {
              id: "kr1",
              userId: "u9",
              displayName: "ลืมรหัส",
              oldAddress: A1,
              newAddress: A2,
              status: "PENDING",
              approvals: [{ adminId: "u1", adminName: "สมชาย", at: new Date().toISOString() }],
              executeAfter: null,
              createdAt: new Date().toISOString(),
            },
          ])
        : null;
    renderAt("/admin");
    expect(await screen.findByRole("heading", { name: "คำขอเปลี่ยนกุญแจ" })).toBeInTheDocument();
    expect(await screen.findByText("ลืมรหัส")).toBeInTheDocument();
    expect(screen.getByText("1/2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "คุณอนุมัติแล้ว" })).toBeDisabled();
  });

  it("admin without a passkey enrols one first (ความปลอดภัยผู้ดูแล)", async () => {
    let enrolled = false;
    const bodies: Record<string, unknown> = {};
    extraRoutes = (path, init) => {
      if (path === "/admin/security")
        return json(
          enrolled
            ? securityView({ stepUpExpiresAt: new Date(Date.now() + 900_000).toISOString(), enrolment: "open" })
            : securityView({ passkeys: [], enrolment: "open" }),
        );
      if (path === "/admin/kyc" && !enrolled)
        return apiError(403, "ADMIN_PASSKEY_REQUIRED", "ต้องลงทะเบียนพาสคีย์ผู้ดูแลก่อนใช้งานเมนูผู้ดูแล (ความปลอดภัยผู้ดูแล)");
      if (path === "/admin/passkeys/register/options") return json({ challenge: "c1", rp: { name: "Bank For All" } });
      if (path === "/admin/passkeys/register/verify") {
        bodies.verify = JSON.parse(init?.body as string);
        enrolled = true;
        return json(securityView({ enrolment: "open" }));
      }
      return null;
    };
    renderAt("/admin");
    expect(await screen.findByText(/ยังไม่มีพาสคีย์ — ต้องลงทะเบียนก่อน/)).toBeInTheDocument();
    expect(await screen.findByText(/ต้องลงทะเบียนพาสคีย์ผู้ดูแลก่อนใช้งาน/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("ชื่ออุปกรณ์สำหรับพาสคีย์ใหม่"), { target: { value: "ไอโฟน" } });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มพาสคีย์" }));
    expect(await screen.findByText("เพิ่มพาสคีย์แล้ว")).toBeInTheDocument();
    expect(webauthn.startRegistration).toHaveBeenCalledWith({ optionsJSON: { challenge: "c1", rp: { name: "Bank For All" } } });
    expect(bodies.verify).toMatchObject({ name: "ไอโฟน", response: { id: "cred-new" } });
    expect(await screen.findByText(/ทำรายการได้ถึง/)).toBeInTheDocument();
  });

  it("asks for the passkey when an admin action needs a step-up, then retries", async () => {
    let steppedUp = false;
    let decisions = 0;
    extraRoutes = (path) => {
      if (path === "/admin/kyc") return json([kycItem()]);
      if (path === "/admin/kyc/k1/decision") {
        decisions++;
        return steppedUp ? json({ ok: true }) : apiError(403, "ADMIN_STEP_UP_REQUIRED", "กรุณายืนยันตัวตนด้วยพาสคีย์ก่อนทำรายการนี้");
      }
      if (path === "/admin/step-up/options") return json({ challenge: "c2", allowCredentials: [{ id: "cred-1", type: "public-key" }] });
      if (path === "/admin/step-up/verify") {
        steppedUp = true;
        return json({ expiresAt: new Date(Date.now() + 900_000).toISOString() });
      }
      return null;
    };
    renderAt("/admin");
    fireEvent.click(await screen.findByRole("button", { name: "อนุมัติ" }));
    const sheet = await screen.findByRole("dialog", { name: "ยืนยันตัวตนผู้ดูแล" });
    expect(webauthn.startAuthentication).not.toHaveBeenCalled(); // waits for the admin's tap
    fireEvent.click(within(sheet).getByRole("button", { name: "ยืนยันด้วยพาสคีย์" }));
    expect(await screen.findByText("อนุมัติแล้ว")).toBeInTheDocument();
    expect(webauthn.startAuthentication).toHaveBeenCalledWith({
      optionsJSON: { challenge: "c2", allowCredentials: [{ id: "cred-1", type: "public-key" }] },
    });
    expect(decisions).toBe(2);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("cancelling the step-up leaves the action undone", async () => {
    let decisions = 0;
    extraRoutes = (path) => {
      if (path === "/admin/kyc") return json([kycItem()]);
      if (path === "/admin/kyc/k1/decision") {
        decisions++;
        return apiError(403, "ADMIN_STEP_UP_REQUIRED", "กรุณายืนยันตัวตนด้วยพาสคีย์ก่อนทำรายการนี้");
      }
      return null;
    };
    renderAt("/admin");
    fireEvent.click(await screen.findByRole("button", { name: "อนุมัติ" }));
    const sheet = await screen.findByRole("dialog", { name: "ยืนยันตัวตนผู้ดูแล" });
    fireEvent.click(within(sheet).getByRole("button", { name: "ปิด" }));
    expect(await screen.findByText(/ต้องยืนยันด้วยพาสคีย์ก่อนทำรายการนี้/)).toBeInTheDocument();
    expect(decisions).toBe(1);
  });

  it("shows a cancelled passkey prompt in Thai and keeps the last passkey", async () => {
    webauthn.startAuthentication.mockRejectedValueOnce(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
    extraRoutes = (path) => (path === "/admin/step-up/options" ? json({ challenge: "c3" }) : null);
    renderAt("/admin");
    expect(await screen.findByRole("heading", { name: "ความปลอดภัยผู้ดูแล" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "ลบพาสคีย์ มือถือ" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันตอนนี้" }));
    expect(await screen.findByText("ยกเลิกการใช้พาสคีย์ หรือหมดเวลา กรุณาลองใหม่")).toBeInTheDocument();
  });

  afterEach(() => {
    expect(errors).toEqual([]);
  });
});
