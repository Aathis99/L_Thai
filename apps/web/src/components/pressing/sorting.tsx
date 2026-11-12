import { useState } from "react";
import {
  bangkokDate, count, destinations, formInteger, formText, tileName, timestamp, workerName,
  type KilnJob, type PressingData, type SortResult,
} from "../../lib/pressing";
import { Field } from "../fields";
import { Card, Check, Choice, Facts, FormDialog, HistoryDialog, Section, type PressingActions } from "./shared";

type Editor =
  | { kind: "job" }
  | { kind: "result"; job: KilnJob; result?: SortResult }
  | { kind: "history"; job: KilnJob };

type DialogProps = Pick<PressingActions, "api" | "onSaved"> & { onClose: () => void };

export default function Sorting({ data, actions }: { data: PressingData; actions: PressingActions }) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const canSort = actions.can("pressing.sort");
  const canRevise = canSort && actions.can("pressing.correct");
  const close = () => setEditor(null);
  const dialog = { api: actions.api, onSaved: actions.onSaved, onClose: close };
  return (
    <Section title="งานเผาและผลคัด" action={canSort && (
      <button className="button primary" onClick={() => setEditor({ kind: "job" })}>เพิ่มงานเผา</button>
    )}>
      {data.jobs.length ? (
        <div className="pressing-stack">
          {[...data.jobs].reverse().map((job) => (
            <Card key={job.id} title={`งานเผา ${job.reference}`} meta={`เผา ${job.fired_on}`}
              actions={
                <>
                  {canSort && data.types.some((tile) => !job.results.some((result) => result.type_id === tile.id)) && (
                    <button className="button primary" onClick={() => setEditor({ kind: "result", job })}>บันทึกผลคัด</button>
                  )}
                  <button className="button secondary" onClick={() => setEditor({ kind: "history", job })}>ประวัติผลคัด</button>
                </>
              }
            >
              <Facts values={{
                "ยอดดีรวม (แผ่น)": count(job.good_pieces),
                "ยอดเสียรวม (แผ่น)": count(job.waste_pieces),
              }} />
              {job.results.length ? (
                <div className="pressing-cards pressing-results">
                  {job.results.map((result) => (
                    <Card key={result.id} title={tileName(data.types, result.type_id)}
                      actions={canRevise && (
                        <button className="button secondary" onClick={() => setEditor({ kind: "result", job, result })}>แก้ผลคัด</button>
                      )}
                    >
                      <ResultFacts data={data} result={result} />
                    </Card>
                  ))}
                </div>
              ) : <p className="pressing-meta">รอส่งผลคัดหลังเผา</p>}
            </Card>
          ))}
        </div>
      ) : <p>ยังไม่มีงานเผา</p>}
      {editor?.kind === "job" && canSort && (
        <FormDialog {...dialog} title="เพิ่มงานเผา" path="/kiln-jobs" keyField="request_id" submitLabel="บันทึกงานเผา"
          build={(form) => ({ fired_on: formText(form, "fired_on"), reference: formText(form, "reference") })}
        >
          <div className="form-grid">
            <Field label="เลขอ้างอิงงานเผา" name="reference" />
            <Field label="วันที่เผา" name="fired_on" type="date" required defaultValue={bangkokDate()} />
          </div>
        </FormDialog>
      )}
      {editor?.kind === "result" && (editor.result ? canRevise : canSort) && (
        <ResultForm {...dialog} data={data} job={editor.job} result={editor.result} />
      )}
      {editor?.kind === "history" && (
        <HistoryDialog<SortResult> api={actions.api} title={`ประวัติผลคัด · ${editor.job.reference}`}
          path={`/kiln-jobs/${editor.job.id}/results`} onClose={close}
          render={(item) => (
            <Card title={tileName(data.types, item.type_id)}
              meta={<span className={`badge ${item.is_current ? "good" : "neutral"}`}>{item.is_current ? "ผลปัจจุบัน" : "ผลก่อนแก้"}</span>}
            >
              <ResultFacts data={data} result={item} />
            </Card>
          )}
        />
      )}
    </Section>
  );
}

