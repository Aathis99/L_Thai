import { useState } from "react";
import {
  bangkokDate, count, entryFormValues, formInteger, formText, orderName, pressingEntryPayload, tileName, timestamp, workerName,
  type EntryCorrection, type EntryValues, type PressingData, type PressingEntry,
} from "../../lib/pressing";
import { Field } from "../fields";
import { Card, Choice, Facts, FormDialog, HistoryDialog, Section, type PressingActions } from "./shared";

type Editor =
  | { kind: "record" }
  | { kind: "edit" | "adjust" | "history"; entry: PressingEntry };

export default function Production({ data, actions }: { data: PressingData; actions: PressingActions }) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [filter, setFilter] = useState("");
  const canRecord = actions.can("pressing.record");
  const canCorrect = actions.can("pressing.correct");
  const activeOrders = data.orders.filter((order) => data.types.some((tile) => tile.id === order.type_id && tile.active));
  const entries = filter ? data.entries.filter((entry) => entry.order_id === Number(filter)) : data.entries;
  const close = () => setEditor(null);
  const dialog = { api: actions.api, onSaved: actions.onSaved, onClose: close };

  return (
    <Section title="รายการปั๊ม" action={canRecord && (
      <button className="button primary" disabled={!activeOrders.length || !data.workers.length} onClick={() => setEditor({ kind: "record" })}>
        บันทึกยอดปั๊ม
      </button>
    )}>
      {canRecord && (!activeOrders.length || !data.workers.length) && (
        <p className="helper">การบันทึกยอดปั๊มต้องมีใบสั่งผลิตที่ใช้งานและพนักงานที่ยังทำงานอยู่</p>
      )}
      {!!data.orders.length && (
        <div className="pressing-filter">
          <Choice label="กรองตามใบสั่งผลิต" name="order_filter" empty="ทุกใบสั่งผลิต" value={filter} onChange={setFilter}
            options={data.orders.map((order) => ({ value: order.id, label: orderName(order) }))} />
        </div>
      )}
      {entries.length ? (
        <div className="pressing-cards">
          {[...entries].reverse().map((entry) => {
            const order = data.orders.find((item) => item.id === entry.order_id);
            return (
              <Card key={entry.id} title={`รายการปั๊ม #${entry.id} · ${entry.employee_name}`}
                meta={<span>{entry.pressed_on}</span>}
                actions={
                  <>
                    {canCorrect && (
                      <>
                        <button className="button secondary" onClick={() => setEditor({ kind: "edit", entry })}>แก้รายการปั๊ม</button>
                        <button className="button secondary" onClick={() => setEditor({ kind: "adjust", entry })}>ปรับยอดหลังเคลื่อนไหว</button>
                      </>
                    )}
                    <button className="button secondary" onClick={() => setEditor({ kind: "history", entry })}>ประวัติการแก้ยอด</button>
                  </>
                }
              >
                {order && <p>{orderName(order)} · {tileName(data.types, order.type_id)}</p>}
                <Facts values={{
                  "ยอดปั๊ม (แผ่น)": count(entry.pieces),
                  "จำนวนไม้เต็ม": count(entry.full_racks),
                  "แผ่นเศษ": count(entry.loose_pieces),
                  "แผ่นต่อไม้": count(entry.pieces_per_rack),
                  "วันครบกำหนดพัก": entry.ready_on,
                  ...(entry.square_meters === null ? {} : { "ตร.ม.": count(entry.square_meters) }),
                  ...(entry.original_pieces !== entry.pieces ? { "ยอดเดิม (แผ่น)": count(entry.original_pieces) } : {}),
                }} />
                {entry.note && <p>{entry.note}</p>}
                <p className="pressing-meta">บันทึกโดย {entry.recorded_by_username} · {timestamp(entry.recorded_at)}</p>
              </Card>
            );
          })}
        </div>
      ) : <p>ยังไม่มีรายการปั๊ม</p>}
      {editor?.kind === "record" && canRecord && (
        <FormDialog {...dialog} title="บันทึกยอดปั๊ม" path="/entries" keyField="request_id" submitLabel="ยืนยันยอดปั๊ม"
          build={pressingEntryPayload}
        >
          <Choice label="ใบสั่งผลิต" name="order_id"
            options={activeOrders.map((order) => ({
              value: order.id, label: `${orderName(order)} · ${tileName(data.types, order.type_id)}`,
            }))} />
          <EntryFields data={data} />
        </FormDialog>
      )}
      {editor?.kind === "edit" && canCorrect && (
        <FormDialog {...dialog} title="แก้รายการปั๊ม" path={`/entries/${editor.entry.id}`} method="PUT" submitLabel="บันทึกการแก้รายการ"
          build={entryFormValues}
        >
          <p className="helper">ใช้กับรายการที่ยังไม่เคยเบิกหรือปล่อยส่วนเกิน</p>
          <EntryFields data={data} entry={editor.entry} />
        </FormDialog>
      )}
      {editor?.kind === "adjust" && canCorrect && (
        <FormDialog {...dialog} title="ปรับยอดหลังเคลื่อนไหว" path={`/entries/${editor.entry.id}/adjustments`}
          keyField="request_id" submitLabel="บันทึกการปรับยอด"
          build={(form) => ({
            corrected_pieces: formInteger(form, "corrected_pieces", "ยอดหลังปรับ", 0),
            reason: formText(form, "reason"),
          })}
        >
          <p className="helper">ใช้กับรายการที่เคยเบิกหรือปล่อยส่วนเกิน กรอกยอดรวมที่ถูกต้องหลังปรับ</p>
          <Field label="ยอดหลังปรับ (แผ่น)" name="corrected_pieces" type="number" min={0} step={1} required defaultValue={editor.entry.pieces} />
          <Field label="เหตุผลที่ปรับยอด" name="reason" required />
        </FormDialog>
      )}
      {editor?.kind === "history" && (
        <HistoryDialog<EntryCorrection> api={actions.api} title={`ประวัติการแก้ยอด · รายการปั๊ม #${editor.entry.id}`}
          path={`/entries/${editor.entry.id}/adjustments`} onClose={close}
          render={(item) => (
            <Card title={item.kind === "edit" ? "แก้รายการปั๊ม" : "ปรับยอดหลังเคลื่อนไหว"}
              meta={`${item.corrected_by_username} · ${timestamp(item.corrected_at)}`}
            >
              <Facts values={{
                "ยอดก่อนแก้ (แผ่น)": count(item.previous_pieces),
                "ยอดหลังแก้ (แผ่น)": count(item.corrected_pieces),
                ...(item.reason ? { "เหตุผล": item.reason } : {}),
              }} />
              {item.previous_values && item.corrected_values && (
                <div className="pressing-comparison">
                  <div><strong>ข้อมูลก่อนแก้</strong><EntrySnapshot data={data} values={item.previous_values} /></div>
                  <div><strong>ข้อมูลหลังแก้</strong><EntrySnapshot data={data} values={item.corrected_values} /></div>
                </div>
              )}
            </Card>
          )}
        />
      )}
    </Section>
  );
}

