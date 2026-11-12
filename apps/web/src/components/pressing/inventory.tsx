import { useRef, useState } from "react";
import {
  allocations, bangkokDate, count, destinations, formInteger, formText, openingStockPayload, orderName, tileName, timestamp,
  type Allocation, type IssueReversal, type PressingData, type StockIssue, type StockSource,
} from "../../lib/pressing";
import { Field } from "../fields";
import { Card, Check, Choice, Facts, FormDialog, HistoryDialog, Section, type PressingActions } from "./shared";

type Editor =
  | { kind: "opening" | "issue" }
  | { kind: "ready" | "release"; source: StockSource }
  | { kind: "reverse" | "history"; issue: StockIssue };

type DialogProps = Pick<PressingActions, "api" | "onSaved"> & { onClose: () => void };

function sourceName(source: StockSource) {
  return `แหล่งสต็อก #${source.id} · ${source.entry_id === null ? "ยอดตั้งต้น" : `รายการปั๊ม #${source.entry_id}`}`;
}

function availability(source: StockSource, orderId: number): { value: Allocation; label: string; pieces: number }[] {
  const options: { value: Allocation; label: string; pieces: number }[] = [];
  if (source.general_pieces > 0) {
    options.push({ value: "general", label: allocations.general, pieces: source.general_pieces });
  }
  if (source.restricted_pieces > 0 && orderId === source.order_id) {
    options.push({ value: "order", label: allocations.order, pieces: source.restricted_pieces });
  }
  return options;
}

