import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "./ui";

// ─────────────── toasts ───────────────

type ToastTone = "success" | "error" | "info";
interface Toast {
  id: number;
  tone: ToastTone;
  text: string;
}

const ToastContext = createContext<(text: string, tone?: ToastTone) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const push = useCallback((text: string, tone: ToastTone = "info") => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] mx-auto flex max-w-app flex-col gap-2 px-4" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            className={cx(
              "pointer-events-auto rounded-xl px-4 py-3 text-sm font-medium shadow-lg",
              t.tone === "success" && "bg-success text-white",
              t.tone === "error" && "bg-danger text-white",
              t.tone === "info" && "bg-ink text-white",
            )}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

// ─────────────── bottom sheet ───────────────

export function BottomSheet({
  open,
  onClose,
  title,
  children,
  dismissable = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  dismissable?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissable) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open, dismissable, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-ink/50" onClick={dismissable ? onClose : undefined} aria-hidden />
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative max-h-[92vh] w-full max-w-app overflow-y-auto rounded-t-3xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl focus:outline-hidden"
      >
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-gray-200" aria-hidden />
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink">{title}</h2>
          {dismissable && (
            <button onClick={onClose} className="rounded-full p-1 text-ink-muted hover:bg-gray-100" aria-label="ปิด">
              ✕
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

// ─────────────── PIN pad ───────────────

export function PinPad({
  length = 6,
  onComplete,
  disabled,
  error,
  label = "ใส่ PIN 6 หลัก",
}: {
  length?: number;
  onComplete: (pin: string) => void;
  disabled?: boolean;
  error?: string | null;
  label?: string;
}) {
  const [pin, setPin] = useState("");
  useEffect(() => {
    if (error) setPin("");
  }, [error]);

  const press = (d: string) => {
    if (disabled) return;
    const next = (pin + d).slice(0, length);
    setPin(next);
    if (next.length === length) {
      onComplete(next);
      setTimeout(() => setPin(""), 300);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") setPin((p) => p.slice(0, -1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="flex flex-col items-center">
      <p className="mb-3 text-sm text-ink-muted" id="pin-label">
        {label}
      </p>
      <div className="mb-2 flex gap-3" role="img" aria-label={`ใส่แล้ว ${pin.length} จาก ${length} หลัก`}>
        {Array.from({ length }, (_, i) => (
          <span
            key={i}
            className={cx(
              "h-11 w-10 rounded-xl border-2 text-center text-xl leading-10",
              i < pin.length ? "border-primary bg-primary text-white" : "border-gray-200 bg-surface-input",
            )}
          >
            {i < pin.length ? "•" : ""}
          </span>
        ))}
      </div>
      <p className="mb-2 h-5 text-sm text-danger" role="alert">
        {error ?? ""}
      </p>
      <div className="grid w-full max-w-xs grid-cols-3 gap-2" aria-labelledby="pin-label">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map((k, i) =>
          k === "" ? (
            <span key={i} />
          ) : (
            <button
              key={i}
              type="button"
              disabled={disabled}
              onClick={() => (k === "⌫" ? setPin((p) => p.slice(0, -1)) : press(k))}
              className="h-14 rounded-2xl bg-surface text-2xl font-medium text-ink hover:bg-primary-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40"
              aria-label={k === "⌫" ? "ลบ" : k}
            >
              {k}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
