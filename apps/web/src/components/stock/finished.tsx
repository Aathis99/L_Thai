import { useCallback, useEffect, useRef, useState } from "react";
import { finishingTileName, type FinishingTile } from "../../lib/finishing";
import { count, formInteger, formText, timestamp } from "../../lib/pressing";
import { finishedStockTotals } from "../../lib/stock";
import type { Api } from "../../lib/types";
import { Field } from "../fields";
import { Card, Facts, FormDialog, Section } from "../pressing/shared";

type FinishedItem = { type_id: number; clay: string; color_name: string | null;grade?:string|null };
type Candidate = FinishedItem & { id: number; round_id: number; stock_available: number; voided_at: string | null };
type Receipt = FinishedItem & { id: number; qc_id: number; color_id: number | null; pieces: number;
  recorded_by_username: string; recorded_at: string; voided_at: string | null;workflow?:boolean };
type Editor = { kind: "receive"; item: Candidate } | { kind: "reverse"; item: Receipt };

export default function FinishedStock({ api, canManage }: { api: Api; canManage: boolean }) {
  const [data, setData] = useState<{ types: FinishingTile[]; qc: Candidate[]; receipts: Receipt[] }>();
  const [editor, setEditor] = useState<Editor>();
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    const version = ++latest.current;
    setError("");
    const list = async <T,>(resource: string) => (await api<{ items: T[] }>(`/finishing/${resource}`)).items;
    try {
      const [types, qc, receipts] = await Promise.all([
        list<FinishingTile>("types"), list<Candidate>("qc"), list<Receipt>("stock"),
      ]);
      if (version === latest.current) setData({ types, qc, receipts });
    } catch (cause) {
      if (version === latest.current) setError(cause instanceof Error ? cause.message : "โหลดสต็อกสินค้าสำเร็จไม่สำเร็จ");
    }
  }, [api]);

  useEffect(() => {
    const onFocus = () => void refresh();
    void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      latest.current++;
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const pending = data?.qc.filter(item => !item.voided_at && item.stock_available > 0) ?? [];
  const totals = finishedStockTotals(data?.receipts ?? []);
  const tile = (item: FinishedItem) => finishingTileName(data?.types ?? [], item.type_id, item.clay);
  const receiving = editor?.kind === "receive";

  return <div className="pressing-stack">
    <div className="pressing-navigation">
      <button className="button secondary" onClick={() => void refresh()}>โหลดรายการใหม่</button>
    </div>
    {error && <p className="error-banner" role="alert">{error}</p>}
    <p role="status">{status || (!data && !error ? "กำลังโหลดสต็อกสินค้าสำเร็จ…" : "")}</p>
    {data && <>
      <Section title="รอรับเข้าสินค้าสำเร็จ">
        {!pending.length && <p>ยังไม่มีแผ่นดีส่วนเกินที่พร้อมรับเข้า</p>}
        <div className="pressing-cards">{pending.map(item => <Card key={item.id}
          title={`ผลคัด #${item.id} · รอบเผา #${item.round_id}`}
          actions={canManage && <button className="button success" onClick={() => setEditor({ kind: "receive", item })}>
            ยืนยันรับเข้าสต็อก
          </button>}>
          <p>{tile(item)} · {item.color_name ?? "บรีส"}</p>
          <Facts values={{ "ส่วนเกินพร้อมรับเข้า (แผ่น)": count(item.stock_available) }} />
        </Card>)}</div>
      </Section>
      <Section title="สต็อกสินค้าสำเร็จ">
        {!totals.length && <p>ยังไม่มียอดสินค้าสำเร็จ</p>}
        <div className="pressing-cards">{totals.map(item => <Card key={item.id} title={tile(item)}>
          <p>{item.color_name ?? "บรีส"} · เกรด {item.grade??'ยังไม่ระบุ (ข้อมูลเดิม)'}</p>
          <Facts values={{ "ยอดรับเข้าสุทธิ (แผ่น)": count(item.pieces) }} />
        </Card>)}</div>
      </Section>
      <Section title="ประวัติรับเข้าสินค้าสำเร็จ">
        {!data.receipts.length && <p>ยังไม่มีรายการรับเข้า</p>}
        <div className="pressing-cards">{data.receipts.map(item => <Card key={item.id}
          title={`${item.workflow?'งานเตา · ':''}รับเข้า #${Math.abs(item.id)} · ${count(item.pieces)} แผ่น`}
          meta={item.voided_at && <span className="badge neutral">ย้อนแล้ว</span>}
          actions={!item.workflow && !item.voided_at && canManage && <button className="button warning" onClick={() => setEditor({ kind: "reverse", item })}>
            ย้อนรายการรับเข้า
          </button>}>
          <p>{tile(item)} · {item.color_name ?? "บรีส"} · ผลคัด #{item.qc_id}</p>
          <p>เกรด {item.grade??'ยังไม่ระบุ (ข้อมูลเดิม)'}{item.workflow?' · ปรับยอดรายการนี้ที่งานเตา → รอบเผาและไฟ → แก้ยอด':''}</p>
          <p>{item.recorded_by_username} · {timestamp(item.recorded_at)}</p>
        </Card>)}</div>
      </Section>
    </>}
    {editor && canManage && <FormDialog api={api} scope="finishing" keyField="request_id"
      title={receiving ? "ยืนยันรับเข้าสต็อก" : "ย้อนรายการรับเข้า"}
      path={receiving ? "/stock" : "/stock-void"} intent={receiving ? "success" : "warning"} submitLabel="ยืนยันบันทึก"
      build={form => receiving
        ? { qc_id: editor.item.id, pieces: formInteger(form, "pieces", "จำนวนแผ่น", 1) }
        : { receipt_id: editor.item.id, reason: formText(form, "reason") }}
      onClose={() => setEditor(undefined)} onStale={refresh} onSaved={async () => {
        setStatus("บันทึกแล้ว");
        await refresh();
      }}>
      {editor.kind === "receive"
        ? <Field name="pieces" label="จำนวนที่ตรวจแล้ว (แผ่น)" type="number" min={1} max={editor.item.stock_available} step={1} required />
        : <><p>รายการ #{editor.item.id}</p><Field name="reason" label="เหตุผล" required /></>}
    </FormDialog>}
  </div>;
}
