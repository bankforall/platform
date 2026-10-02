import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import {
  CircleType,
  LEGAL_CAPS,
  createCircleSchema,
  needsBidding,
  simulateCircle,
  type CircleRules,
} from "@bankforall/shared";
import { api, type CreateCircleRequest } from "@/api/endpoints";
import { useIntent } from "@/hooks/useIntent";
import { useMe } from "@/hooks/session";
import { Header, Screen } from "@/components/layout";
import { SeatPicker } from "@/components/SeatPicker";
import { Button, Card, Field, cx } from "@/components/ui";
import { baht, duration, parseBaht } from "@/lib/format";

const H = 3600;
const D = 86400;

const PERIODS = [
  { id: "daily", label: "รายวัน", period: D, bid: 4 * H, reveal: 2 * H, pay: 8 * H, grace: 4 * H },
  { id: "weekly", label: "รายสัปดาห์", period: 7 * D, bid: D, reveal: 12 * H, pay: 2 * D, grace: D },
  { id: "biweekly", label: "ทุก 2 สัปดาห์", period: 14 * D, bid: 2 * D, reveal: D, pay: 3 * D, grace: D },
  { id: "monthly", label: "รายเดือน", period: 30 * D, bid: 2 * D, reveal: D, pay: 5 * D, grace: 2 * D },
] as const;
type PeriodId = (typeof PERIODS)[number]["id"];
interface Windows {
  period: number;
  bid: number;
  reveal: number;
  pay: number;
  grace: number;
}

const TYPES = [
  { type: CircleType.Fix, title: "เลือกที่นั่ง (Fix)", body: "จองลำดับรับเงินล่วงหน้า ที่นั่งแรกจ่ายมาก ที่นั่งท้ายจ่ายน้อย" },
  { type: CircleType.Float, title: "ประมูลดอกตาม (Float)", body: "ผู้เสนอดอกสูงสุดได้รับ แล้วจ่ายเงินต้น + ดอกทุกงวดที่เหลือ" },
  { type: CircleType.Discount, title: "ประมูลดอกหัก (Discount)", body: "ผู้เสนอส่วนลดสูงสุดได้รับ คนที่ยังไม่ได้รับจ่ายน้อยลง" },
];

