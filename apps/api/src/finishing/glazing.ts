import { fail } from '../auth.js';
import { all, audit, one, type Db } from '../database.js';
import { calendarDate, integer, pressingText } from '../pressing/catalog.js';
import { finishingRequest, type Body, type Recorder } from './requests.js';

export function listFinishingIssues(db: Db) {
  return all(db, `SELECT *,least(net_pieces,finishing_confirmed_pieces)-glazed_pieces AS unglazed_pieces FROM finishing_issues
    WHERE order_id IS NOT NULL ORDER BY id DESC`);
}

export function listGlazing(db: Db) {
  return all(db, `SELECT b.*,to_char(b.worked_on,'YYYY-MM-DD') AS worked_on,
    i.order_id,i.customer_reference,i.color_name,i.type_id,
    ARRAY(SELECT e.name FROM glazing_batch_workers w JOIN employees e ON e.id=w.employee_id
      WHERE w.batch_id=b.id ORDER BY e.id) AS workers
    FROM glazing_batches b JOIN finishing_issues i ON i.id=b.issue_id ORDER BY b.id DESC`);
}

export function confirmFinishingIssue(db: Db, body: Body, actor: Recorder) {
  const id = integer(body.issue_id, 'ใบเบิก');
  const pieces = integer(body.pieces, 'ยอดค้างที่ตรวจแล้ว');
  return finishingRequest(db, 'confirm-issue', body, { id, pieces }, async () => {
    const issue = await one(db, 'SELECT * FROM finishing_issues WHERE id=$1', [id]);
    if (!issue?.customer_pieces || (issue.destination === 'color' && !issue.color_id))
      fail('กรุณาเติมข้อมูลใบสั่งผลิตก่อนยืนยันใบเบิก', 409);
    if (issue.destination !== issue.production_destination)
      fail('ปลายทางใบเบิกต่างจากเส้นทางผลิตของใบสั่ง กรุณาตรวจและแก้ใบเบิกก่อนยืนยัน', 409);
    if (issue.clay !== issue.production_clay)
      fail('ประเภทดินในใบเบิกต่างจากใบสั่งผลิต กรุณาตรวจยอดค้างก่อนยืนยัน', 409);
    if (issue.finishing_ready) fail('ใบเบิกนี้ยืนยันแล้ว', 409);
    if (pieces > issue.net_pieces) fail('ยอดที่ยืนยันเกินยอดเบิกสุทธิ', 409);
    await db.query('UPDATE pressing_issues SET finishing_ready=true,finishing_confirmed_pieces=$2,finishing_clay=$3 WHERE id=$1',
      [id, pieces, issue.clay]);
    await audit(db, actor.username, 'ตรวจยืนยันยอดค้างใบเบิก', id + ' · ' + pieces + ' แผ่น');
    return id;
  });
}

function glazingCounts(body: Body, minimum = 1) {
  const pieces = integer(body.pieces, 'จำนวนแผ่นที่รับมาชุบ', minimum);
  const pressingWaste = integer(body.pressing_waste, 'แผ่นปั๊มเสีย', 0);
  const glazingWaste = integer(body.glazing_waste, 'แผ่นชุบเสีย', 0);
  const good = integer(body.good_pieces, 'แผ่นดีพร้อมเผา', 0);
  if (pressingWaste + glazingWaste + good !== pieces) fail('ผลชุบรวมต้องเท่ากับจำนวนที่รับมาชุบ');
  return { pieces, pressingWaste, glazingWaste, good };
}