export default function Inventory({ data, actions }: { data: PressingData; actions: PressingActions }) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [filter, setFilter] = useState("");
  const canManage = actions.can("pressing.manage");
  const canIssue = actions.can("pressing.issue");
  const canRelease = actions.can("pressing.release");
  const canCorrect = actions.can("pressing.correct");
  const readyStock = data.stock.filter((source) => source.ready && source.remaining_pieces > 0);
  const activeTypes = data.types.filter((tile) => tile.active);
  const sources = filter ? data.stock.filter((source) => source.type_id === Number(filter)) : data.stock;
  const issues = filter ? data.issues.filter((issue) => issue.type_id === Number(filter)) : data.issues;
  const close = () => setEditor(null);
  const dialog = { api: actions.api, onSaved: actions.onSaved, onClose: close };

  return (
    <div className="pressing-stack">
      <Section title="สต็อกงานปั๊ม" action={(canManage || canIssue) && (
        <div className="pressing-actions">
          {canManage && (
            <button className="button secondary" disabled={!activeTypes.length} onClick={() => setEditor({ kind: "opening" })}>ลงยอดตั้งต้น</button>
          )}
          {canIssue && (
            <button className="button primary" disabled={!readyStock.length} onClick={() => setEditor({ kind: "issue" })}>เบิกสต็อก</button>
          )}
        </div>
      )}>
        {!!data.types.length && (
          <div className="pressing-filter">
            <Choice label="กรองตามประเภทกระเบื้อง" name="stock_filter" empty="ทุกประเภทกระเบื้อง" value={filter} onChange={setFilter}
              options={data.types.map((tile) => ({ value: tile.id, label: tileName(data.types, tile.id) }))} />
          </div>
        )}
        {sources.length ? (
          <div className="pressing-cards">
            {[...sources].reverse().map((source) => {
              const order = data.orders.find((item) => item.id === source.order_id);
              const awaitingConfirmation = source.entry_id === null && source.ready_on === null && !source.ready;
              return (
                <Card key={source.id} title={sourceName(source)}
                  meta={<span className={`badge ${source.ready ? "good" : "muted-badge"}`}>
                    {source.ready ? "ครบเงื่อนไขพัก" : awaitingConfirmation ? "รอยืนยันความพร้อม" : "รอครบกำหนดพัก"}
                  </span>}
                  actions={(canIssue && awaitingConfirmation || canRelease && source.restricted_pieces > 0) && (
                    <>
                      {canIssue && awaitingConfirmation && (
                        <button className="button secondary" onClick={() => setEditor({ kind: "ready", source })}>ยืนยันความพร้อมยอดตั้งต้น</button>
                      )}
                      {canRelease && source.restricted_pieces > 0 && (
                        <button className="button secondary" onClick={() => setEditor({ kind: "release", source })}>ปล่อยส่วนเกิน</button>
                      )}
                    </>
                  )}
                >
                  <p>{tileName(data.types, source.type_id)}{order && ` · ${orderName(order)}`}</p>
                  <Facts values={{
                    "คงเหลือ (แผ่น)": count(source.remaining_pieces),
                    "ยอดผูกใบสั่ง (แผ่น)": count(source.restricted_pieces),
                    "ยอดทั่วไป (แผ่น)": count(source.general_pieces),
                    "ปลายทางเบิก": destinations[source.destination],
                    ...(source.pressed_on ? { "วันที่ปั๊ม": source.pressed_on } : { "วันที่ตรวจยอดตั้งต้น": source.as_of }),
                    "วันครบกำหนดพัก": source.ready_on,
                  }} />
                </Card>
              );
            })}
          </div>
        ) : <p>ยังไม่มีแหล่งสต็อก</p>}
      </Section>
      <Section title="ประวัติการเบิก">
        {issues.length ? (
          <div className="pressing-cards">
            {[...issues].reverse().map((issue) => {
              const order = data.orders.find((item) => item.id === issue.order_id);
              return (
                <Card key={issue.id} title={`ใบเบิก #${issue.id} · ${tileName(data.types, issue.type_id)}`}
                  meta={issue.pooled && <span className="badge neutral">เบิกจากกองรวม</span>}
                  actions={
                    <>
                      {canCorrect && (
                        <button className="button secondary" onClick={() => setEditor({ kind: "reverse", issue })}>ย้อนรายการเบิก</button>
                      )}
                      <button className="button secondary" onClick={() => setEditor({ kind: "history", issue })}>ประวัติการย้อนเบิก</button>
                    </>
                  }
                >
                  <Facts values={{
                    "ปลายทางเบิก": destinations[issue.destination],
                    "ใบสั่งผลิต": order ? orderName(order) : null,
                    "ผู้ยืนยันเบิก": issue.issued_by_username,
                    "เวลายืนยันเบิก": timestamp(issue.issued_at),
                  }} />
                  <ul className="pressing-line-list">
                    {issue.lines.map((line) => (
                      <li key={line.id}>แหล่งสต็อก #{line.source_id} · {allocations[line.allocation]} · {count(line.pieces)} แผ่น</li>
                    ))}
                  </ul>
                </Card>
              );
            })}
          </div>
        ) : <p>ยังไม่มีการเบิก</p>}
      </Section>
      {editor?.kind === "opening" && canManage && <OpeningForm {...dialog} data={data} />}
      {editor?.kind === "issue" && canIssue && <IssueForm {...dialog} data={data} readyStock={readyStock} />}
      {editor?.kind === "ready" && canIssue && (
        <FormDialog {...dialog} title="ยืนยันความพร้อมยอดตั้งต้น" path={`/stock/${editor.source.id}/ready`}
          submitLabel="ยืนยันความพร้อม" build={(form) => ({ confirmed_ready: form.has("confirmed_ready") })}
        >
          <p>{sourceName(editor.source)}</p>
          <Check label="ตรวจสภาพจริงแล้วและพร้อมเบิก" name="confirmed_ready" required />
        </FormDialog>
      )}
      {editor?.kind === "release" && canRelease && (
        <FormDialog {...dialog} title="ปล่อยส่วนเกินเข้ายอดทั่วไป" path="/releases" keyField="request_id" submitLabel="ยืนยันปล่อยส่วนเกิน"
          build={(form) => ({ source_id: editor.source.id, pieces: formInteger(form, "pieces", "จำนวนแผ่นที่ปล่อย") })}
        >
          <p>{sourceName(editor.source)}</p>
          <p className="helper">ยอดที่ยังผูกใบสั่ง {count(editor.source.restricted_pieces)} แผ่น ระบบจะตรวจส่วนเกินที่ยังปล่อยได้ของทั้งใบสั่ง</p>
          <Field label="จำนวนแผ่นที่ปล่อย" name="pieces" type="number" min={1} max={editor.source.restricted_pieces} step={1} required />
        </FormDialog>
      )}
      {editor?.kind === "reverse" && canCorrect && <ReversalForm {...dialog} issue={editor.issue} />}
      {editor?.kind === "history" && (
        <HistoryDialog<IssueReversal> api={actions.api} title={`ประวัติการย้อนเบิก · ใบเบิก #${editor.issue.id}`}
          path={`/issues/${editor.issue.id}/reversals`} onClose={close}
          render={(item) => (
            <Card title={item.reason} meta={`${item.reversed_by_username} · ${timestamp(item.reversed_at)}`}>
              <ul className="pressing-line-list">
                {item.lines.map((line) => (
                  <li key={line.issue_line_id}>
                    แหล่งสต็อก #{line.source_id} · {allocations[line.allocation]} · คืน {count(line.pieces)} แผ่น จากยอดก่อนย้อน {count(line.previous_pieces)} แผ่น
                  </li>
                ))}
              </ul>
            </Card>
          )}
        />
      )}
    </div>
  );
}

