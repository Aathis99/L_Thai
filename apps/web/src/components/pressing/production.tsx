import { useEffect, useState } from "react";
import { formatEmployeeName } from "../../lib/employee-names";
import {
  bangkokDate,
  count,
  entryFormValues,
  filterEntries,
  formInteger,
  formText,
  orderName,
  pressingEntryPayload,
  previewPressingEntry,
  tileName,
  timestamp,
  workerName,
  type EntryCorrection,
  type EntryValues,
  type PressingData,
  type PressingEntry,
  type ProductionOrder,
} from "../../lib/pressing";
import type { Api } from "../../lib/types";
import { Field } from "../fields";
import { Choice, Facts, FormDialog, Modal, Section, type PressingActions } from "./shared";

type Editor =
  | { kind: "record" }
  | { kind: "edit" | "adjust"; entry: PressingEntry };

function orderSubtitle(data: PressingData, order?: ProductionOrder) {
  if (!order) return "";
  if (order.product_name) {
    const clay = order.clay_name_snapshot ?? (order.production_clay ? `ดิน${order.production_clay}` : "");
    return [order.product_code, order.product_name, clay].filter(Boolean).join(" · ");
  }
  return tileName(data.types, order.type_id);
}

export default function Production({
  data,
  actions,
  onGoOrders,
}: {
  data: PressingData;
  actions: PressingActions;
  onGoOrders?: () => void;
}) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [orderFilter, setOrderFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const canRecord = actions.can("pressing.record");
  const canCorrect = actions.can("pressing.correct");
  const activeOrders = data.orders.filter((order) => data.types.some((tile) => tile.id === order.type_id && tile.active));
  const filtered = filterEntries(data.entries, data.orders, data.types, {
    search,
    orderId: orderFilter,
    from: fromDate,
    to: toDate,
  });
  const hasFilters = Boolean(search.trim() || orderFilter || fromDate || toDate);
  const detailEntry = detailId === null ? null : data.entries.find((entry) => entry.id === detailId) ?? null;

  const close = () => setEditor(null);
  const dialog = { api: actions.api, onSaved: actions.onSaved, onClose: close };

  return (
    <>
      {data.entries.length > 0 && (
        <Section title="ค้นหาและตัวกรอง">
          <div className="clay-filters">
            <div className="clay-filter-search">
              <Field
                label="ชื่อผู้ปั๊ม / เลขอ้างอิง / หมายเหตุ"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <Choice
              label="ใบสั่งผลิต"
              name="order_filter"
              empty="ทุกใบสั่งผลิต"
              value={orderFilter}
              onChange={setOrderFilter}
              options={data.orders.map((order) => ({ value: order.id, label: orderName(order) }))}
            />
            <Field label="ตั้งแต่วันที่" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
            <Field label="ถึงวันที่" type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
          </div>
        </Section>
      )}

      <Section
        title={data.entries.length ? `รายการปั๊ม (${count(filtered.length)} จาก ${count(data.entries.length)} รายการ)` : "รายการปั๊ม"}
        action={canRecord && (
          <button
            className="button primary"
            disabled={!activeOrders.length || !data.workers.length}
            onClick={() => setEditor({ kind: "record" })}
          >
            ＋ บันทึกยอดปั๊ม
          </button>
        )}
      >
        {canRecord && (!activeOrders.length || !data.workers.length) && data.orders.length > 0 && (
          <p className="helper">การบันทึกยอดปั๊มต้องมีใบสั่งผลิตที่ใช้งานและพนักงานที่ยังทำงานอยู่</p>
        )}

        {!data.orders.length ? (
          <div className="pressing-empty">
            <p>ยังไม่มีใบสั่งผลิตสำหรับบันทึกยอด — สร้างใบสั่งผลิตใบแรกก่อนเริ่มลงยอดปั๊ม</p>
            {onGoOrders && (
              <button type="button" className="button primary" onClick={onGoOrders}>
                ไปที่ใบสั่งผลิตเพื่อเพิ่มใบแรก
              </button>
            )}
          </div>
        ) : !data.entries.length ? (
          <div className="pressing-empty">
            <p>ยังไม่มีรายการปั๊ม — กดบันทึกยอดเมื่อเริ่มปั๊มกระเบื้องได้ทันที</p>
            {canRecord && (
              <button
                type="button"
                className="button primary"
                disabled={!activeOrders.length || !data.workers.length}
                onClick={() => setEditor({ kind: "record" })}
              >
                ＋ บันทึกยอดปั๊มรายการแรก
              </button>
            )}
          </div>
        ) : !filtered.length ? (
          <div className="pressing-empty">
            <p>ไม่พบรายการปั๊มตามตัวกรอง</p>
            {hasFilters && (
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  setSearch("");
                  setOrderFilter("");
                  setFromDate("");
                  setToDate("");
                }}
              >
                ล้างตัวกรอง
              </button>
            )}
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>วันที่ปั๊ม</th>
                  <th>ใบสั่งผลิต</th>
                  <th>ผู้ปั๊ม</th>
                  <th className="num-col">ไม้เต็ม / เศษ</th>
                  <th className="num-col">ยอดปั๊ม (แผ่น)</th>
                  <th>ครบกำหนดพัก</th>
                  <th>รายละเอียด</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry) => {
                  const order = data.orders.find((item) => item.id === entry.order_id);
                  const subtitle = orderSubtitle(data, order);
                  return (
                    <tr key={entry.id}>
                      <td className="whitespace-nowrap">
                        <strong>{entry.pressed_on}</strong>
                        <span className="subtext">#{entry.id}</span>
                      </td>
                      <td>
                        <strong>{order ? orderName(order) : `ใบสั่ง #${entry.order_id}`}</strong>
                        {subtitle && <span className="subtext">{subtitle}</span>}
                      </td>
                      <td>{entry.employee_name}</td>
                      <td className="num-col">
                        {count(entry.full_racks)} ไม้
                        {entry.loose_pieces > 0 ? ` + ${count(entry.loose_pieces)} แผ่น` : ""}
                      </td>
                      <td className="num-col">
                        <strong>{count(entry.pieces)}</strong>
                        {entry.original_pieces !== entry.pieces && (
                          <span className="subtext">เดิม {count(entry.original_pieces)} แผ่น</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap">{entry.ready_on}</td>
                      <td>
                        <button
                          type="button"
                          className="button secondary"
                          onClick={() => setDetailId(entry.id)}
                        >
                          เปิด / ประวัติ
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {detailEntry && !editor && (
        <EntryDetailModal
          api={actions.api}
          data={data}
          entry={detailEntry}
          canCorrect={canCorrect}
          onClose={() => setDetailId(null)}
          onEdit={() => {
            setDetailId(null);
            setEditor({ kind: "edit", entry: detailEntry });
          }}
          onAdjust={() => {
            setDetailId(null);
            setEditor({ kind: "adjust", entry: detailEntry });
          }}
        />
      )}

      {editor?.kind === "record" && canRecord && (
        <RecordEntryDialog
          api={actions.api}
          data={data}
          onSaved={actions.onSaved}
          onClose={close}
        />
      )}

      {editor?.kind === "edit" && canCorrect && (
        <EditEntryDialog {...dialog} data={data} entry={editor.entry} />
      )}

      {editor?.kind === "adjust" && canCorrect && (
        <FormDialog
          {...dialog}
          title="ปรับยอดหลังเคลื่อนไหว"
          path={`/entries/${editor.entry.id}/adjustments`}
          keyField="request_id"
          intent="warning"
          submitLabel="บันทึกการปรับยอด"
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
    </>
  );
}

function EntryDetailModal({
  api,
  data,
  entry,
  canCorrect,
  onClose,
  onEdit,
  onAdjust,
}: {
  api: Api;
  data: PressingData;
  entry: PressingEntry;
  canCorrect: boolean;
  onClose: () => void;
  onEdit: () => void;
  onAdjust: () => void;
}) {
  const [history, setHistory] = useState<EntryCorrection[] | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const order = data.orders.find((item) => item.id === entry.order_id);

  useEffect(() => {
    let active = true;
    void api<{ items: EntryCorrection[] }>(`/pressing/entries/${entry.id}/adjustments`).then(
      (result) => {
        if (active) setHistory(result.items);
      },
      () => {
        if (active) setHistoryError("โหลดประวัติการแก้ยอดไม่สำเร็จ");
      },
    );
    return () => {
      active = false;
    };
  }, [api, entry.id, attempt]);

  return (
    <Modal title={`รายการปั๊ม #${entry.id} · ${entry.employee_name}`} size="lg" onClose={onClose}>
      <div className="raw-clay-detail-body">
        {order && (
          <p className="pressing-meta">
            <strong>{orderName(order)}</strong> · {orderSubtitle(data, order)}
          </p>
        )}
        <Facts
          values={{
            "วันที่ปั๊ม": entry.pressed_on,
            "วันครบกำหนดพัก": entry.ready_on,
            "ยอดปั๊ม (แผ่น)": count(entry.pieces),
            "จำนวนไม้เต็ม": count(entry.full_racks),
            "แผ่นเศษ": count(entry.loose_pieces),
            "แผ่นต่อไม้": count(entry.pieces_per_rack),
            ...(entry.square_meters === null ? {} : { "พื้นที่ (ตร.ม.)": count(entry.square_meters) }),
            ...(entry.original_pieces !== entry.pieces ? { "ยอดเดิม (แผ่น)": count(entry.original_pieces) } : {}),
            "บันทึกโดย": `${entry.recorded_by_username} · ${timestamp(entry.recorded_at)}`,
            ...(entry.note ? { "หมายเหตุ": entry.note } : {}),
          }}
        />
        {canCorrect && (
          <div className="raw-clay-detail-actions">
            <div className="pressing-actions">
              <button type="button" className="button warning" onClick={onEdit}>แก้รายการปั๊ม</button>
              <button type="button" className="button warning" onClick={onAdjust}>ปรับยอดหลังเคลื่อนไหว</button>
            </div>
          </div>
        )}
        <h3>ประวัติการแก้ยอด</h3>
        {historyError ? (
          <div className="error-banner" role="alert">
            <span>{historyError}</span>
            <button
              type="button"
              className="quiet"
              onClick={() => {
                setHistoryError("");
                setHistory(null);
                setAttempt((current) => current + 1);
              }}
            >
              ลองใหม่
            </button>
          </div>
        ) : history === null ? (
          <p role="status">กำลังโหลดประวัติ…</p>
        ) : history.length ? (
          history.map((item) => (
            <details key={item.id}>
              <summary>
                {item.kind === "edit" ? "แก้รายการปั๊ม" : "ปรับยอดหลังเคลื่อนไหว"} · {item.corrected_by_username} · {timestamp(item.corrected_at)} · {count(item.previous_pieces)} → {count(item.corrected_pieces)} แผ่น
              </summary>
              <Facts
                values={{
                  "ยอดก่อนแก้ (แผ่น)": count(item.previous_pieces),
                  "ยอดหลังแก้ (แผ่น)": count(item.corrected_pieces),
                  ...(item.reason ? { "เหตุผล": item.reason } : {}),
                }}
              />
              {item.previous_values && item.corrected_values && (
                <div className="pressing-comparison">
                  <div><strong>ข้อมูลก่อนแก้</strong><EntrySnapshot data={data} values={item.previous_values} /></div>
                  <div><strong>ข้อมูลหลังแก้</strong><EntrySnapshot data={data} values={item.corrected_values} /></div>
                </div>
              )}
            </details>
          ))
        ) : (
          <p className="helper">ยังไม่มีประวัติการแก้ยอด</p>
        )}
      </div>
    </Modal>
  );
}

export function RecordEntryDialog({
  api,
  data,
  initialOrderId,
  onSaved,
  onClose,
}: {
  api: Api;
  data: PressingData;
  initialOrderId?: number;
  onSaved: (message: string) => Promise<void>;
  onClose: () => void;
}) {
  const activeOrders = data.orders.filter((order) => data.types.some((tile) => tile.id === order.type_id && tile.active));
  const validInitial = initialOrderId && activeOrders.some((order) => order.id === initialOrderId) ? String(initialOrderId) : "";
  const [orderId, setOrderId] = useState(validInitial);
  const [pressedOn, setPressedOn] = useState(bangkokDate());
  const [fullRacks, setFullRacks] = useState("");
  const [loosePieces, setLoosePieces] = useState("");

  const selectedOrder = activeOrders.find((order) => order.id === Number(orderId));
  const selectedTile = selectedOrder ? data.types.find((tile) => tile.id === selectedOrder.type_id) : undefined;
  const preview = previewPressingEntry({
    order: selectedOrder,
    tile: selectedTile,
    pressedOn,
    fullRacks,
    loosePieces,
  });

  return (
    <FormDialog
      api={api}
      title="บันทึกยอดปั๊ม"
      path="/entries"
      keyField="request_id"
      submitLabel="ยืนยันยอดปั๊ม"
      onSaved={onSaved}
      onClose={onClose}
      build={(form, key) => pressingEntryPayload(form, key, data)}
    >
      <section className="form-section">
        <span className="form-section-title">1. ใบสั่งผลิตและผู้ทำงาน</span>
        <Choice
          label="ใบสั่งผลิต"
          name="order_id"
          value={orderId}
          onChange={setOrderId}
          options={activeOrders.map((order) => ({
            value: order.id,
            label: `${orderName(order)} · ${orderSubtitle(data, order)}`,
          }))}
        />
        <div className="form-grid">
          <Field
            label="วันที่ปั๊ม"
            name="pressed_on"
            type="date"
            required
            value={pressedOn}
            onChange={(event) => setPressedOn(event.target.value)}
          />
          <WorkerChoice data={data} />
        </div>
      </section>

      <section className="form-section">
        <span className="form-section-title">2. จำนวนที่ปั๊มได้และหมายเหตุ</span>
        <div className="form-grid">
          <Field
            label="จำนวนไม้เต็ม"
            name="full_racks"
            type="number"
            min={0}
            step={1}
            required
            value={fullRacks}
            onChange={(event) => setFullRacks(event.target.value)}
          />
          <Field
            label="แผ่นเศษ"
            name="loose_pieces"
            type="number"
            min={0}
            step={1}
            value={loosePieces}
            onChange={(event) => setLoosePieces(event.target.value)}
          />
        </div>
        <Field label="หมายเหตุ" name="note" />
      </section>

      <LivePreviewBox
        order={selectedOrder}
        fullRacks={fullRacks}
        loosePieces={loosePieces}
        preview={preview}
      />
    </FormDialog>
  );
}

function EditEntryDialog({
  api,
  data,
  entry,
  onSaved,
  onClose,
}: {
  api: Api;
  data: PressingData;
  entry: PressingEntry;
  onSaved: (message: string) => Promise<void>;
  onClose: () => void;
}) {
  const [pressedOn, setPressedOn] = useState(entry.pressed_on);
  const [fullRacks, setFullRacks] = useState(String(entry.full_racks));
  const [loosePieces, setLoosePieces] = useState(String(entry.loose_pieces));
  const order = data.orders.find((item) => item.id === entry.order_id);
  const tile = order ? data.types.find((item) => item.id === order.type_id) : undefined;
  const preview = previewPressingEntry({
    order,
    tile,
    pressedOn,
    fullRacks,
    loosePieces,
    piecesPerRackOverride: entry.pieces_per_rack,
    restDaysOverride: entry.rest_days,
    previousPieces: entry.pieces,
  });

  return (
    <FormDialog
      api={api}
      title="แก้รายการปั๊ม"
      path={`/entries/${entry.id}`}
      method="PUT"
      submitLabel="บันทึกการแก้รายการ"
      onSaved={onSaved}
      onClose={onClose}
      build={(form) => entryFormValues(form, entry.pieces_per_rack)}
    >
      <p className="helper">ใช้กับรายการที่ยังไม่เคยเบิกหรือปล่อยส่วนเกิน</p>
      <section className="form-section">
        <span className="form-section-title">ข้อมูลรายการปั๊ม</span>
        <div className="form-grid">
          <Field
            label="วันที่ปั๊ม"
            name="pressed_on"
            type="date"
            required
            value={pressedOn}
            onChange={(event) => setPressedOn(event.target.value)}
          />
          <WorkerChoice data={data} entry={entry} />
          <Field
            label="จำนวนไม้เต็ม"
            name="full_racks"
            type="number"
            min={0}
            step={1}
            required
            value={fullRacks}
            onChange={(event) => setFullRacks(event.target.value)}
          />
          <Field
            label="แผ่นเศษ"
            name="loose_pieces"
            type="number"
            min={0}
            step={1}
            value={loosePieces}
            onChange={(event) => setLoosePieces(event.target.value)}
          />
        </div>
        <Field label="หมายเหตุ" name="note" defaultValue={entry.note ?? ""} />
      </section>
      <LivePreviewBox
        order={order}
        fullRacks={fullRacks}
        loosePieces={loosePieces}
        preview={preview}
      />
    </FormDialog>
  );
}

function WorkerChoice({ data, entry }: { data: PressingData; entry?: PressingEntry }) {
  const workers = data.workers.map((worker) => ({ value: worker.id, label: `${formatEmployeeName(worker)} · ${worker.code}` }));
  if (entry && !workers.some((worker) => worker.value === entry.employee_id)) {
    workers.unshift({ value: entry.employee_id, label: `${entry.employee_name} · ผู้ปั๊มเดิม` });
  }
  return <Choice label="ผู้ปั๊ม" name="employee_id" defaultValue={entry?.employee_id ?? ""} options={workers} />;
}

function LivePreviewBox({
  order,
  fullRacks,
  loosePieces,
  preview,
}: {
  order?: ProductionOrder;
  fullRacks: string;
  loosePieces: string;
  preview: ReturnType<typeof previewPressingEntry>;
}) {
  if (!order && preview.piecesPerRack === null) return null;
  const racksNum = Number(fullRacks.trim() || 0);
  const looseNum = Number(loosePieces.trim() || 0);
  const diffLabel =
    preview.projectedDiff === null
      ? ""
      : preview.projectedDiff < 0
        ? `ยังขาด ${count(-preview.projectedDiff)} แผ่น`
        : preview.projectedDiff === 0
          ? "ครบตามสั่งพอดี"
          : `เกินสั่ง +${count(preview.projectedDiff)} แผ่น`;

  return (
    <aside className="pressing-live-preview" aria-live="polite">
      <div>
        ยอดปั๊มครั้งนี้:{" "}
        <strong>{preview.pieces !== null ? `${count(preview.pieces)} แผ่น` : "—"}</strong>
        {preview.piecesPerRack !== null && preview.pieces !== null && (
          <span className="subtext">
            {" "}({count(racksNum)} ไม้ × {count(preview.piecesPerRack)} แผ่น/ไม้
            {looseNum > 0 ? ` + ${count(looseNum)} แผ่นเศษ` : ""})
            {preview.squareMeters !== null ? ` · ${count(preview.squareMeters)} ตร.ม.` : ""}
          </span>
        )}
      </div>
      {order && preview.projectedOrderPieces !== null && (
        <div>
          ผลต่อใบสั่งผลิต:{" "}
          <strong>{count(order.pressed_pieces)} → {count(preview.projectedOrderPieces)}</strong>
          {" / สั่ง "}
          {count(order.target_pieces)} แผ่น · {diffLabel}
        </div>
      )}
      {preview.readyOn && (
        <div>
          วันครบกำหนดพัก: <strong>{preview.readyOn}</strong>
          {preview.restDays !== null ? ` (พัก ${count(preview.restDays)} วัน)` : ""}
        </div>
      )}
    </aside>
  );
}

function EntrySnapshot({ data, values }: { data: PressingData; values: EntryValues }) {
  return (
    <Facts
      values={{
        "วันที่ปั๊ม": values.pressed_on,
        "ผู้ปั๊ม": workerName(data, values.employee_id),
        "จำนวนไม้เต็ม": count(values.full_racks),
        "แผ่นเศษ": count(values.loose_pieces),
        "วันครบกำหนดพัก": values.ready_on,
        "หมายเหตุ": values.note,
      }}
    />
  );
}
