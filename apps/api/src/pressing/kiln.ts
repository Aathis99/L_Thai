import { fail } from '../auth.js';
import { all, audit, one, type Db } from '../database.js';
import { calendarDate, integer, pressingText } from './catalog.js';

type Body = Record<string, unknown>;
type Recorder = { id: number; username: string };
type Sorter = Recorder & { permissions: string[] };

async function requireKilnJob(db: Db, id: number) {
  const job = await one(db, "SELECT to_char(fired_on,'YYYY-MM-DD') AS fired_on FROM pressing_kiln_jobs WHERE id=$1", [id]);
  if (!job) fail('ไม่พบงานเผา', 404);
  return job;
}

export async function createKilnJob(db: Db, body: Body, actor: Recorder): Promise<number> {
  const requestId = pressingText(body.request_id, 'รหัสคำขอ', true);
  const reference = pressingText(body.reference, 'เลขอ้างอิงงานเผา', false);
  const firedOn = calendarDate(body.fired_on, 'วันที่เผา');
  const existing = await one(db, `SELECT id,reference,to_char(fired_on,'YYYY-MM-DD') AS fired_on
    FROM pressing_kiln_jobs WHERE request_id=$1`, [requestId]);
  if (existing) {
    if (existing.reference !== reference || existing.fired_on !== firedOn)
      fail('รหัสคำขอนี้มีข้อมูลงานเผาอื่นแล้ว', 409);
    return existing.id;
  }

  const { id } = await one(db, `INSERT INTO pressing_kiln_jobs(request_id,reference,fired_on,created_by)
    VALUES($1,$2,$3,$4) RETURNING id`, [requestId, reference, firedOn, actor.id]);
  await audit(db, actor.username, 'เพิ่มงานเผา', String(id));
  return id;
}

function parseIssueIds(value: unknown): number[] {
  if (value == null) return [];
  if (!Array.isArray(value)) fail('กรุณาระบุรายการเบิกให้ถูกต้อง');
  return [...new Set(value.map(id => integer(id, 'รายการเบิก')))].sort((a, b) => a - b);
}