function OpeningForm({ data, ...dialog }: DialogProps & { data: PressingData }) {
  return (
    <FormDialog {...dialog} title="ลงยอดตั้งต้น" path="/opening" keyField="source_key" submitLabel="บันทึกยอดตั้งต้น"
      build={openingStockPayload}
    >
      <p className="helper">ใช้รหัสเดิมทุกครั้งสำหรับยอดตรวจนับจากแหล่งเดียวกัน</p>
      <Field label="รหัสอ้างอิงยอดตรวจนับ" name="source_key" required />
      <Choice label="ประเภทกระเบื้อง" name="type_id"
        options={data.types.filter((tile) => tile.active).map((tile) => ({ value: tile.id, label: tileName(data.types, tile.id) }))} />
      <div className="form-grid">
        <Field label="วันที่ตรวจยอดตั้งต้น" name="as_of" type="date" required defaultValue={bangkokDate()} />
        <Field label="จำนวนแผ่นตั้งต้น" name="pieces" type="number" min={1} step={1} required />
        <Field label="วันครบกำหนดพัก (ถ้าทราบ)" name="ready_on" type="date" />
      </div>
      <Check label="ตรวจยืนยันพร้อมเบิกแล้ว (กรณีไม่ทราบวันครบกำหนดพัก)" name="ready_confirmed" />
    </FormDialog>
  );
}

function IssueForm({
  data, readyStock, ...dialog
}: DialogProps & { data: PressingData; readyStock: StockSource[] }) {
  const [type, setType] = useState("");
  const [destination, setDestination] = useState("");
  const [order, setOrder] = useState("");
  const [lines, setLines] = useState([0]);
  const nextLine = useRef(1);
  const matchingType = readyStock.filter((source) => source.type_id === Number(type));
  const matchingSources = matchingType.filter((source) =>
    source.destination === destination && availability(source, Number(order)).length > 0,
  );
  const clearLines = () => setLines([nextLine.current++]);
  return (
    <FormDialog {...dialog} title="เบิกสต็อก" path="/issues" keyField="request_id" submitLabel="ยืนยันการเบิก"
      build={(form) => ({
        type_id: formInteger(form, "type_id", "ประเภทกระเบื้อง"),
        destination: formText(form, "destination"),
        order_id: formText(form, "order_id") ? formInteger(form, "order_id", "ใบสั่งผลิต") : null,
        confirmed_ready: form.has("confirmed_ready"),
        pooled: form.has("pooled"),
        lines: lines.map((_, index) => ({
          source_id: formInteger(form, `source_id_${index}`, "แหล่งสต็อก"),
          allocation: formText(form, `allocation_${index}`),
          pieces: formInteger(form, `pieces_${index}`, "จำนวนแผ่นที่เบิก"),
        })),
      })}
    >
      <div className="form-grid">
        <Choice label="ประเภทกระเบื้อง" name="type_id" value={type} onChange={(value) => {
          setType(value);
          setDestination("");
          setOrder("");
          clearLines();
        }}
          options={data.types.filter((tile) => readyStock.some((source) => source.type_id === tile.id))
            .map((tile) => ({ value: tile.id, label: tileName(data.types, tile.id) }))}
        />
        <Choice label="ปลายทางเบิก" name="destination" value={destination} onChange={(value) => {
          setDestination(value);
          clearLines();
        }}
          options={[...new Set(matchingType.map((source) => source.destination))]
            .map((value) => ({ value, label: destinations[value] }))}
        />
        <Choice label="ใบสั่งผลิตที่ใช้ยอด" name="order_id" empty="ไม่ระบุใบสั่งผลิต" value={order} onChange={(value) => {
          setOrder(value);
          clearLines();
        }}
          options={data.orders.filter((item) => item.type_id === Number(type))
            .map((item) => ({ value: item.id, label: orderName(item) }))}
        />
      </div>
      {type && destination && !matchingSources.length && (
        <p className="helper">ไม่พบยอดพร้อมเบิกตามที่เลือก หากต้องการใช้ยอดผูกใบสั่ง ให้เลือกใบสั่งผลิตเดิมของยอดนั้น</p>
      )}
      {lines.map((line, index) => (
        <div className="pressing-line" key={line}>
          <div className="pressing-line-head">
            <strong>รายการเบิก {index + 1}</strong>
            {lines.length > 1 && (
              <button type="button" className="button secondary" onClick={() => setLines(lines.filter((id) => id !== line))}>
                ลบรายการเบิก {index + 1}
              </button>
            )}
          </div>
          <IssueFields line={index} sources={matchingSources} orderId={Number(order)} />
        </div>
      ))}
      <div className="pressing-actions">
        <button type="button" className="button secondary" disabled={!matchingSources.length} onClick={() => setLines([...lines, nextLine.current++])}>
          เพิ่มรายการเบิก
        </button>
      </div>
      <Check label="เบิกจากกองรวม" name="pooled" />
      <Check label="ตรวจสภาพจริงแล้วและยืนยันว่าพร้อมเบิก" name="confirmed_ready" required />
    </FormDialog>
  );
}

