import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { circleDetail, circleSummary, meResponse, type CircleDetail, type MeResponse } from "@bankforall/shared";
import { ToastProvider } from "@/components/overlay";
import { IntentProvider } from "@/hooks/useIntent";
import { clearDevice, newPrivateKey, storeLocalKey } from "@/wallet/device";
import App from "@/App";

const now = Math.floor(Date.now() / 1000);
let ME: `0x${string}`;
const A1 = "0x00000000000000000000000000000000000000a1";
const A2 = "0x00000000000000000000000000000000000000a2";

function me(): MeResponse {
  return meResponse.parse({
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
  });
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
        recipient: A1,
        recipientName: "สมหญิง",
        winningBid: "5000",
        paymentDeadline: now + 2 * 86400,
        defaultAfter: now + 3 * 86400,
        payments: [
          { payer: ME, payerName: "สมชาย", amount: "100000", status: "NONE", slipId: null, slipVerify: null, txHash: null },
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

function routes(url: string): Promise<Response> {
  const path = url.replace(/^\/api/, "").split("?")[0]!;
  if (path === "/config") return json({ chainId: 84532, forwarder: A1, factory: A2, explorerUrl: "https://sepolia.basescan.org", lineLoginEnabled: true, devLoginEnabled: true });
  if (path === "/me") return json(me());
  if (path === "/me/notifications") return json([{ id: "n1", kind: "due", title: "ถึงกำหนดจ่าย", body: "จ่าย 1,000 บาท", circleId: "c1", createdAt: new Date().toISOString(), readAt: null }]);
  if (path === "/circles" || path === "/circles/discover") return json([circleSummary.parse(circle())]);
  if (path === "/circles/c1") return json(circle());
  if (path === "/circles/c1/promptpay")
    return json({ payload: "00020101021229370016A000000677010111011300668123456785802TH530376463045D82", amount: "100000", recipientName: "สมหญิง", promptPayMasked: "081-xxx-5678" });
  if (path.startsWith("/admin/kyc")) return json([]);
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
    vi.stubGlobal("fetch", vi.fn((url: string) => routes(url)));
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

  afterEach(() => {
    expect(errors).toEqual([]);
  });
});
