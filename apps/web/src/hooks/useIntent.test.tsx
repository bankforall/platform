import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { verifyTypedData } from "viem";
import { forwardRequestTypes, toTypedDataMessage, type PreparedIntent } from "@bankforall/shared";
import { ToastProvider } from "@/components/overlay";
import { IntentProvider, useIntent } from "./useIntent";
import { clearDevice, newPrivateKey, setPin, storeLocalKey } from "@/wallet/device";

function intentFor(from: `0x${string}`): PreparedIntent {
  return {
    id: "int_1",
    kind: "join",
    summary: "เข้าร่วมวง ทดสอบ ที่นั่ง 1",
    typedData: {
      domain: { name: "BankForAllForwarder", version: "1", chainId: 84532, verifyingContract: "0x00000000000000000000000000000000000000f0" },
      primaryType: "ForwardRequest",
      message: {
        from,
        to: "0x00000000000000000000000000000000000000c1",
        value: "0",
        gas: "300000",
        nonce: "7",
        deadline: 1_900_000_000,
        data: "0x1234",
      },
    },
  };
}

function Harness({ prepare, onResult }: { prepare: () => Promise<PreparedIntent>; onResult: (r: unknown) => void }) {
  const { run } = useIntent();
  return (
    <button onClick={() => void run({ title: "ทดสอบ", prepare, bid: { amount: "500", salt: "0x" + "ab".repeat(32) } }).then(onResult)}>
      go
    </button>
  );
}

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
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("signs the forward request on-device and submits the signature with the bid secret", async () => {
    const intent = intentFor(address);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: "int_1", kind: "join", status: "CONFIRMED", txHash: "0xab", error: null, circleId: "c1" }), { status: 200 }),
    );
    const onResult = vi.fn();
    renderHarness(() => Promise.resolve(intent), onResult);

    fireEvent.click(screen.getByText("go"));
    expect(await screen.findByText(intent.summary)).toBeInTheDocument();
    await typePin("482913");

    expect(await screen.findByText("บันทึกถาวรแล้ว", {}, { timeout: 5000 })).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/intents/int_1/submit");
    expect((init as RequestInit).headers).toMatchObject({ "x-requested-with": "bankforall" });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.bid).toEqual({ amount: "500", salt: "0x" + "ab".repeat(32) });

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
    await screen.findByText("เข้าร่วมวง ทดสอบ ที่นั่ง 1");
    await typePin("000000");
    expect(await screen.findByText("PIN ไม่ถูกต้อง")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses to sign for a different account", async () => {
    renderHarness(() => Promise.resolve(intentFor("0x0000000000000000000000000000000000000bad")), vi.fn());
    fireEvent.click(screen.getByText("go"));
    await screen.findByText("เข้าร่วมวง ทดสอบ ที่นั่ง 1");
    await typePin("482913");
    expect(await screen.findByText(/ไม่ตรงกับบัญชี/, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
