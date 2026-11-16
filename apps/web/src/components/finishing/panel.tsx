"use client";

import { useCallback, useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { bangkokDate, count, formInteger, formText } from "../../lib/pressing";
import type { Api, SessionUser } from "../../lib/types";
import { Field } from "../fields";
import { Card, Check, Choice, Facts, FormDialog, Section } from "../pressing/shared";

type Tile = { id: number; width: number; length: number; clay: string; name: string | null };
type Order = { id: number; customer_reference: string; type_id: number; clay: string; color_name: string | null;
  customer_pieces: number; ready_pieces: number; missing_pieces: number };
type Issue = { id: number; type_id: number; clay: string; order_id: number; customer_reference: string; destination: "color" | "kiln";
  color_name: string | null; finishing_ready: boolean; customer_pieces: number | null; net_pieces: number; unglazed_pieces: number };
type Batch = { id: number; issue_id: number; worked_on: string; pieces: number; pressing_waste: number; glazing_waste: number;
  good_pieces: number; pieces_per_sqm: number | null; workers: string[]; customer_reference: string; color_name: string };
type Source = { issue_id: number; batch_id: number | null; type_id: number; clay: string; customer_reference: string; color_name: string | null;
  clay_min: number | null; clay_max: number | null; color_min: number | null; color_max: number | null; ready_on: string;
  waiting_pieces: number; firing_pieces: number; awaiting_qc_pieces: number; completed_pieces: number };
type Load = { id: number; order_id: number; issue_id: number; batch_id: number | null; type_id: number; clay: string; color_name: string | null;
  pieces: number; unsorted_pieces: number };
type Round = { id: number; kiln: string; temperature: number; started_on: string; finished_on: string | null; loads: Load[] };
type Qc = { id: number; round_id: number; sorted_on: string; good_pieces: number; waste_pieces: number; allocated_pieces: number;
  unallocated_pieces: number; stocked_pieces: number; stock_available: number; orders: number[]; type_id: number;
  clay: string; color_name: string | null; voided_at: string | null; loads: { id: number; order_id: number; pieces: number }[];
  allocations: { id: number; order_id: number; pieces: number; voided_at: string | null }[] };
type Receipt = { id: number; qc_id: number; type_id: number; clay: string; color_id: number | null; color_name: string | null; pieces: number;
  recorded_by_username: string; recorded_at: string; voided_at: string | null };
type Data = {
  types: Tile[]; orders: Order[]; issues: Issue[]; glazing: Batch[]; rounds: Round[]; sources: Source[];
  qc: Qc[]; stock: Receipt[]; workers: { id: number; code: string; name: string }[];
};
type Editor = Pick<ComponentProps<typeof FormDialog>, "title" | "path" | "build" | "children">;

const sections = [
  ["glazing", "งานชุบเคลือบ"], ["firing", "งานเตา"], ["qc", "ผลคัด QC"],
  ["orders", "พร้อมส่งและสต็อก"],
] as const;

function NumberField({ name, label, min = 1, max, defaultValue, required = true }: {
  name: string; label: string; min?: number; max?: number; defaultValue?: number; required?: boolean;
}) {
  return <Field {...{ name, label, min, max, defaultValue, required }} type="number" step={1} />;
}

function DateField({ name, label, min }: { name: string; label: string; min?: string }) {
  return <Field name={name} label={label} type="date" min={min} defaultValue={bangkokDate()} required />;
}

function action(label: string, onClick: () => void) {
  return <button className="button secondary" onClick={onClick}>{label}</button>;
}

function missingRanges(source: Source) {
  return source.clay_min === null || (source.color_name !== null && source.color_min === null);
}

function rangeMatches(source: Source, round: Round) {
  return !missingRanges(source) && source.ready_on <= round.started_on &&
    round.temperature >= source.clay_min! && round.temperature <= source.clay_max! &&
    (source.color_name === null || (round.temperature >= source.color_min! && round.temperature <= source.color_max!));
}

function sourceName(source: Source) {
  return source.batch_id === null ? `ใบเบิกบรีส #${source.issue_id}` : `ชุดชุบ #${source.batch_id}`;
}

export default function FinishingPanel({ api, user }: { api: Api; user: SessionUser }) {
  const [section, setSection] = useState<(typeof sections)[number][0]>("glazing");
  const [data, setData] = useState<Data>();
  const [editor, setEditor] = useState<Editor>();
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const refresh = useCallback(async () => {
    setError("");
    try {
      const resources = ["types", "orders", "issues", "glazing", "rounds", "sources", "qc", "stock", "workers"] as const;
      const lists = await Promise.all(resources.map(async key => [key, (await api<{ items: Data[typeof key] }>(`/finishing/${key}`)).items]));
      setData(Object.fromEntries(lists) as Data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "โหลดข้อมูลงานผลิตไม่สำเร็จ");
    }
  }, [api]);

  useEffect(() => { void refresh(); }, [refresh]);
  const can = (operation: string) => user.permissions.includes(`finishing.${operation}`);
  const tileName = (id: number, clay: string) => {
    const tile = data?.types.find(item => item.id === id);
    return tile ? `${tile.width} × ${tile.length} ดิน${clay}${tile.name ? ` · ${tile.name}` : ""}` : `ประเภท #${id} · ดิน${clay}`;
  };
  const orderName = (id: number) => {
    const order = data?.orders.find(item => item.id === id);
    return order ? `ออเดอร์ ${order.customer_reference} · ใบสั่ง #${id}` : `ใบสั่ง #${id}`;
  };
  const orders = data?.orders ?? [];
  const stock = new Map<string, { type_id: number; clay: string; color_name: string | null; pieces: number }>();
  for (const receipt of data?.stock ?? []) {
    if (receipt.voided_at) continue;
    const key = `${receipt.type_id}:${receipt.clay}:${receipt.color_id ?? ""}`;
    const total = stock.get(key);
    if (total) total.pieces += receipt.pieces;
    else stock.set(key, { type_id: receipt.type_id, clay: receipt.clay, color_name: receipt.color_name, pieces: receipt.pieces });
  }
  const open = (title: string, path: string, build: Editor["build"], children: ReactNode) =>
    setEditor({ title, path, build, children });
  const number = (form: FormData, key: string, label: string, min = 1) => formInteger(form, key, label, min);
  const reverse = (label: string, path: string, key: string, id: number) =>
    action(label, () => open(label, path, form => ({ [key]: id, reason: formText(form, "reason") }),
      <><p>รายการ #{id}</p><Field name="reason" label="เหตุผล" required /></>));

  return <div className="pressing-panel">
    <div className="pressing-navigation">
      <nav aria-label="เมนูงานชุบเคลือบและงานเตา">
        {sections.map(([id, label]) => <button key={id} aria-pressed={section === id}
          className={`button ${section === id ? "primary" : "secondary"}`}
          onClick={() => { setStatus(""); setSection(id); }}>{label}</button>)}
      </nav>
      {action("โหลดรายการใหม่", () => void refresh())}
    </div>
    {error && <p className="error-banner" role="alert">{error}</p>}
    <p role="status">{status || (!data && !error ? "กำลังโหลดข้อมูลงานผลิต…" : "")}</p>
    {data && section === "glazing" && <>
      <Section title="ใบเบิกสำหรับงานชุบและบรีส">
        {!data.issues.length && <p>ยังไม่มีใบเบิกที่ผูกใบสั่งผลิต</p>}
        <div className="pressing-cards">
          {data.issues.filter(issue => issue.net_pieces > 0).map(issue => <Card key={issue.id} title={`ใบเบิก #${issue.id} · ${issue.customer_reference ?? ""}`}
            actions={
              issue.finishing_ready && issue.destination === "color" && issue.unglazed_pieces > 0 && can("glaze")
                ? action("บันทึกชุดชุบ", () => open("บันทึกชุดชุบ", "/glazing", form => ({
                  issue_id: issue.id, worked_on: formText(form, "worked_on"),
                  pieces: number(form, "pieces", "จำนวนแผ่นในชุด"),
                  pressing_waste: number(form, "pressing_waste", "ปั๊มเสีย", 0),
                  glazing_waste: number(form, "glazing_waste", "ชุบเสีย", 0),
                  good_pieces: number(form, "good_pieces", "ดีพร้อมเผา", 0),
                  worker_ids: form.getAll("workers").map(Number),
                }), <>
                  <p>{orderName(issue.order_id)} · {issue.color_name} · เหลือ {count(issue.unglazed_pieces)} แผ่น</p>
                  <DateField name="worked_on" label="วันที่ชุบ" />
                  <fieldset><legend>ผู้ทำงาน</legend>
                    {data.workers.map(worker => <Check key={worker.id} name="workers" value={worker.id} label={`${worker.code} · ${worker.name}`} />)}
                  </fieldset>
                  <NumberField name="pieces" label="จำนวนแผ่นในชุด" max={issue.unglazed_pieces} />
                  <NumberField name="pressing_waste" label="ปั๊มเสีย (แผ่น)" min={0} defaultValue={0} />
                  <NumberField name="glazing_waste" label="ชุบเสีย (แผ่น)" min={0} defaultValue={0} />
                  <NumberField name="good_pieces" label="ดีพร้อมเผา (แผ่น)" min={0} />
                </>))
                : !issue.finishing_ready && issue.customer_pieces && can("prepare")
                  ? action("ยืนยันยอดใบเบิกค้าง", () => open("ยืนยันยอดใบเบิกค้าง", "/confirm-issue",
                    form => ({ issue_id: issue.id, pieces: number(form, "pieces", "ยอดค้างที่ตรวจแล้ว") }),
                    <NumberField name="pieces" label="ยอดค้างที่ตรวจแล้ว (แผ่น)" max={issue.net_pieces} />)) : undefined
            }>
            <p>{tileName(issue.type_id, issue.clay)} · {issue.destination === "color" ? issue.color_name ?? "รอระบุสีเคลือบ" : "บรีส"}</p>
            <Facts values={{ "ยอดเบิกสุทธิ": count(issue.net_pieces),
              ...(issue.destination === "color" && issue.finishing_ready ? { "ยอดที่ยังบันทึกชุบได้": count(issue.unglazed_pieces) } : {}) }} />
            {!issue.finishing_ready && <p>{issue.customer_pieces ? "รอตรวจยืนยันใบเบิกค้าง" : "รอเติมข้อมูลใบสั่งผลิต"}</p>}
          </Card>)}
        </div>
      </Section>
      <Section title="ชุดงานชุบเคลือบ">
        {!data.glazing.length && <p>ยังไม่มีชุดงานชุบเคลือบ</p>}
        <div className="pressing-cards">{data.glazing.map(batch => <Card key={batch.id}
          title={`ชุดชุบ #${batch.id} · ${batch.customer_reference} · ${batch.color_name}`}
          actions={can("correct") && action("แก้ยอดงานชุบ", () => open("แก้ยอดงานชุบ", "/glazing-correction", form => ({
            batch_id: batch.id, pieces: number(form, "pieces", "จำนวนแผ่นในชุด", 0),
            pressing_waste: number(form, "pressing_waste", "ปั๊มเสีย", 0),
            glazing_waste: number(form, "glazing_waste", "ชุบเสีย", 0),
            good_pieces: number(form, "good_pieces", "ดีพร้อมเผา", 0), reason: formText(form, "reason"),
          }), <>
            <NumberField name="pieces" label="จำนวนแผ่นในชุด" min={0} defaultValue={batch.pieces} />
            <NumberField name="pressing_waste" label="ปั๊มเสีย" min={0} defaultValue={batch.pressing_waste} />
            <NumberField name="glazing_waste" label="ชุบเสีย" min={0} defaultValue={batch.glazing_waste} />
            <NumberField name="good_pieces" label="ดีพร้อมเผา" min={0} defaultValue={batch.good_pieces} />
            <Field name="reason" label="เหตุผลที่แก้ยอด" required />
          </>))}>
          <p>{batch.worked_on} · ใบเบิก #{batch.issue_id} · {batch.workers.join(", ")}</p>
          <Facts values={{ "จำนวนแผ่นในชุด": count(batch.pieces), "ปั๊มเสีย": count(batch.pressing_waste),
            "ชุบเสีย": count(batch.glazing_waste), "ดีพร้อมเผา": count(batch.good_pieces),
            ...(batch.pieces_per_sqm ? { "พื้นที่ชุดชุบ (ตร.ม.)": count(batch.pieces / batch.pieces_per_sqm) } : {}) }} />
        </Card>)}</div>
      </Section>
    </>}
    {data && section === "firing" && <>
      <Section title="ยอดงานตามสถานะ">
        {!data.sources.length && <p>ยังไม่มีงานรอเผา</p>}
        <div className="pressing-cards">{data.sources.map(source => <Card key={sourceName(source)}
          title={`${sourceName(source)} · ${source.customer_reference}`}
          meta={missingRanges(source) && <span className="badge neutral">รอตั้งช่วงอุณหภูมิ</span>}>
          <p>{tileName(source.type_id, source.clay)}{source.color_name && ` · ${source.color_name}`}</p>
          <Facts values={{ "สต็อกงานรอเผา": count(source.waiting_pieces), "กำลังเผา": count(source.firing_pieces),
            "รอคัด QC": count(source.awaiting_qc_pieces), "สำเร็จ": count(source.completed_pieces) }} />
        </Card>)}</div>
      </Section>
      <Section title="รอบเผา" action={can("fire") && action("เปิดรอบเผา", () => open("เปิดรอบเผา", "/rounds",
        form => ({ kiln: formText(form, "kiln"), temperature: number(form, "temperature", "อุณหภูมิ"),
          started_on: formText(form, "started_on") }), <>
          <Field name="kiln" label="ชื่อหรือหมายเลขเตา" required />
          <NumberField name="temperature" label="อุณหภูมิที่ตั้ง (°C)" />
          <DateField name="started_on" label="วันที่เข้าเตา" />
        </>))}>
        {!data.rounds.length && <p>ยังไม่มีรอบเผา</p>}
        <div className="pressing-cards">{data.rounds.map(round => {
          const compatible = data.sources.filter(source => source.waiting_pieces > 0 && rangeMatches(source, round));
          const pending = round.loads.filter(load => load.unsorted_pieces > 0);
          const hasPieces = round.loads.some(load => load.pieces > 0);
          return <Card key={round.id} title={`รอบ #${round.id} · เตา ${round.kiln} · ${round.temperature} °C`}
            meta={<span className="badge neutral">{round.finished_on ? (pending.length ? "รอคัด QC" : "สำเร็จ") : (hasPieces ? "กำลังเผา" : "รอลงเตา")}</span>}
            actions={!round.finished_on && can("fire") ? <>
              {compatible.length > 0 && action("ยืนยันแผ่นเข้าเตา", () => open("ยืนยันแผ่นเข้าเตา", "/loads", form => {
                const source = compatible[number(form, "source", "งานรอเผา", 0)];
                return { round_id: round.id, batch_id: source.batch_id, issue_id: source.issue_id, pieces: number(form, "pieces", "จำนวนแผ่น") };
              }, <LoadForm sources={compatible} />))}
              {hasPieces && action("บันทึกเผาเสร็จ", () => open("บันทึกเผาเสร็จ", "/finish",
                form => ({ round_id: round.id, finished_on: formText(form, "finished_on") }),
                <DateField name="finished_on" label="วันที่เผาเสร็จ" min={round.started_on} />))}
            </> : round.finished_on && pending.length > 0 && can("qc") && action("บันทึกผลคัด", () => open("บันทึกผลคัด QC", "/qc",
              form => ({ round_id: round.id, sorted_on: formText(form, "sorted_on"),
                lines: pending.filter(load => formText(form, `load_${load.id}`)).map(load => ({
                  load_id: load.id, pieces: number(form, `load_${load.id}`, "จำนวนที่คัด"),
                })),
                good_pieces: number(form, "good_pieces", "แผ่นดี", 0), waste_pieces: number(form, "waste_pieces", "แผ่นเสีย", 0) }),
              <>
                <DateField name="sorted_on" label="วันที่คัด" min={round.finished_on!} />
                <p>กรอกจำนวนเฉพาะรายการที่คัดด้วยกันในครั้งนี้</p>
                {pending.map(load => <NumberField key={load.id} name={`load_${load.id}`} required={false} max={load.unsorted_pieces}
                  label={`#${load.id} · ${orderName(load.order_id)} · ${tileName(load.type_id, load.clay)} · ${load.color_name ?? "บรีส"} · เหลือ ${count(load.unsorted_pieces)}`} />)}
                <NumberField name="good_pieces" label="แผ่นดี" min={0} />
                <NumberField name="waste_pieces" label="แผ่นเสีย" min={0} />
              </>))}>
            <p>เข้าเตา {round.started_on}{round.finished_on && ` · เผาเสร็จ ${round.finished_on}`}</p>
            {!round.finished_on && !compatible.length && <p>ไม่มีงานรอเผาที่พร้อมลงรอบอุณหภูมินี้</p>}
            {round.loads.length > 0 && <ul>{round.loads.map(load => <li key={load.id}>
              {load.batch_id ? `ชุดชุบ #${load.batch_id}` : `ใบเบิกบรีส #${load.issue_id}`} · {orderName(load.order_id)} · {count(load.pieces)} แผ่น
              {round.finished_on && ` · รอคัด ${count(load.unsorted_pieces)}`}
              {can("correct") && <div className="pressing-actions">{action(`แก้ยอดเข้าเตา #${load.id}`, () =>
                open("แก้ยอดเข้าเตา", "/load-correction", form => ({
                  load_id: load.id, pieces: number(form, "pieces", "จำนวนแผ่น", 0), reason: formText(form, "reason"),
                }), <>
                  <NumberField name="pieces" min={load.pieces - load.unsorted_pieces} label="จำนวนแผ่นเข้าเตา" defaultValue={load.pieces} />
                  <Field name="reason" label="เหตุผลที่แก้ยอด" required />
                </>))}</div>}
            </li>)}</ul>}
          </Card>;
        })}</div>
      </Section>
    </>}
    {data && section === "qc" && <Section title="ผลคัด QC">
      {!data.qc.length && <p>ยังไม่มีผลคัด QC</p>}
      <div className="pressing-cards">{data.qc.map(qc => {
        const eligible = orders.filter(order => qc.orders.includes(order.id) && order.missing_pieces > 0);
        return <Card key={qc.id} title={`ผลคัด #${qc.id} · รอบเผา #${qc.round_id}`}
          meta={qc.voided_at && <span className="badge neutral">ยกเลิกแล้ว</span>} actions={!qc.voided_at && <>
          {can("allocate") && qc.unallocated_pieces > 0 && eligible.length > 0 && action("จัดสรรแผ่นดี", () => open("จัดสรรแผ่นดี", "/allocations",
            form => ({ qc_id: qc.id, order_id: number(form, "order_id", "ใบสั่งผลิต"), pieces: number(form, "pieces", "จำนวนแผ่น") }),
            <>
              <Choice label="ใบสั่งผลิต" name="order_id" options={eligible.map(order =>
                ({ value: order.id, label: `${orderName(order.id)} · ขาด ${count(order.missing_pieces)} แผ่น` }))} />
              <NumberField name="pieces" label="จำนวนแผ่นดี" max={qc.unallocated_pieces} />
            </>))}
          {can("stock") && qc.stock_available > 0 && action("ยืนยันรับเข้าสต็อก", () => open("ยืนยันรับเข้าสต็อก", "/stock",
            form => ({ qc_id: qc.id, pieces: number(form, "pieces", "จำนวนแผ่น") }),
            <NumberField name="pieces" label="จำนวนที่ตรวจแล้ว (แผ่น)" max={qc.stock_available} />))}
          {can("correct") && action("แก้ผลคัด", () => open("แก้ผลคัด QC", "/qc-correction",
            form => ({ qc_id: qc.id, good_pieces: number(form, "good_pieces", "แผ่นดี", 0),
              waste_pieces: number(form, "waste_pieces", "แผ่นเสีย", 0), reason: formText(form, "reason") }),
            <>
              <NumberField name="good_pieces" label="แผ่นดี" min={0} defaultValue={qc.good_pieces} />
              <NumberField name="waste_pieces" label="แผ่นเสีย" min={0} defaultValue={qc.waste_pieces} />
              <Field name="reason" label="เหตุผลที่แก้ผลคัด" required />
            </>))}
          {can("correct") && !qc.allocated_pieces && !qc.stocked_pieces &&
            reverse("ยกเลิกผลคัด", "/qc-void", "qc_id", qc.id)}
        </>}>
          <p>{qc.sorted_on} · {tileName(qc.type_id, qc.clay)}{qc.color_name && ` · ${qc.color_name}`}</p>
          <p>{qc.orders.map(orderName).join(" / ")}</p>
          <Facts values={{ "แผ่นดี": count(qc.good_pieces), "แผ่นเสีย": count(qc.waste_pieces), "กันให้ออเดอร์": count(qc.allocated_pieces),
            "รอจัดสรร": qc.voided_at ? null : count(qc.unallocated_pieces - qc.stock_available), "ส่วนเกินพร้อมรับเข้า": count(qc.stock_available),
            "รับเข้าสต็อกแล้ว": count(qc.stocked_pieces) }} />
          <details><summary>รายการเข้าเตาที่คัดและยอดจัดสรร</summary>
            <ul>{qc.loads.map(load => <li key={load.id}>
              รายการเข้าเตา #{load.id} · {orderName(load.order_id)} · คัด {count(load.pieces)} แผ่น
            </li>)}</ul>
            {qc.allocations.length > 0 && <ul>{qc.allocations.map(allocation => <li key={allocation.id}>
              {orderName(allocation.order_id)} · {count(allocation.pieces)} แผ่น{allocation.voided_at && " · ย้อนแล้ว"}
              {!allocation.voided_at && can("allocate") && <div className="pressing-actions">
                {reverse("ย้อนยอดจัดสรร", "/allocation-void", "allocation_id", allocation.id)}
              </div>}
            </li>)}</ul>}
          </details>
        </Card>;
      })}</div>
    </Section>}
    {data && section === "orders" && <>
      <Section title="ยอดพร้อมส่งตามใบสั่ง">
        {!orders.length && <p>ยังไม่มีข้อมูลออเดอร์สำหรับงานผลิต</p>}
        <div className="pressing-cards">{orders.map(order => <Card key={order.id} title={orderName(order.id)}>
          <p>{tileName(order.type_id, order.clay)}{order.color_name && ` · ${order.color_name}`}</p>
          <Facts values={{ "ยอดลูกค้าสั่ง": count(order.customer_pieces), "พร้อมส่ง": count(order.ready_pieces), "ยอดขาด": count(order.missing_pieces) }} />
        </Card>)}</div>
      </Section>
      <Section title="สต็อกสินค้าสำเร็จ">
        {!stock.size && <p>ยังไม่มียอดสินค้าสำเร็จ</p>}
        <div className="pressing-cards">{[...stock].map(([key, item]) => <Card key={key} title={tileName(item.type_id, item.clay)}>
          <p>{item.color_name ?? "บรีส"}</p>
          <Facts values={{ "ยอดรับเข้าสุทธิ (แผ่น)": count(item.pieces) }} />
        </Card>)}</div>
      </Section>
      <Section title="ประวัติรับเข้าสินค้าสำเร็จ">
        {!data.stock.length && <p>ยังไม่มีรายการรับเข้า</p>}
        <div className="pressing-cards">{data.stock.map(receipt => <Card key={receipt.id} title={`รับเข้า #${receipt.id} · ${count(receipt.pieces)} แผ่น`}
          meta={receipt.voided_at && <span className="badge neutral">ย้อนแล้ว</span>}
          actions={!receipt.voided_at && can("stock") && reverse("ย้อนรายการรับเข้า", "/stock-void", "receipt_id", receipt.id)}>
          <p>{tileName(receipt.type_id, receipt.clay)} · {receipt.color_name ?? "บรีส"} · ผลคัด #{receipt.qc_id}</p>
          <p>{receipt.recorded_by_username} · {new Date(receipt.recorded_at).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}</p>
        </Card>)}</div>
      </Section>
    </>}
    {editor && <FormDialog {...editor} api={api} scope="finishing" keyField="request_id"
      submitLabel="ยืนยันบันทึก" onClose={() => setEditor(undefined)} onStale={refresh} onSaved={async () => {
        setStatus("บันทึกแล้ว");
        await refresh();
      }} />}
  </div>;
}

function LoadForm({ sources }: { sources: Source[] }) {
  const [selected, setSelected] = useState("");
  return <>
    <Choice label="งานที่พร้อมเข้าเตา" name="source" value={selected} onChange={setSelected}
      options={sources.map((source, index) => ({ value: index,
        label: `${sourceName(source)} · ${source.customer_reference} · ${source.color_name ?? "บรีส"} · ${count(source.waiting_pieces)} แผ่น` }))} />
    <NumberField name="pieces" label="จำนวนแผ่นเข้าเตา" max={selected ? sources[Number(selected)]?.waiting_pieces : undefined} />
  </>;
}
