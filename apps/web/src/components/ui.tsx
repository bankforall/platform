import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { Link } from "react-router-dom";

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger" | "white";

const variants: Record<Variant, string> = {
  primary: "bg-primary text-white hover:bg-primary-dim disabled:bg-primary/40",
  secondary: "bg-primary-soft text-primary hover:bg-primary/15 disabled:opacity-50",
  ghost: "text-primary hover:bg-primary-soft disabled:opacity-50",
  danger: "bg-danger text-white hover:bg-danger/90 disabled:opacity-50",
  white: "bg-white text-primary hover:bg-white/90 disabled:opacity-60",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
  block?: boolean;
  size?: "md" | "sm";
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", loading, block, size = "md", className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed",
        size === "md" ? "px-5 py-3 text-base" : "px-3 py-1.5 text-sm",
        variants[variant],
        block && "w-full",
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
});

export function Spinner({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg className={cx("animate-spin", className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Loading({ label = "กำลังโหลด…" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-ink-muted" role="status">
      <Spinner className="h-8 w-8 text-primary" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="mx-4 my-8 rounded-2xl bg-danger-soft p-5 text-center" role="alert">
      <p className="text-sm text-danger">{message}</p>
      {onRetry && (
        <Button variant="ghost" size="sm" className="mt-3" onClick={onRetry}>
          ลองใหม่
        </Button>
      )}
    </div>
  );
}

export function EmptyState({ title, children, icon = "🌱" }: { title: string; children?: ReactNode; icon?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <div className="text-4xl" aria-hidden>
        {icon}
      </div>
      <p className="font-semibold text-ink">{title}</p>
      {children && <div className="text-sm text-ink-muted">{children}</div>}
    </div>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cx("rounded-2xl bg-white p-4 shadow-sm", className)}>{children}</section>;
}

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: ReactNode;
  suffix?: ReactNode;
}

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, error, hint, suffix, className, id, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className={className}>
      <label htmlFor={inputId} className="mb-1 block text-sm font-medium text-ink">
        {label}
      </label>
      <div className="relative">
        <input
          ref={ref}
          id={inputId}
          aria-invalid={!!error || undefined}
          aria-describedby={error ? `${inputId}-err` : hint ? `${inputId}-hint` : undefined}
          className={cx(
            "w-full rounded-xl border bg-surface-input px-4 py-3 text-ink placeholder:text-ink-muted/70 focus:border-primary focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30",
            error ? "border-danger" : "border-transparent",
            suffix ? "pr-14" : "",
          )}
          {...rest}
        />
        {suffix && <span className="absolute inset-y-0 right-4 flex items-center text-sm text-ink-muted">{suffix}</span>}
      </div>
      {error ? (
        <p id={`${inputId}-err`} className="mt-1 text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="mt-1 text-xs text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
});

type Tone = "neutral" | "primary" | "success" | "warn" | "danger";
const tones: Record<Tone, string> = {
  neutral: "bg-gray-100 text-gray-600",
  primary: "bg-primary-soft text-primary",
  success: "bg-success-soft text-success",
  warn: "bg-warn-soft text-amber-700",
  danger: "bg-danger-soft text-danger",
};

export function Chip({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cx("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", tones[tone])}>
      {children}
    </span>
  );
}

export function Avatar({ name, src, size = 40 }: { name: string; src?: string | null; size?: number }) {
  const initials = name.trim().slice(0, 2) || "?";
  return src ? (
    <img src={src} alt="" width={size} height={size} className="shrink-0 rounded-2xl object-cover" style={{ width: size, height: size }} />
  ) : (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-2xl bg-primary-soft font-semibold text-primary"
      style={{ width: size, height: size, fontSize: size / 2.8 }}
    >
      {initials}
    </span>
  );
}

export function LinkButton({ to, children, variant = "primary", block }: { to: string; children: ReactNode; variant?: Variant; block?: boolean }) {
  return (
    <Link
      to={to}
      className={cx(
        "inline-flex items-center justify-center rounded-xl px-5 py-3 font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        variants[variant],
        block && "w-full",
      )}
    >
      {children}
    </Link>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 mt-6 flex items-center justify-between px-1">
      <h2 className="text-lg font-semibold text-ink">{children}</h2>
      {action}
    </div>
  );
}

export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
      <span className="text-ink-muted">{label}</span>
      <span className="text-right font-medium text-ink">{children}</span>
    </div>
  );
}
