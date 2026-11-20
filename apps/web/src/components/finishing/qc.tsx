import { pendingQcLoads } from "../../lib/finishing";
import { count, formText } from "../../lib/pressing";
import type { Api, SessionUser } from "../../lib/types";
import { Field } from "../fields";
import { Card, Choice, Facts, Section } from "../pressing/shared";
import FinishingPage, { action, DateField, NumberField, number } from "./shared";
import MeshPanel from "./mesh";

const resources = ["rounds", "qc"] as const;

export default function QcPage({ api, user, initialRoundId, openFinishedStock }: { api: Api; user: SessionUser; initialRoundId?: number; openFinishedStock: () => void; }) {
  return <FinishingPage api={api} user={user} resources={resources}>
    {(data, { can, open, reverse, orderName, tileName, refresh }) => {
      const orders = data.orders;
      const queue = data.rounds.map(round => ({ round, pending: pendingQcLoads(round) }))
        .filter(({ pending }) => pending.length > 0);
      const selectedIndex = queue.findIndex(({ round }) => round.id === initialRoundId);
      if (selectedIndex > 0) queue.unshift(...queue.splice(selectedIndex, 1));
      return <>
        <Section title="คิวรอคัด QC">
          {!queue.length && <p>ยังไม่มีรอบเผาที่รอคัด QC</p>}
          <div className="pressing-cards">{queue.map(({ round, pending }) => <Card key={round.id}
            title={`รอบ #${round.id} · เตา ${round.kiln}`}
            actions={can("qc") && action("บันทึกผลคัด", () => open("บันทึกผลคัด QC", "/qc",
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
                </>, "success"), "success")}>
            <p>เผาเสร็จ {round.finished_on}</p>
            <Facts values={{ "รอคัด (แผ่น)": count(pending.reduce((sum, load) => sum + load.unsorted_pieces, 0)) }} />
            <ul>{pending.map(load => <li key={load.id}>
              รายการเข้าเตา #{load.id} · {orderName(load.order_id)} · {count(load.unsorted_pieces)} แผ่น
            </li>)}</ul>
          </Card>)}</div>
        </Section>
      <Section title="ผลคัด QC">
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
              </>, "success"), "success")}
            {qc.stock_available > 0 && action("ไปที่สินค้าสำเร็จ", openFinishedStock, "secondary")}
            {can("correct") && action("แก้ผลคัด", () => open("แก้ผลคัด QC", "/qc-correction",
              form => ({ qc_id: qc.id, good_pieces: number(form, "good_pieces", "แผ่นดี", 0),
                waste_pieces: number(form, "waste_pieces", "แผ่นเสีย", 0), reason: formText(form, "reason") }),
              <>
                <NumberField name="good_pieces" label="แผ่นดี" min={0} defaultValue={qc.good_pieces} />
                <NumberField name="waste_pieces" label="แผ่นเสีย" min={0} defaultValue={qc.waste_pieces} />
                <Field name="reason" label="เหตุผลที่แก้ผลคัด" required />
              </>, "warning"), "warning")}
            {can("correct") && !qc.allocated_pieces && !qc.stocked_pieces &&
              reverse("ยกเลิกผลคัด", "/qc-void", "qc_id", qc.id)}
          </>}>
            <p>{qc.sorted_on} · {tileName(qc.type_id, qc.clay)}{qc.color_name && ` · ${qc.color_name}`}</p>
            {qc.product_name && <p>{qc.product_code} · {qc.product_name}{qc.production_clay_color && ` · สีที่ผสม ${qc.production_clay_color}`}</p>}
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
      </Section>
        <Section title="ยอดพร้อมส่งตามใบสั่ง">
          {!orders.length && <p>ยังไม่มีข้อมูลออเดอร์สำหรับงานผลิต</p>}
          <div className="pressing-cards">{orders.map(order => <Card key={order.id} title={orderName(order.id)}>
            {order.product_name && <p>{order.product_code} · {order.product_name}</p>}
            <p>{tileName(order.type_id, order.clay)}{order.color_name && ` · ${order.color_name}`}</p>
            <Facts values={{ "ยอดลูกค้าสั่ง": count(order.customer_pieces), "พร้อมส่ง": count(order.ready_pieces), "ยอดขาด": count(order.missing_pieces) }} />
          </Card>)}</div>
        </Section>
        <MeshPanel api={api} user={user} refreshToken={data.qc} onChanged={refresh} />
      </>;
    }}
  </FinishingPage>;
}
