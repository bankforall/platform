import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { encodeFunctionData, verifyTypedData } from "viem";
import { circleAbi, forwardRequestTypes, toTypedDataMessage, type PreparedIntent } from "@bankforall/shared";
import { ToastProvider } from "@/components/overlay";
import { IntentProvider, useIntent } from "./useIntent";
import { clearDevice, newPrivateKey, setPin, storeLocalKey } from "@/wallet/device";

const CIRCLE = "0x00000000000000000000000000000000000000c1";
const PAYER = "0x00000000000000000000000000000000000000a1";
// Matches the pins in vite.config.ts (test.env).
const CONFIG = {
  chainId: 84532,
  forwarder: "0x00000000000000000000000000000000000000f0",
  factory: "0x00000000000000000000000000000000000000fa",
  explorerUrl: null,
  lineLoginEnabled: false,
  devLoginEnabled: true,
};
const SUMMARY = "ยืนยันว่าได้รับเงิน 1,000 บาท จาก สมหญิง แล้ว";

function intentFor(from: `0x${string}`, to: string = CIRCLE): PreparedIntent {
  return {
    id: "int_1",
    kind: "confirmReceipt",
    summary: SUMMARY,
    typedData: {
      domain: { name: "BankForAllForwarder", version: "1", chainId: 84532, verifyingContract: CONFIG.forwarder },
      primaryType: "ForwardRequest",
      message: {
        from,
        to,
        value: "0",
        gas: "300000",
        nonce: "7",
        deadline: 1_900_000_000,
        data: encodeFunctionData({ abi: circleAbi, functionName: "confirmReceipt", args: [PAYER] }),
      },
    },
  };
}

function Harness({ prepare, onResult }: { prepare: () => Promise<PreparedIntent>; onResult: (r: unknown) => void }) {
  const { run } = useIntent();
  return (
    <button
      onClick={() =>
        void run({
          title: "ทดสอบ",
          prepare,
          expect: { kind: "confirmReceipt", circle: CIRCLE, payer: PAYER },
          display: { members: [{ address: PAYER, displayName: "สมหญิง" }] },
          bid: { amount: "500", salt: "0x" + "ab".repeat(32) },
        }).then(onResult)
      }
    >
      go
    </button>
  );
}

const HEADLINE = "ยืนยันว่าได้รับเงินจาก สมหญิง";

function renderHarness(prepare: () => Promise<PreparedIntent>, onResult: (r: unknown) => void) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <IntentProvider>
          <Harness prepare={prepare} onResult={onResult} />
        </IntentProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

async function typePin(pin: string) {
  for (const d of pin) {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: d }));
    });
  }
}

describe("useIntent", () => {
  let address: `0x${string}`;
  const fetchMock = vi.fn();

  beforeEach(async () => {
    await clearDevice();
    address = await storeLocalKey(newPrivateKey());
    await setPin("482913");
    fetchMock.mockReset();
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        url === "/api/config"
          ? new Response(JSON.stringify(CONFIG), { status: 200 })
          : new Response(JSON.stringify({ id: "int_1", kind: "confirmReceipt", status: "CONFIRMED", txHash: "0xab", error: null, circleId: "c1" }), {
              status: 200,
            }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const submits = () => fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/api/intents/"));

  it("renders the decoded call, signs on-device and submits the signature", async () => {
    const intent = intentFor(address);
    const onResult = vi.fn();
    renderHarness(() => Promise.resolve(intent), onResult);

    fireEvent.click(screen.getByText("go"));
    expect(await screen.findByText(HEADLINE)).toBeInTheDocument();
    expect(screen.getByText(SUMMARY)).toBeInTheDocument(); // server text only as secondary
    await typePin("482913");

    expect(await screen.findByText("บันทึกถาวรแล้ว", {}, { timeout: 5000 })).toBeInTheDocument();
    const [url, init] = submits()[0]!;
    expect(url).toBe("/api/intents/int_1/submit");
    expect((init as RequestInit).headers).toMatchObject({ "x-requested-with": "bankforall" });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.bid).toBeUndefined(); // the bid secret only travels with commitBid

    const valid = await verifyTypedData({
      address,
      domain: { ...intent.typedData.domain, verifyingContract: intent.typedData.domain.verifyingContract as `0x${string}` },
      types: forwardRequestTypes,
      primaryType: "ForwardRequest",
      message: toTypedDataMessage(intent.typedData.message),
      signature: body.signature,
    });
    expect(valid).toBe(true);

    fireEvent.click(screen.getByText("เสร็จสิ้น"));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ status: "CONFIRMED" })));
  });

  it("does not submit with a wrong PIN", async () => {
    renderHarness(() => Promise.resolve(intentFor(address)), vi.fn());
    fireEvent.click(screen.getByText("go"));
    await screen.findByText(HEADLINE);
    await typePin("000000");
    expect(await screen.findByText("PIN ไม่ถูกต้อง")).toBeInTheDocument();
    expect(submits()).toHaveLength(0);
  });

  it("refuses before asking for the PIN when the request is for a different account", async () => {
    renderHarness(() => Promise.resolve(intentFor("0x0000000000000000000000000000000000000bad")), vi.fn());
    fireEvent.click(screen.getByText("go"));
    expect(await screen.findByText("หยุดรายการเพื่อความปลอดภัย")).toBeInTheDocument();
    expect(screen.getByText(/ไม่ใช่ของกุญแจบนเครื่องนี้/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "0" })).not.toBeInTheDocument();
    expect(submits()).toHaveLength(0);
  });

  it("refuses a request aimed at another circle", async () => {
    renderHarness(() => Promise.resolve(intentFor(address, "0x00000000000000000000000000000000000000c2")), vi.fn());
    fireEvent.click(screen.getByText("go"));
    expect(await screen.findByText(/ปลายทางไม่ใช่วงที่คุณกำลังทำรายการ/)).toBeInTheDocument();
    expect(submits()).toHaveLength(0);
  });

  it("refuses when /api/config disagrees with the build-time pins", async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(new Response(JSON.stringify(url === "/api/config" ? { ...CONFIG, chainId: 1 } : {}), { status: 200 })),
    );
    renderHarness(() => Promise.resolve(intentFor(address)), vi.fn());
    fireEvent.click(screen.getByText("go"));
    expect(await screen.findByText(/ข้อมูลเครือข่ายจากเซิร์ฟเวอร์ไม่ตรงกับแอป/)).toBeInTheDocument();
    expect(submits()).toHaveLength(0);
  });
});
