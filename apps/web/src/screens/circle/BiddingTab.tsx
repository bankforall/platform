import { useState } from "react";
import { CircleType, bidHash, maxBid, type CircleRules } from "@bankforall/shared";
import { api } from "@/api/endpoints";
import { useIntent } from "@/hooks/useIntent";
import { Avatar, Button, Card, Chip, Field, KeyValue, SectionTitle } from "@/components/ui";
import { Countdown, useNow } from "@/components/widgets";
import { baht, dateTime, parseBaht, sameAddress } from "@/lib/format";
import { randomBytes, toHex } from "@/wallet/crypto";
import { currentRound, memberByAddress, nameOf } from "./common";
import type { TabProps } from "./CircleDetail";

export default function BiddingTab({ circle, myAddress }: TabProps) {
  const { run } = useIntent();
  const now = useNow();
  const [amountText, setAmountText] = useState("");
  const round = currentRound(circle);
  const me = memberByAddress(circle, myAddress);
  const isDiscount = circle.type === CircleType.Discount;
  const rules: CircleRules = {
    type: circle.type,
    principal: BigInt(circle.principal),
    maxMembers: circle.maxMembers,
    hostTakesFirst: circle.hostTakesFirst,
    fixRateBps: circle.fixRateBps,
  };

  if (circle.type === CircleType.Fix) {
    return <Card><p className="text-sm text-ink-muted">วงแบบเลือกที่นั่งไม่มีการประมูล ผู้รับแต่ละงวดเป็นไปตามลำดับที่นั่ง</p></Card>;
  }
  if (circle.status !== "ACTIVE" || !round) {
    return <Card><p className="text-sm text-ink-muted">{circle.status === "OPEN" ? "การประมูลจะเริ่มหลังนายวงเริ่มวง" : "วงนี้ไม่มีการประมูลแล้ว"}</p></Card>;
  }

  const committed = round.committed.some((a) => sameAddress(a, myAddress));
  const eligible = !!me && !me.hasWon && !me.defaulted;
  const phase = !round.bidding
    ? "none"
    : round.decided
      ? "decided"
      : round.biddingEnds && now < round.biddingEnds
        ? "commit"
        : round.revealEnds && now < round.revealEnds
          ? "reveal"
          : "closing";

  const amount = parseBaht(amountText);
  const cap = maxBid(rules);
  const amountError = amount === null ? (amountText ? "จำนวนเงินไม่ถูกต้อง" : undefined) : amount > cap ? `สูงสุด ${baht(cap)} บาท` : undefined;
  const remaining = circle.maxMembers - circle.currentRound;

  const submit = async () => {
    if (amount === null || amountError || !myAddress || !circle.address) return;
    const salt = toHex(randomBytes(32));
    const hash = bidHash(circle.address as `0x${string}`, round.number, myAddress, amount, salt);
    const res = await run({
      title: "ยื่นซองประมูล",
      prepare: () => api.prepareBid(circle.id, hash),
      expect: { kind: "commitBid", circle: circle.address, bidHash: hash },
      display: { circleName: circle.name, bidAmount: amount.toString() },
      bid: { amount: amount.toString(), salt },
      successMessage: "ยื่นซองแล้ว ระบบจะเปิดซองให้อัตโนมัติเมื่อถึงเวลา",
    });
    if (res?.status === "CONFIRMED") setAmountText("");
  };

  const unwon = circle.members.filter((m) => !m.hasWon || sameAddress(m.address, round.recipient));

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-ink">งวดที่ {round.number}</h3>
          {phase === "commit" && <Chip tone="primary">เปิดยื่นซอง</Chip>}
          {phase === "reveal" && <Chip tone="warn">กำลังเปิดซอง</Chip>}
          {phase === "closing" && <Chip tone="warn">กำลังสรุปผล</Chip>}
          {(phase === "decided" || phase === "none") && <Chip tone="success">ได้ผู้รับแล้ว</Chip>}
        </div>
        {phase === "none" && (
          <p className="mt-2 text-sm text-ink-muted">
            งวดนี้ไม่มีการประมูล ({round.number === 1 && circle.hostTakesFirst ? "มือนายวง" : "งวดสุดท้าย"}) — ผู้รับคือ{" "}
            <strong className="text-ink">{round.recipientName ?? nameOf(circle, round.recipient)}</strong>
          </p>
        )}
        {phase === "commit" && (
          <p className="mt-2 text-sm text-ink-muted">
            ปิดรับซองใน <strong className="text-ink"><Countdown to={round.biddingEnds} /></strong> ({dateTime(round.biddingEnds)})
          </p>
        )}
        {phase === "reveal" && (
          <p className="mt-2 text-sm text-ink-muted">
            ประกาศผลใน <strong className="text-ink"><Countdown to={round.revealEnds} /></strong>
          </p>
        )}
        {phase === "decided" && (
          <p className="mt-2 text-sm text-ink-muted">
            ผู้ชนะ: <strong className="text-ink">{round.recipientName ?? nameOf(circle, round.recipient)}</strong> ด้วย
            {isDiscount ? "ส่วนลด" : "ดอก"} {baht(round.winningBid)} บาท
          </p>
        )}
      </Card>

      {phase === "commit" && eligible && !committed && (
        <Card className="space-y-4">
          <h3 className="font-semibold text-ink">ยื่นซองของฉัน</h3>
          <p className="text-sm text-ink-muted">
            เสนอ{isDiscount ? "ส่วนลด" : "ดอก"}ที่คุณยอม{isDiscount ? "ให้" : "จ่าย"} ผู้เสนอสูงสุดได้รับเงินกองกลางงวดนี้ ไม่มีใครเห็นราคาจนกว่าจะเปิดซอง
            และยื่นได้ครั้งเดียว
          </p>
          <Field
            label={isDiscount ? "ส่วนลด (บาท)" : "ดอกต่องวด (บาท)"}
            inputMode="decimal"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value.replace(/[^\d.]/g, ""))}
            className="[&_input]:text-center [&_input]:text-3xl [&_input]:font-semibold"
            error={amountError}
            placeholder="0"
          />
          {amount !== null && !amountError && (
            <div className="rounded-xl bg-surface p-3">
              <KeyValue label="เงินต้นต่องวด">{baht(circle.principal)} บาท</KeyValue>
              {isDiscount ? (
                <>
                  <KeyValue label="ถ้าชนะ คุณได้รับประมาณ">
                    {baht((BigInt(circle.principal) - amount) * BigInt(circle.maxMembers - 1))} บาทขึ้นไป
                  </KeyValue>
                  <KeyValue label="งวดที่เหลือคุณจ่าย">{baht(circle.principal)} บาท/งวด</KeyValue>
                </>
              ) : (
                <>
                  <KeyValue label="ถ้าชนะ งวดถัดไปคุณจ่าย">{baht(BigInt(circle.principal) + amount)} บาท/งวด</KeyValue>
                  <KeyValue label="ดอกรวม">
                    {baht(amount * BigInt(remaining))} บาท ({remaining} งวด)
                  </KeyValue>
                </>
              )}
            </div>
          )}
          <Button block disabled={amount === null || !!amountError} onClick={() => void submit()}>
            ยื่นซอง
          </Button>
        </Card>
      )}
      {phase === "commit" && committed && (
        <Card className="bg-success-soft">
          <p className="text-sm font-medium text-success">คุณยื่นซองแล้ว ✓ ระบบจะเปิดซองให้อัตโนมัติเมื่อถึงเวลา</p>
        </Card>
      )}
      {phase === "commit" && me && !eligible && (
        <Card>
          <p className="text-sm text-ink-muted">{me.defaulted ? "คุณมีสถานะผิดนัดจึงประมูลไม่ได้" : "คุณได้รับเงินกองกลางแล้ว จึงไม่ต้องประมูลอีก"}</p>
        </Card>
      )}

      {round.bidding && (
        <>
          <SectionTitle>ผู้มีสิทธิ์ประมูล</SectionTitle>
          <ul className="divide-y divide-gray-100 rounded-2xl bg-white shadow-xs">
            {unwon.map((m) => {
              const did = round.committed.some((a) => sameAddress(a, m.address));
              const revealed = round.revealed.find((r) => sameAddress(r.member, m.address));
              return (
                <li key={m.address} className="flex items-center gap-3 p-3">
                  <Avatar name={m.displayName} src={m.pictureUrl} size={36} />
                  <span className="flex-1 truncate text-sm font-medium text-ink">
                    {m.displayName}
                    {sameAddress(m.address, myAddress) && " (คุณ)"}
                  </span>
                  {revealed ? (
                    <Chip tone={sameAddress(round.recipient, m.address) ? "success" : "neutral"}>{baht(revealed.amount)} บาท</Chip>
                  ) : did ? (
                    <Chip tone="success">ยื่นซองแล้ว</Chip>
                  ) : m.defaulted ? (
                    <Chip tone="danger">ผิดนัด</Chip>
                  ) : (
                    <Chip>รอยื่นซอง</Chip>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