function EntryFields({ data, entry }: { data: PressingData; entry?: PressingEntry }) {
  const workers = data.workers.map((worker) => ({ value: worker.id, label: `${worker.name} · ${worker.code}` }));
  if (entry && !workers.some((worker) => worker.value === entry.employee_id)) {
    workers.unshift({ value: entry.employee_id, label: `${entry.employee_name} · ผู้ปั๊มเดิม` });
  }
  return (
    <>
      <div className="form-grid">
        <Field label="วันที่ปั๊ม" name="pressed_on" type="date" required defaultValue={entry?.pressed_on ?? bangkokDate()} />
        <Choice label="ผู้ปั๊ม" name="employee_id" defaultValue={entry?.employee_id ?? ""} options={workers} />
        <Field label="จำนวนไม้เต็ม" name="full_racks" type="number" min={0} step={1} required defaultValue={entry?.full_racks} />
        <Field label="แผ่นเศษ" name="loose_pieces" type="number" min={0} step={1} defaultValue={entry?.loose_pieces} />
      </div>
      <Field label="หมายเหตุ" name="note" defaultValue={entry?.note ?? ""} />
    </>
  );
}

function EntrySnapshot({ data, values }: { data: PressingData; values: EntryValues }) {
  return <Facts values={{
    "วันที่ปั๊ม": values.pressed_on,
    "ผู้ปั๊ม": workerName(data, values.employee_id),
    "จำนวนไม้เต็ม": count(values.full_racks),
    "แผ่นเศษ": count(values.loose_pieces),
    "วันครบกำหนดพัก": values.ready_on,
    "หมายเหตุ": values.note,
  }} />;
}
