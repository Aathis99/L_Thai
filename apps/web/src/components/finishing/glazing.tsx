import { count, formText } from "../../lib/pressing";
import type { Api, SessionUser } from "../../lib/types";
import { Field } from "../fields";
import { Card, Check, Facts, Section } from "../pressing/shared";
import FinishingPage, { action, DateField, NumberField, number } from "./shared";

const resources = ["issues", "glazing", "workers"] as const;

export default function GlazingPage({ api, user }: { api: Api; user: SessionUser }) {
  return <FinishingPage api={api} user={user} resources={resources}>
    {(data, { can, open, tileName, orderName }) => {
      const issues = data.issues.filter(issue => issue.destination === "color" && issue.net_pieces > 0);
      return <>
        <Section title="ใบเบิกสำหรับงานชุบ">
          {!issues.length && <p>ยังไม่มีใบเบิกที่ผูกใบสั่งผลิต</p>}
          <div className="pressing-cards">
            {issues.map(issue => <Card key={issue.id} title={`ใบเบิก #${issue.id} · ${issue.customer_reference ?? ""}`}
              actions={
                issue.finishing_ready && issue.unglazed_pieces > 0 && can("glaze")
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
                  </>, "success"), "success")
                  : !issue.finishing_ready && issue.customer_pieces && can("prepare")
                    ? action("ยืนยันยอดใบเบิกค้าง", () => open("ยืนยันยอดใบเบิกค้าง", "/confirm-issue",
                      form => ({ issue_id: issue.id, pieces: number(form, "pieces", "ยอดค้างที่ตรวจแล้ว") }),
                      <NumberField name="pieces" label="ยอดค้างที่ตรวจแล้ว (แผ่น)" max={issue.net_pieces} />, "success"), "success") : undefined
              }>
              <p>{tileName(issue.type_id, issue.clay)} · {issue.color_name ?? "รอระบุสีเคลือบ"}</p>
              <Facts values={{ "ยอดเบิกสุทธิ": count(issue.net_pieces),
                ...(issue.finishing_ready ? { "ยอดที่ยังบันทึกชุบได้": count(issue.unglazed_pieces) } : {}) }} />
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
            </>, "warning"), "warning")}>
            <p>{batch.worked_on} · ใบเบิก #{batch.issue_id} · {batch.workers.join(", ")}</p>
            <Facts values={{ "จำนวนแผ่นในชุด": count(batch.pieces), "ปั๊มเสีย": count(batch.pressing_waste),
              "ชุบเสีย": count(batch.glazing_waste), "ดีพร้อมเผา": count(batch.good_pieces),
              ...(batch.pieces_per_sqm ? { "พื้นที่ชุดชุบ (ตร.ม.)": count(batch.pieces / batch.pieces_per_sqm) } : {}) }} />
          </Card>)}</div>
        </Section>

      </>;
    }}
  </FinishingPage>;
}