export default function CreateCircle() {
  const me = useMe().data!;
  const { run } = useIntent();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<CircleType>(CircleType.Float);
  const [principalText, setPrincipalText] = useState("1000");
  const [maxMembers, setMaxMembers] = useState(5);
  const [fixRate, setFixRate] = useState(10);
  const [hostTakesFirst, setHostTakesFirst] = useState(true);
  const [hostSeat, setHostSeat] = useState<number | null>(0);
  const [periodId, setPeriodId] = useState<PeriodId>("monthly");
  const [windows, setWindows] = useState<Windows>(() => ({ ...PERIODS[3] }));
  const [isPrivate, setIsPrivate] = useState(true);
  const [minReputation, setMinReputation] = useState(0);
  const [exampleBidText, setExampleBidText] = useState("50");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const principal = parseBaht(principalText);
  const isFix = type === CircleType.Fix;

  const body: CreateCircleRequest | null =
    principal === null
      ? null
      : {
          name: name.trim(),
          description: description.trim() || undefined,
          type,
          principal: principal.toString(),
          maxMembers,
          hostTakesFirst: isFix ? false : hostTakesFirst,
          fixRateBps: isFix ? Math.round(fixRate * 100) : 0,
          minReputation,
          period: windows.period,
          bidWindow: windows.bid,
          revealWindow: windows.reveal,
          paymentWindow: windows.pay,
          grace: windows.grace,
          private: isPrivate,
          hostSeat: isFix ? (hostSeat ?? 0) : 0,
        };

  const errors = useMemo(() => {
    const out: Record<string, string> = {};
    if (principal === null) out.principal = "จำนวนเงินไม่ถูกต้อง";
    if (!body) return out;
    const r = createCircleSchema.safeParse(body);
    if (!r.success) for (const i of r.error.issues) out[String(i.path[0] ?? "form")] ??= i.message;
    if (isFix && hostSeat === null) out.hostSeat = "เลือกที่นั่งของคุณ";
    return out;
  }, [body, principal, isFix, hostSeat]);

  const rules: CircleRules | null = principal
    ? { type, principal, maxMembers, hostTakesFirst: isFix ? false : hostTakesFirst, fixRateBps: isFix ? Math.round(fixRate * 100) : 0 }
    : null;
  const exampleBid = parseBaht(exampleBidText) ?? 0n;
  const preview = useMemo(() => {
    if (!rules || maxMembers < 2 || maxMembers > LEGAL_CAPS.maxMembers) return null;
    const members = Array.from({ length: maxMembers }, (_, i) => i);
    const seats = isFix ? members.map((m) => (m === 0 ? (hostSeat ?? 0) : m <= (hostSeat ?? 0) ? m - 1 : m)) : undefined;
    const bids = members.map((_, r) => (needsBidding(rules, r + 1) ? members.map((m) => ({ member: m, amount: exampleBid })) : []));
    try {
      return { rounds: simulateCircle(rules, members.map(() => 0), bids, seats), seats };
    } catch {
      return null;
    }
  }, [rules?.type, rules?.principal, rules?.maxMembers, rules?.hostTakesFirst, rules?.fixRateBps, exampleBid, hostSeat, isFix]);

  const canSubmit = Object.keys(errors).length === 0 && !!body && me.kycStatus === "APPROVED";

  const submit = async () => {
    if (!body || !canSubmit) return;
    const res = await run({
      title: "สร้างวงแชร์",
      prepare: () => api.prepareCreate(body),
      successMessage: `สร้างวง ${body.name} แล้ว ส่งรหัสเชิญให้สมาชิกได้เลย`,
    });
    if (res?.status === "CONFIRMED" && res.circleId) navigate(`/circles/${res.circleId}`, { replace: true });
  };

  const choosePeriod = (id: PeriodId) => {
    setPeriodId(id);
    setWindows({ ...PERIODS.find((p) => p.id === id)! });
  };

  return (
    <Screen>
      <Header title="สร้างวงแชร์" back="/circles" />
      <main className="space-y-5 px-4 py-5">
        {me.kycStatus !== "APPROVED" && (
          <p className="rounded-xl bg-warn-soft p-3 text-sm text-amber-800">ต้องยืนยันตัวตนผ่านก่อนจึงสร้างวงได้</p>
        )}

        <Card className="space-y-4">
          <Field label="ชื่อวง" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} error={name ? errors.name : undefined} placeholder="เช่น วงบ้านหมอนทอง" />
          <div>
            <label htmlFor="desc" className="mb-1 block text-sm font-medium text-ink">
              รายละเอียด (ไม่บังคับ)
            </label>
            <textarea
              id="desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              rows={2}
              className="w-full rounded-xl bg-surface-input px-4 py-3 text-ink focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-primary/30"
            />
          </div>
        </Card>

        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-semibold text-ink">ประเภทวง</legend>
          {TYPES.map((t) => (
            <label
              key={t.type}
              className={cx(
                "flex cursor-pointer gap-3 rounded-2xl border-2 bg-white p-4 focus-within:ring-2 focus-within:ring-primary",
                type === t.type ? "border-primary" : "border-transparent shadow-xs",
              )}
            >
              <input type="radio" name="type" className="mt-1 accent-primary" checked={type === t.type} onChange={() => setType(t.type)} />
              <span>
                <span className="block font-medium text-ink">{t.title}</span>
                <span className="block text-sm text-ink-muted">{t.body}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <Card className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="เงินต่องวด"
              inputMode="decimal"
              value={principalText}
              onChange={(e) => setPrincipalText(e.target.value.replace(/[^\d.,]/g, ""))}
              suffix="บาท"
              error={errors.principal}
            />
            <Field
              label={`จำนวนมือ (2–${LEGAL_CAPS.maxMembers})`}
              type="number"
              min={2}
              max={LEGAL_CAPS.maxMembers}
              value={maxMembers}
              onChange={(e) => {
                const n = Math.floor(Number(e.target.value));
                setMaxMembers(n);
                if (hostSeat !== null && hostSeat >= n) setHostSeat(0);
              }}
              error={errors.maxMembers}
            />
          </div>
          {principal !== null && (
            <p className="text-sm text-ink-muted">
              กองกลางต่องวด <strong className="text-ink">{baht(principal * BigInt(Math.max(maxMembers, 0)))} บาท</strong> (เพดานตามกฎหมาย{" "}
              {baht(LEGAL_CAPS.maxPoolValue)} บาท)
            </p>
          )}

          {isFix ? (
            <Field
              label="ส่วนต่างที่นั่งแรก/ท้าย (±%)"
              type="number"
              min={0}
              max={50}
              step={0.5}
              value={fixRate}
              onChange={(e) => setFixRate(Number(e.target.value))}
              hint="ที่นั่งแรกจ่ายมากกว่าเงินต้น % นี้ ที่นั่งท้ายจ่ายน้อยกว่า % นี้"
              error={errors.fixRateBps}
            />
          ) : (
            <label className="flex items-center gap-3 text-sm text-ink">
              <input type="checkbox" className="h-5 w-5 accent-primary" checked={hostTakesFirst} onChange={(e) => setHostTakesFirst(e.target.checked)} />
              นายวงรับงวดแรกโดยไม่ต้องประมูล (มือนายวง)
            </label>
          )}
        </Card>

        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-ink">ความถี่</legend>
          <div className="grid grid-cols-2 gap-2">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={periodId === p.id}
                onClick={() => choosePeriod(p.id)}
                className={cx(
                  "rounded-xl py-3 text-sm font-medium",
                  periodId === p.id ? "bg-primary text-white" : "bg-white text-ink shadow-xs",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button type="button" className="mt-2 text-sm text-primary underline" onClick={() => setShowAdvanced((v) => !v)} aria-expanded={showAdvanced}>
            {showAdvanced ? "ซ่อนการตั้งเวลา" : "ปรับช่วงเวลาประมูล/ชำระ"}
          </button>
          {showAdvanced && (
            <Card className="mt-2 grid grid-cols-2 gap-3">
              {(
                [
                  ["bid", "ยื่นซอง (ชม.)"],
                  ["reveal", "เปิดซอง (ชม.)"],
                  ["pay", "ชำระเงิน (ชม.)"],
                  ["grace", "ผ่อนผัน (ชม.)"],
                ] as const
              ).map(([k, label]) => (
                <Field
                  key={k}
                  label={label}
                  type="number"
                  min={k === "grace" ? 0 : 1}
                  value={windows[k] / H}
                  onChange={(e) => setWindows((w) => ({ ...w, [k]: Math.round(Number(e.target.value) * H) }))}
                />
              ))}
              {errors.period && <p className="col-span-2 text-sm text-danger">{errors.period}</p>}
            </Card>
          )}
          <p className="mt-2 text-xs text-ink-muted">
            แต่ละงวด: ยื่นซอง {duration(windows.bid)} → เปิดซอง {duration(windows.reveal)} → ชำระ {duration(windows.pay)} → ผ่อนผัน {duration(windows.grace)}
          </p>
        </fieldset>

        {isFix && principal !== null && maxMembers >= 2 && maxMembers <= LEGAL_CAPS.maxMembers && (
          <SeatPicker principal={principal} maxMembers={maxMembers} fixRateBps={Math.round(fixRate * 100)} taken={[]} value={hostSeat} onChange={setHostSeat} />
        )}

        <Card className="space-y-3">
          <label className="flex items-center gap-3 text-sm text-ink">
            <input type="checkbox" className="h-5 w-5 accent-primary" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
            วงส่วนตัว — เข้าได้ด้วยรหัสเชิญเท่านั้น
          </label>
          <Field
            label="คะแนนความน่าเชื่อถือขั้นต่ำของสมาชิก"
            type="number"
            min={0}
            max={1000}
            value={minReputation}
            onChange={(e) => setMinReputation(Math.max(0, Math.floor(Number(e.target.value))))}
          />
        </Card>

        {preview && (
          <section aria-labelledby="preview-title">
            <h2 id="preview-title" className="mb-2 text-sm font-semibold text-ink">
              ตัวอย่างตารางรับ-จ่าย
            </h2>
            {!isFix && (
              <Field
                label="สมมติผู้ชนะทุกงวดเสนอ (บาท)"
                inputMode="decimal"
                value={exampleBidText}
                onChange={(e) => setExampleBidText(e.target.value.replace(/[^\d.]/g, ""))}
                className="mb-2"
              />
            )}
            <div className="overflow-x-auto rounded-2xl bg-white shadow-xs">
              <table className="w-full text-sm">
                <thead className="bg-primary-soft text-left text-xs text-ink">
                  <tr>
                    <th className="px-3 py-2">งวด</th>
                    <th className="px-3 py-2">ผู้รับ</th>
                    <th className="px-3 py-2 text-right">จ่ายต่อคน</th>
                    <th className="px-3 py-2 text-right">ได้รับ</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rounds.map((r) => {
                    const pays = r.dues.filter((_, i) => i !== r.recipient);
                    const min = pays.reduce((a, b) => (b < a ? b : a), pays[0] ?? 0n);
                    const max = pays.reduce((a, b) => (b > a ? b : a), 0n);
                    return (
                      <tr key={r.round} className="border-t border-gray-100">
                        <td className="px-3 py-2">{r.round}</td>
                        <td className="px-3 py-2">{r.recipient === 0 ? "คุณ (นายวง)" : `สมาชิก ${r.recipient + 1}`}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{min === max ? baht(min) : `${baht(min)}–${baht(max)}`}</td>
                        <td className="px-3 py-2 text-right font-medium tabular-nums">{baht(r.payout)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-1 text-xs text-ink-muted">"ได้รับ" คือยอดที่สมาชิกคนอื่นโอนให้ผู้รับในงวดนั้น</p>
          </section>
        )}

        {errors.form && <p className="text-sm text-danger">{errors.form}</p>}
        {errors.hostSeat && isFix && <p className="text-sm text-danger">{errors.hostSeat}</p>}
        <Button block disabled={!canSubmit} onClick={() => void submit()}>
          สร้างวง
        </Button>
        <p className="text-center text-xs text-ink-muted">
          นายวงหนึ่งคนเปิดวงพร้อมกันได้ไม่เกิน {LEGAL_CAPS.maxActiveCirclesPerHost} วง ตาม พ.ร.บ.การเล่นแชร์
        </p>
      </main>
    </Screen>
  );
}
