import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { forwardRequestTypes, toTypedDataMessage, type IntentResponse, type PreparedIntent } from "@bankforall/shared";
import { api, qk } from "@/api/endpoints";
import { errorMessage } from "@/api/client";
import { BottomSheet, PinPad, useToast } from "@/components/overlay";
import { Button, Spinner } from "@/components/ui";
import { PinError, localAddress, unlock } from "@/wallet/device";
import { resolveTrustedChain } from "@/wallet/chain";
import {
  SigningRefusedError,
  verifyIntent,
  type IntentDisplay,
  type IntentExpectation,
  type VerifiedIntent,
} from "@/wallet/verifyIntent";

/**
 * Every on-chain action: prepare (API) → verify and decode the forward request on this device →
 * confirm (rendered from the decoded call) → PIN → sign EIP-712 → submit (API relays) → result.
 * Exposed as `useIntent().run(...)`.
 */

export interface RunIntentOptions {
  /** Calls a prepare route and returns the intent to sign. */
  prepare: () => Promise<PreparedIntent>;
  /** Sheet title. */
  title: string;
  /** What the user asked for; the prepared request is refused unless it matches. */
  expect: IntentExpectation;
  /** Names and amounts used to describe the decoded call. */
  display?: IntentDisplay;
  /** commitBid: amount + salt sent with the signature so the server can reveal on time. */
  bid?: { amount: string; salt: string };
  successMessage?: string;
}

type Phase =
  | { kind: "idle" }
  | { kind: "preparing" }
  | { kind: "confirm"; intent: PreparedIntent; verified: VerifiedIntent; pinError: string | null; locked: boolean }
  | { kind: "submitting" }
  | { kind: "done"; result: IntentResponse }
  | { kind: "failed"; message: string; refused?: boolean };

interface Ctx {
  run: (opts: RunIntentOptions) => Promise<IntentResponse | null>;
}

const IntentContext = createContext<Ctx | null>(null);

export function useIntent(): Ctx {
  const ctx = useContext(IntentContext);
  if (!ctx) throw new Error("useIntent outside IntentProvider");
  return ctx;
}