function IssueFields({ line, sources, orderId }: { line: number; sources: StockSource[]; orderId: number }) {
  const [sourceId, setSourceId] = useState("");
  const [allocation, setAllocation] = useState("");
  const source = sources.find((item) => item.id === Number(sourceId));
  const options = source ? availability(source, orderId) : [];
  const maximum = options.find((option) => option.value === allocation)?.pieces;
  return (
    <div className="form-grid">
      <Choice label="แหล่งสต็อก" name={`source_id_${line}`} value={sourceId} onChange={(value) => {
        setSourceId(value);
        setAllocation("");
      }} options={sources.map((item) => ({
        value: item.id,
        label: `${sourceName(item)} · ${item.pressed_on ?? item.as_of ?? ""}`,
      }))} />
      <Choice label="ส่วนสต็อกที่เบิก" name={`allocation_${line}`} value={allocation} onChange={setAllocation}
        options={options.map((option) => ({ value: option.value, label: `${option.label} · ${count(option.pieces)} แผ่น` }))} />
      <Field label="จำนวนแผ่นที่เบิก" name={`pieces_${line}`} type="number" min={1} max={maximum} step={1} required />
    </div>
  );
}

function ReversalForm({ issue, ...dialog }: DialogProps & { issue: StockIssue }) {
  return (
    <FormDialog {...dialog} title={`ย้อนรายการเบิก · ใบเบิก #${issue.id}`} path={`/issues/${issue.id}/reversals`}
      keyField="request_id" submitLabel="ยืนยันย้อนเบิก"
      build={(form) => {
        const lines = issue.lines.filter((line) => formText(form, `line_${line.id}`)).map((line) => ({
          issue_line_id: line.id,
          pieces: formInteger(form, `line_${line.id}`, "จำนวนแผ่นที่คืน"),
        }));
        if (!lines.length) throw new Error("กรุณาระบุจำนวนแผ่นที่คืนอย่างน้อยหนึ่งรายการ");
        return { reason: formText(form, "reason"), lines };
      }}
    >
      <p className="helper">กรอกจำนวนที่ต้องการคืนเฉพาะรายการที่ย้อน ระบบจะคืนเข้าที่เดิมและตรวจยอดที่เคยย้อนแล้ว</p>
      {issue.lines.map((line) => (
        <Field key={line.id} label={`คืนแหล่ง #${line.source_id} · ${allocations[line.allocation]} (เบิกเดิม ${count(line.pieces)} แผ่น)`}
          name={`line_${line.id}`} type="number" min={1} max={line.pieces} step={1} />
      ))}
      <Field label="เหตุผลที่ย้อนเบิก" name="reason" required />
    </FormDialog>
  );
}