function ResultFacts({ data, result }: { data: PressingData; result: SortResult }) {
  return (
    <>
      <Facts values={{
        "ครั้งที่ส่งผล": result.revision,
        "วันที่คัดเสร็จ": result.sorted_on,
        "แผ่นดี": count(result.good_pieces),
        "แผ่นเสีย": count(result.waste_pieces),
        "ใบเบิกอ้างอิง": result.issue_ids.length ? result.issue_ids.map((id) => `#${id}`).join(", ") : null,
        "ผู้ปั๊ม": result.employee_id === null ? null : workerName(data, result.employee_id),
        ...(result.correction_reason ? { "เหตุผลที่แก้ผลคัด": result.correction_reason } : {}),
      }} />
      <p className="pressing-meta">ส่งผลโดย {result.submitted_by_username} · {timestamp(result.submitted_at)}</p>
    </>
  );
}

function ResultForm({
  data, job, result, ...dialog
}: DialogProps & { data: PressingData; job: KilnJob; result?: SortResult }) {
  const [type, setType] = useState(result ? String(result.type_id) : "");
  const today = bangkokDate();
  const employees = new Map(data.entries.map((entry) => [entry.employee_id, entry.employee_name]));
  for (const worker of data.workers) employees.set(worker.id, `${worker.name} · ${worker.code}`);
  if (result?.employee_id && !employees.has(result.employee_id)) {
    employees.set(result.employee_id, workerName(data, result.employee_id));
  }
  return (
    <FormDialog {...dialog} title={result ? "แก้ผลคัดหลังเผา" : "บันทึกผลคัดหลังเผา"}
      path={`/kiln-jobs/${job.id}/results`} keyField="request_id" submitLabel={result ? "ยืนยันแก้ผลคัด" : "ส่งผลคัด"}
      build={(form) => ({
        type_id: result?.type_id ?? formInteger(form, "type_id", "ประเภทกระเบื้อง"),
        sorted_on: formText(form, "sorted_on"),
        good_pieces: formInteger(form, "good_pieces", "จำนวนแผ่นดี", 0),
        waste_pieces: formInteger(form, "waste_pieces", "จำนวนแผ่นเสีย", 0),
        issue_ids: form.getAll("issue_ids").map(Number),
        employee_id: formText(form, "employee_id") ? formInteger(form, "employee_id", "ผู้ปั๊ม") : null,
        ...(result ? { correction_reason: formText(form, "correction_reason") } : {}),
      })}
    >
      <p>งานเผา {job.reference} · เผา {job.fired_on}</p>
      {result ? <p>{tileName(data.types, result.type_id)}</p> : (
        <Choice label="ประเภทกระเบื้อง" name="type_id" value={type} onChange={setType}
          options={data.types.filter((tile) => !job.results.some((current) => current.type_id === tile.id))
            .map((tile) => ({ value: tile.id, label: tileName(data.types, tile.id) }))}
        />
      )}
      <div className="form-grid">
        <Field label="วันที่คัดเสร็จ" name="sorted_on" type="date" min={job.fired_on} required
          defaultValue={result?.sorted_on ?? (today < job.fired_on ? job.fired_on : today)} />
        <Field label="จำนวนแผ่นดี" name="good_pieces" type="number" min={0} step={1} required defaultValue={result?.good_pieces} />
        <Field label="จำนวนแผ่นเสีย" name="waste_pieces" type="number" min={0} step={1} required defaultValue={result?.waste_pieces} />
        <Choice label="ผู้ปั๊มที่ตามกลับได้" name="employee_id" empty="ไม่ระบุผู้ปั๊ม" defaultValue={result?.employee_id ?? ""}
          options={Array.from(employees, ([value, label]) => ({ value, label }))} />
      </div>
      {type && (
        <fieldset className="pressing-line" key={type}>
          <legend>ใบเบิกอ้างอิง (ถ้าทราบ)</legend>
          {data.issues.some((issue) => issue.type_id === Number(type)) ? (
            data.issues.filter((issue) => issue.type_id === Number(type)).map((issue) => (
              <Check key={issue.id} name="issue_ids" value={issue.id} defaultChecked={result?.issue_ids.includes(issue.id)}
                label={`ใบเบิก #${issue.id} · ${destinations[issue.destination]} · ${timestamp(issue.issued_at)}${issue.pooled ? " · กองรวม" : ""}`} />
            ))
          ) : <p className="helper">ยังไม่มีใบเบิกของประเภทนี้</p>}
        </fieldset>
      )}
      {result && <Field label="เหตุผลที่แก้ผลคัด" name="correction_reason" required />}
    </FormDialog>
  );
}