export function IntentProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [title, setTitle] = useState("");
  const current = useRef<{ opts: RunIntentOptions; resolve: (r: IntentResponse | null) => void } | null>(null);
  const queryClient = useQueryClient();
  const toast = useToast();

  const finish = useCallback((result: IntentResponse | null) => {
    current.current?.resolve(result);
    current.current = null;
  }, []);

  const run = useCallback(
    (opts: RunIntentOptions) =>
      new Promise<IntentResponse | null>((resolve) => {
        if (current.current) current.current.resolve(null);
        current.current = { opts, resolve };
        setTitle(opts.title);
        setPhase({ kind: "preparing" });
        prepareAndVerify(opts)
          .then(({ intent, verified }) => setPhase({ kind: "confirm", intent, verified, pinError: null, locked: false }))
          .catch((e) => setPhase({ kind: "failed", message: errorMessage(e), refused: e instanceof SigningRefusedError }));
      }),
    [],
  );

  async function prepareAndVerify(opts: RunIntentOptions) {
    const intent = await opts.prepare();
    const [chain, local] = await Promise.all([
      resolveTrustedChain(() => queryClient.fetchQuery({ queryKey: qk.config, queryFn: api.config, staleTime: Infinity })),
      localAddress(),
    ]);
    if (!local) throw new SigningRefusedError("ไม่พบกุญแจบนเครื่องนี้ กรุณากู้คืนบัญชี");
    const verified = verifyIntent(intent, { chain, localAddress: local, expect: opts.expect, display: opts.display });
    return { intent, verified };
  }

  const sign = async (intent: PreparedIntent, verified: VerifiedIntent, pin: string) => {
    let account;
    try {
      account = await unlock(pin);
    } catch (e) {
      const locked = e instanceof PinError && !!e.lockedUntil;
      setPhase({ kind: "confirm", intent, verified, pinError: errorMessage(e), locked });
      return;
    }
    if (account.address.toLowerCase() !== intent.typedData.message.from.toLowerCase()) {
      setPhase({ kind: "failed", message: "กุญแจบนเครื่องนี้ไม่ตรงกับบัญชี กรุณากู้คืนบัญชีในหน้าโปรไฟล์", refused: true });
      return;
    }
    setPhase({ kind: "submitting" });
    try {
      const { domain, message } = intent.typedData;
      const signature = await account.signTypedData({
        domain: { ...domain, verifyingContract: domain.verifyingContract as `0x${string}` },
        types: forwardRequestTypes,
        primaryType: "ForwardRequest",
        message: toTypedDataMessage(message),
      });
      const bid = verified.kind === "commitBid" ? current.current?.opts.bid : undefined;
      const result = await api.submitIntent(intent.id, signature, bid);
      await queryClient.invalidateQueries();
      if (result.status === "CONFIRMED") {
        setPhase({ kind: "done", result });
        toast(current.current?.opts.successMessage ?? "บันทึกถาวรแล้ว ✓", "success");
      } else {
        setPhase({ kind: "failed", message: result.error ?? "ทำรายการไม่สำเร็จ" });
      }
    } catch (e) {
      setPhase({ kind: "failed", message: errorMessage(e) });
    }
  };

  const close = () => {
    const result = phase.kind === "done" ? phase.result : null;
    setPhase({ kind: "idle" });
    finish(result);
  };

  const busy = phase.kind === "preparing" || phase.kind === "submitting";

  return (
    <IntentContext.Provider value={{ run }}>
      {children}
      <BottomSheet open={phase.kind !== "idle"} onClose={close} title={title} dismissable={!busy}>
        {phase.kind === "preparing" && <Busy label="กำลังเตรียมรายการ…" />}
        {phase.kind === "submitting" && <Busy label="กำลังบันทึกถาวร… อาจใช้เวลาสักครู่" />}
        {phase.kind === "confirm" && (
          <div>
            <ConfirmDetails verified={phase.verified} />
            <PinPad
              label="ยืนยันด้วย PIN 6 หลัก"
              error={phase.pinError}
              disabled={phase.locked}
              onComplete={(pin) => void sign(phase.intent, phase.verified, pin)}
            />
            <p className="mt-4 text-center text-xs text-ink-muted">
              รายการนี้จะถูกบันทึกถาวรในชื่อของคุณและตรวจสอบย้อนหลังได้
            </p>
          </div>
        )}
        {phase.kind === "done" && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success-soft text-3xl text-success" aria-hidden>
              ✓
            </div>
            <p className="text-lg font-semibold text-ink">บันทึกถาวรแล้ว</p>
            <p className="text-sm text-ink-muted">{current.current?.opts.successMessage ?? "ทำรายการสำเร็จ"}</p>
            <Button block onClick={close}>
              เสร็จสิ้น
            </Button>
          </div>
        )}
        {phase.kind === "failed" && (
          <div className="flex flex-col items-center gap-3 py-4 text-center" role="alert">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-danger-soft text-3xl text-danger" aria-hidden>
              !
            </div>
            <p className="text-lg font-semibold text-ink">{phase.refused ? "หยุดรายการเพื่อความปลอดภัย" : "ทำรายการไม่สำเร็จ"}</p>
            <p className="text-sm text-ink-muted">{phase.message}</p>
            <Button block variant="secondary" onClick={close}>
              ปิด
            </Button>
          </div>
        )}
      </BottomSheet>
    </IntentContext.Provider>
  );
}

function ConfirmDetails({ verified }: { verified: VerifiedIntent }) {
  return (
    <div className="mb-5 rounded-2xl bg-primary-soft p-4 text-ink" data-testid="intent-confirm">
      <p className="font-semibold">{verified.headline}</p>
      {verified.details.length > 0 && (
        <dl className="mt-2 space-y-1 text-sm">
          {verified.details.map((d) => (
            <div key={d.label} className="flex justify-between gap-3">
              <dt className="text-ink-muted">{d.label}</dt>
              <dd className="text-right font-medium">{d.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="mt-3 border-t border-primary/10 pt-2 text-xs text-ink-muted">
        <span className="sr-only">ข้อความจากระบบ: </span>
        {verified.serverSummary}
      </p>
    </div>
  );
}

function Busy({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-ink-muted" role="status">
      <Spinner className="h-8 w-8 text-primary" />
      <span className="text-sm">{label}</span>
    </div>
  );
}