export async function recordSortResult(db: Db, jobId: number, body: Body, actor: Sorter): Promise<number> {
  const requestId = pressingText(body.request_id, 'รหัสคำขอ', true);
  const typeId = integer(body.type_id, 'ประเภทกระเบื้อง');
  const sortedOn = calendarDate(body.sorted_on, 'วันที่คัด');
  const good = integer(body.good_pieces, 'จำนวนแผ่นดี', 0);
  const waste = integer(body.waste_pieces, 'จำนวนแผ่นเสีย', 0);
  const issueIds = parseIssueIds(body.issue_ids);
  const employeeId = body.employee_id == null ? null : integer(body.employee_id, 'ผู้ปั๊ม');
  const reason = pressingText(body.correction_reason, 'เหตุผลที่แก้ผลคัด', false);
  const job = await requireKilnJob(db, jobId);

  const payload = JSON.stringify({ kiln_job_id: jobId, type_id: typeId, sorted_on: sortedOn, good_pieces: good,
    waste_pieces: waste, issue_ids: issueIds, employee_id: employeeId, correction_reason: reason });
  const existing = await one(db, `SELECT id,revision,request_payload=$2::jsonb AS same_request
    FROM pressing_sort_results WHERE request_id=$1`, [requestId, payload]);
  if (existing && !existing.same_request) fail('รหัสคำขอนี้มีข้อมูลผลคัดอื่นแล้ว', 409);

  const revision = existing?.revision ?? (await one(db, `SELECT coalesce(max(revision),0)+1 AS revision
    FROM pressing_sort_results WHERE kiln_job_id=$1 AND type_id=$2`, [jobId, typeId])).revision;
  if (revision > 1 && !actor.permissions.includes('pressing.correct')) fail('คุณไม่มีสิทธิ์ทำรายการนี้', 403);
  if (existing) return existing.id;
  if (revision > 1 && !reason) fail('กรุณาระบุเหตุผลที่แก้ผลคัด');
  if (revision === 1 && reason) fail('ระบุเหตุผลที่แก้ผลคัดได้หลังส่งผลครั้งแรก');
  if (sortedOn < job.fired_on) fail('วันที่คัดต้องตรงกับหรืออยู่หลังวันที่เผา');
  if (!(await one(db, 'SELECT 1 FROM pressing_types WHERE id=$1', [typeId]))) fail('ไม่พบประเภทกระเบื้องที่เลือก');
  if (employeeId !== null && !(await one(db, 'SELECT 1 FROM employees WHERE id=$1', [employeeId])))
    fail('ไม่พบผู้ปั๊มที่เลือก');
  if (issueIds.length) {
    const matching = await all(db, 'SELECT id FROM pressing_issues WHERE id=ANY($1::integer[]) AND type_id=$2',
      [issueIds, typeId]);
    if (matching.length !== issueIds.length) fail('รายการเบิกไม่ตรงกับประเภทกระเบื้องที่คัด', 409);
  }

  const { id } = await one(db, `INSERT INTO pressing_sort_results(request_id,request_payload,kiln_job_id,type_id,
    revision,sorted_on,good_pieces,waste_pieces,employee_id,correction_reason,submitted_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
  [requestId, payload, jobId, typeId, revision, sortedOn, good, waste, employeeId, reason, actor.id]);
  if (issueIds.length)
    await db.query(`INSERT INTO pressing_sort_result_issues(result_id,issue_id)
      SELECT $1,unnest($2::integer[])`, [id, issueIds]);
  await audit(db, actor.username, revision === 1 ? 'ส่งผลคัดหลังเผา' : 'แก้ผลคัดหลังเผา', String(id));
  return id;
}

const resultFields = `r.id,r.kiln_job_id,r.type_id,r.revision,to_char(r.sorted_on,'YYYY-MM-DD') AS sorted_on,
  r.good_pieces,r.waste_pieces,r.employee_id,r.correction_reason,
  r.submitted_by,u.username AS submitted_by_username,r.submitted_at,
  ARRAY(SELECT issue_id FROM pressing_sort_result_issues WHERE result_id=r.id ORDER BY issue_id) AS issue_ids`;

export function listKilnJobs(db: Db) {
  return all(db, `SELECT j.id,coalesce(j.reference,'KILN-' || j.id) AS reference,
    to_char(j.fired_on,'YYYY-MM-DD') AS fired_on,j.created_by,u.username AS created_by_username,j.created_at,
    coalesce(totals.good_pieces,0) AS good_pieces,coalesce(totals.waste_pieces,0) AS waste_pieces,
    coalesce(totals.results,'[]'::jsonb) AS results
    FROM pressing_kiln_jobs j JOIN users u ON u.id=j.created_by
    LEFT JOIN LATERAL (
      SELECT sum(result.good_pieces)::double precision AS good_pieces,
        sum(result.waste_pieces)::double precision AS waste_pieces,
        jsonb_agg(to_jsonb(result) ORDER BY result.type_id) AS results
      FROM (
        SELECT DISTINCT ON (r.type_id) ${resultFields},true AS is_current
        FROM pressing_sort_results r JOIN users u ON u.id=r.submitted_by
        WHERE r.kiln_job_id=j.id ORDER BY r.type_id,r.revision DESC
      ) result
    ) totals ON true ORDER BY j.id`);
}

export async function listSortResults(db: Db, jobId: number) {
  await requireKilnJob(db, jobId);
  const rows = await all(db, `SELECT to_jsonb(result) AS item FROM (
      SELECT ${resultFields},r.revision=max(r.revision) OVER (PARTITION BY r.type_id) AS is_current
      FROM pressing_sort_results r JOIN users u ON u.id=r.submitted_by WHERE r.kiln_job_id=$1
    ) result ORDER BY result.type_id,result.revision`, [jobId]);
  return rows.map(row => row.item);
}
