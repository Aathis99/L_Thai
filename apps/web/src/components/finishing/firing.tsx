import { useState } from "react";
import { pendingQcLoads } from "../../lib/finishing";
import { count, formText } from "../../lib/pressing";
import type { Api, SessionUser } from "../../lib/types";
import { Field } from "../fields";
import { Card, Choice, Facts, Section } from "../pressing/shared";
import FinishingPage, { action, DateField, NumberField, number, type Round, type Source } from "./shared";

const resources = ["issues", "sources", "rounds"] as const;

export default function FiringPage({ api, user, openQc }: { api: Api; user: SessionUser; openQc: (roundId: number) => void; }) {
  return <FinishingPage api={api} user={user} resources={resources}>
    {(data, { can, open, orderName, tileName }) => {
      const legacyBreeze = data.issues.filter(issue => issue.destination === "kiln" && !issue.finishing_ready && issue.net_pieces > 0);
      return <>
        {legacyBreeze.length > 0 && <Section title="ใบเบิกบรีสรอยืนยัน">
          <div className="pressing-cards">{legacyBreeze.map(issue => <Card key={issue.id}
            title={`ใบเบิกบรีส #${issue.id} · ${issue.customer_reference ?? ""}`}
            actions={issue.customer_pieces && can("prepare") ? action("ยืนยันยอดใบเบิกค้าง", () =>
              open("ยืนยันยอดใบเบิกค้าง", "/confirm-issue",
                form => ({ issue_id: issue.id, pieces: number(form, "pieces", "ยอดค้างที่ตรวจแล้ว") }),
                <NumberField name="pieces" label="ยอดค้างที่ตรวจแล้ว (แผ่น)" max={issue.net_pieces} />)) : undefined}>
            <p>{tileName(issue.type_id, issue.clay)}</p>
            <Facts values={{ "ยอดเบิกสุทธิ": count(issue.net_pieces) }} />
            <p>{issue.customer_pieces ? "รอตรวจยืนยันใบเบิกค้าง" : "รอเติมข้อมูลใบสั่งผลิต"}</p>
          </Card>)}</div>
        </Section>}
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
            const pending = pendingQcLoads(round);
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
              </> : pending.length > 0 && action("ไปคัด QC", () => openQc(round.id))}>
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

      </>;
    }}
  </FinishingPage>;
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

function LoadForm({ sources }: { sources: Source[] }) {
  const [selected, setSelected] = useState("");
  return <>
    <Choice label="งานที่พร้อมเข้าเตา" name="source" value={selected} onChange={setSelected}
      options={sources.map((source, index) => ({ value: index,
        label: `${sourceName(source)} · ${source.customer_reference} · ${source.color_name ?? "บรีส"} · ${count(source.waiting_pieces)} แผ่น` }))} />
    <NumberField name="pieces" label="จำนวนแผ่นเข้าเตา" max={selected ? sources[Number(selected)]?.waiting_pieces : undefined} />
  </>;
}