export async function recordGlazing(db: Db, body: Body, actor: Recorder) {
  const issueId = integer(body.issue_id, 'ใบเบิก');
  const workedOn = calendarDate(body.worked_on, 'วันที่ชุบ');
  const { pieces, pressingWaste, glazingWaste, good } = glazingCounts(body);
  if (!Array.isArray(body.worker_ids) || !body.worker_ids.length) fail('กรุณาเลือกผู้ทำงานอย่างน้อยหนึ่งคน');
  const workers = [...new Set(body.worker_ids.map(id => integer(id, 'ผู้ทำงาน')))].sort((a, b) => a - b);
  const payload = { issueId, workedOn, pieces, pressingWaste, glazingWaste, good, workers };
  return finishingRequest(db, 'glazing', body, payload, async () => {
    const issue = await one(db, `SELECT *,to_char(issued_at AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD') AS issued_on
      FROM finishing_issues WHERE id=$1`, [issueId]);
    if (!issue || issue.destination !== 'color') fail('ไม่พบใบเบิกไปงานชุบ', 404);
    if (!issue.finishing_ready || !issue.customer_pieces || !issue.color_id)
      fail('กรุณาตรวจยืนยันใบเบิกและข้อมูลใบสั่งผลิตก่อนบันทึกชุบ', 409);
    if (workedOn < issue.issued_on) fail('วันที่ชุบต้องตรงกับหรือหลังวันที่เบิก');
    if (pieces > Math.min(issue.net_pieces, issue.finishing_confirmed_pieces ?? Infinity) - issue.glazed_pieces)
      fail('จำนวนแผ่นเกินยอดเบิกที่ยังบันทึกชุบได้', 409);

    const active = await all(db, 'SELECT id FROM employees WHERE id=ANY($1::integer[]) AND active=1 AND archived=0', [workers]);
    if (active.length !== workers.length) fail('มีผู้ทำงานที่ไม่อยู่ในทะเบียนพนักงานที่ใช้งาน');
    const { id } = await one(db, `INSERT INTO glazing_batches(issue_id,worked_on,pieces,pressing_waste,glazing_waste,
      good_pieces,clay,pieces_per_sqm,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [issueId, workedOn, pieces, pressingWaste, glazingWaste, good, issue.clay, issue.pieces_per_sqm, actor.id]);
    await db.query('INSERT INTO glazing_batch_workers(batch_id,employee_id) SELECT $1,unnest($2::integer[])', [id, workers]);
    await audit(db, actor.username, 'บันทึกชุดงานชุบเคลือบ', String(id));
    return id;
  });
}

export function correctGlazing(db: Db, body: Body, actor: Recorder) {
  const id = integer(body.batch_id, 'ชุดชุบ');
  const counts = glazingCounts(body, 0);
  const reason = pressingText(body.reason, 'เหตุผลที่แก้ผลชุบ', true);
  return finishingRequest(db, 'glazing-correction', body, { id, ...counts, reason }, async () => {
    const row = await one(db, `SELECT b.*,least(i.net_pieces,i.finishing_confirmed_pieces)-i.glazed_pieces+b.pieces AS available,
      coalesce((SELECT sum(pieces) FROM firing_loads WHERE batch_id=b.id),0)::double precision AS loaded
      FROM glazing_batches b JOIN finishing_issues i ON i.id=b.issue_id WHERE b.id=$1`, [id]);
    if (!row) fail('ไม่พบชุดงานชุบ', 404);
    if (counts.good < row.loaded) fail('ยอดดีใหม่ต่ำกว่ายอดเข้าเตาแล้ว', 409);
    if (counts.pieces > row.available) fail('จำนวนแผ่นเกินยอดเบิกที่ยังบันทึกชุบได้', 409);
    await db.query(`UPDATE glazing_batches SET pieces=$2,pressing_waste=$3,glazing_waste=$4,good_pieces=$5 WHERE id=$1`,
      [id, counts.pieces, counts.pressingWaste, counts.glazingWaste, counts.good]);
    await audit(db, actor.username, 'แก้ยอดงานชุบ',
      id + ' · ' + [row.pieces, row.pressing_waste, row.glazing_waste, row.good_pieces].join('/') +
      ' → ' + [counts.pieces, counts.pressingWaste, counts.glazingWaste, counts.good].join('/') + ' · ' + reason);
    return id;
  });
}
