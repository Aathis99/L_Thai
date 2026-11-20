import { useCallback, useEffect, useRef, useState } from "react";
import { count, formText, timestamp } from "../../lib/pressing";
import { meshCompletionLines, type MeshEntry, type MeshOrder, type MeshState } from "../../lib/tile-catalog";
import type { Api, SessionUser } from "../../lib/types";
import { Field } from "../fields";
import { Card, Facts, FormDialog, Section } from "../pressing/shared";

type Editor = { kind: "complete"; order: MeshOrder } | { kind: "void"; entry: MeshEntry };

export default function MeshPanel({ api, user, refreshToken, onChanged }: {
  api: Api; user: SessionUser; refreshToken: unknown; onChanged: () => Promise<void>;
}) {
  const [data, setData] = useState<MeshState>();
  const [editor, setEditor] = useState<Editor>();
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const latest = useRef(0);
  const canRecord = user.permissions.includes("finishing.allocate");
  const canReverse = user.permissions.includes("finishing.correct");

  const refresh = useCallback(async () => {
    const version = ++latest.current;
    setError("");
    try {
      const result = await api<MeshState>("/finishing/mesh");
      if (latest.current === version) setData(result);
    } catch (cause) {
      if (latest.current === version) setError(cause instanceof Error ? cause.message : "โหลดงานติดตาข่ายไม่สำเร็จ");
    }
  }, [api]);

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => { latest.current++; window.removeEventListener("focus", onFocus); };
  }, [refresh, refreshToken]);

  const reload = async () => { await Promise.all([refresh(), onChanged()]); };
  return <>
    <Section title="งานติดตาข่ายหลัง QC" action={<button className="button secondary" onClick={() => void refresh()}>โหลดงานติดตาข่ายใหม่</button>}>
      <p className="helper">นับเป็นแผ่นกระเบื้องย่อย กันยอดผ่าน QC ให้ออเดอร์ก่อน แล้วบันทึกจำนวนที่ติดตาข่ายเสร็จตามต้นทางและเกรด</p>
      {error && <p className="error-banner" role="alert">{error}</p>}
      <p role="status">{status || (!data && !error ? "กำลังโหลดงานติดตาข่าย…" : "")}</p>
      {data && !data.orders.length && <p>ยังไม่มีออเดอร์สินค้าติดตาข่าย</p>}
      <div className="pressing-cards">{data?.orders.map(order => <Card key={order.id}
        title={`ใบสั่ง #${order.id} · ${order.customer_reference}`}
        actions={canRecord && order.lines.some(line => line.available_pieces > 0) &&
          <button className="button success" onClick={() => setEditor({ kind: "complete", order })}>บันทึกติดตาข่ายเสร็จ</button>}>
        <p>{order.product_code && `${order.product_code} · `}{order.product_name}</p>
        <Facts values={{ "ยอดออเดอร์ (แผ่น)": count(order.customer_pieces), "กันจาก QC (แผ่น)": count(order.allocated_pieces),
          "รอติดตาข่าย (แผ่น)": count(order.waiting_pieces), "ติดเสร็จ (แผ่น)": count(order.completed_pieces), "พร้อมส่ง (แผ่น)": count(order.ready_pieces) }} />
      </Card>)}</div>
    </Section>
    <Section title="ประวัติติดตาข่าย">
      {data && !data.entries.length && <p>ยังไม่มีรายการติดตาข่าย</p>}
      <div className="pressing-cards">{data?.entries.map(entry => <Card key={entry.id}
        title={`ติดตาข่าย #${entry.id} · ใบสั่ง #${entry.order_id} · ${count(entry.pieces)} แผ่น`}
        meta={entry.voided_at && <span className="badge neutral">ย้อนแล้ว</span>}
        actions={canReverse && !entry.voided_at && <button className="button warning"
          onClick={() => setEditor({ kind: "void", entry })}>ย้อนรายการติดตาข่าย</button>}>
        <p>{entry.recorded_by_username && `${entry.recorded_by_username} · `}{timestamp(entry.recorded_at)}</p>
        {entry.voided_at && <p>ย้อนเมื่อ {timestamp(entry.voided_at)}{entry.reason && ` · ${entry.reason}`}</p>}
      </Card>)}</div>
    </Section>
    {editor?.kind === "complete" && canRecord && <FormDialog api={api} scope="finishing" path="/mesh" keyField="request_id"
      title="บันทึกติดตาข่ายเสร็จ" submitLabel="ยืนยันจำนวนติดเสร็จ" onClose={() => setEditor(undefined)} onStale={reload}
      onSaved={async () => { setStatus("บันทึกติดตาข่ายแล้ว"); await reload(); }}
      build={form => ({ order_id: editor.order.id, lines: meshCompletionLines(form, editor.order.lines) })}>
      <p>ใบสั่ง #{editor.order.id} · {editor.order.customer_reference} · {editor.order.product_name}</p>
      <p className="helper">เลือกบันทึกเฉพาะต้นทางที่ติดเสร็จ เว้นว่างหรือใส่ 0 สำหรับต้นทางที่ยังไม่ติด</p>
      {editor.order.lines.map((line, index) => line.available_pieces > 0 && <Field key={line.key} name={`line_${index}`}
        label={`${line.source === "workflow" ? "งานเตาปัจจุบัน" : "งานเดิม"} · ผล QC #${line.qc_id} · จัดสรร #${line.allocation_id} · เกรด ${line.grade ?? "ข้อมูลเดิม"} · เหลือ ${count(line.available_pieces)} แผ่น`}
        type="number" min={0} max={line.available_pieces} step={1} defaultValue={0} />)}
    </FormDialog>}
    {editor?.kind === "void" && canReverse && <FormDialog api={api} scope="finishing" path={`/mesh/${editor.entry.id}/void`} keyField="request_id"
      title="ย้อนรายการติดตาข่าย" intent="warning" submitLabel="ยืนยันย้อนรายการ" onClose={() => setEditor(undefined)} onStale={reload}
      onSaved={async () => { setStatus("ย้อนรายการติดตาข่ายแล้ว"); await reload(); }} build={form => ({ reason: formText(form, "reason") })}>
      <p>รายการติดตาข่าย #{editor.entry.id} · ใบสั่ง #{editor.entry.order_id} · {count(editor.entry.pieces)} แผ่น</p>
      <Field name="reason" label="เหตุผลที่ย้อนรายการ" required />
    </FormDialog>}
  </>;
}
