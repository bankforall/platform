import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
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

const now = Math.floor(Date.now() / 1000);
let ME: `0x${string}`;
const A1 = "0x00000000000000000000000000000000000000a1";
const A2 = "0x00000000000000000000000000000000000000a2";

/** Per-test tweaks of the fixtures. */
let meOverrides: Partial<MeResponse> = {};
let recipientIsMe = false;
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
  }));
  return circleDetail.parse({
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
  });
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
    extraRoutes = () => null;
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
    expect(await screen.findByText(/1\. 1,100 บาท/)).toBeInTheDocument();
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

  afterEach(() => {
    expect(errors).toEqual([]);
  });
});
