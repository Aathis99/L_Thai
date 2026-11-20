import { fail } from '../auth.js';
import { all, audit, one, type Db } from '../database.js';
import { calendarDate, integer, pressingText } from '../pressing/catalog.js';
import { finishingRequest, type Body, type Recorder } from './requests.js';

export const firingSources = `WITH sources AS (
  SELECT i.id AS issue_id,b.id AS batch_id,i.type_id,i.order_id,i.customer_reference,i.color_name,i.color_id,
    b.clay,b.pieces_per_sqm,b.good_pieces AS pieces,to_char(b.worked_on,'YYYY-MM-DD') AS ready_on
  FROM glazing_batches b JOIN finishing_issues i ON i.id=b.issue_id
  UNION ALL
  SELECT id,NULL,type_id,order_id,customer_reference,NULL,NULL,clay,pieces_per_sqm,least(net_pieces,finishing_confirmed_pieces),
    to_char(issued_at AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD')
  FROM finishing_issues WHERE destination='kiln' AND finishing_ready AND (customer_pieces IS NOT NULL OR purpose='stock')
)
SELECT s.*,s.pieces-coalesce(l.loaded,0)-coalesce((SELECT sum(d.pieces) FROM kiln_workflow_debits d
  WHERE d.issue_id=s.issue_id AND d.batch_id IS NOT DISTINCT FROM s.batch_id),0) AS waiting_pieces,
  coalesce(l.firing,0) AS firing_pieces,coalesce(l.awaiting_qc,0) AS awaiting_qc_pieces,
  coalesce(l.completed,0) AS completed_pieces,
  c.minimum AS clay_min,c.maximum AS clay_max,g.minimum AS color_min,g.maximum AS color_max
FROM sources s
LEFT JOIN firing_clay_ranges c ON c.clay=s.clay
LEFT JOIN firing_color_ranges g ON g.color_id=s.color_id
LEFT JOIN LATERAL (
  SELECT sum(l.pieces)::double precision AS loaded,
    sum(l.pieces) FILTER (WHERE r.finished_on IS NULL)::double precision AS firing,
    sum(l.unsorted_pieces) FILTER (WHERE r.finished_on IS NOT NULL)::double precision AS awaiting_qc,
    sum(l.pieces-l.unsorted_pieces)::double precision AS completed
  FROM firing_load_balances l JOIN firing_rounds r ON r.id=l.round_id
  WHERE l.issue_id=s.issue_id AND l.batch_id IS NOT DISTINCT FROM s.batch_id
) l ON true`;

export function listSources(db: Db) {
  return all(db, firingSources + ' ORDER BY s.issue_id,s.batch_id');
}

export function listRounds(db: Db) {
  return all(db, `SELECT r.*,to_char(r.started_on,'YYYY-MM-DD') AS started_on,
    to_char(r.finished_on,'YYYY-MM-DD') AS finished_on,
    coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM firing_load_balances l WHERE l.round_id=r.id),'[]') AS loads
    FROM firing_rounds r ORDER BY id DESC`);
}

export async function setRange(db: Db, body: Body, actor: Recorder) {
  const min = integer(body.minimum, 'อุณหภูมิต่ำสุด');
  const max = integer(body.maximum, 'อุณหภูมิสูงสุด', min);
  if (body.color_id !== undefined) {
    const id = integer(body.color_id, 'สีเคลือบ');
    if (!(await one(db, 'SELECT 1 FROM color_chart_entries WHERE id=$1 UNION ALL SELECT 1 FROM pressing_orders WHERE color_id=$1 LIMIT 1', [id])))
      fail('ไม่พบสีเคลือบ', 404);
    await db.query(`INSERT INTO firing_color_ranges VALUES($1,$2,$3)
      ON CONFLICT(color_id) DO UPDATE SET minimum=excluded.minimum,maximum=excluded.maximum`, [id, min, max]);
    await audit(db, actor.username, 'ตั้งช่วงอุณหภูมิสีเคลือบ', id + ' · ' + min + '–' + max + ' °C');
    return id;
  }
  const clay = body.clay;
  if (clay !== 'แดง' && clay !== 'ขาว' && clay !== 'จ้อ' && clay !== 'สี') fail('กรุณาเลือกประเภทดิน');
  await db.query(`INSERT INTO firing_clay_ranges VALUES($1,$2,$3)
    ON CONFLICT(clay) DO UPDATE SET minimum=excluded.minimum,maximum=excluded.maximum`, [clay, min, max]);
  await audit(db, actor.username, 'ตั้งช่วงอุณหภูมิประเภทดิน', clay + ' · ' + min + '–' + max + ' °C');
  return 0;
}

export function listRanges(db: Db) {
  return all(db, `SELECT clay,NULL AS color_id,minimum,maximum FROM firing_clay_ranges
    UNION ALL SELECT NULL,color_id,minimum,maximum FROM firing_color_ranges ORDER BY clay,color_id`);
}

export function createRound(db: Db, body: Body, actor: Recorder) {
  const kiln = pressingText(body.kiln, 'เตา', true);
  const temperature = integer(body.temperature, 'อุณหภูมิที่ตั้ง');
  const started = calendarDate(body.started_on, 'วันที่เข้าเตา');
  return finishingRequest(db, 'round', body, { kiln, temperature, started }, async () => {
    const { id } = await one(db, `INSERT INTO firing_rounds(kiln,temperature,started_on,recorded_by)
      VALUES($1,$2,$3,$4) RETURNING id`, [kiln, temperature, started, actor.id]);
    await audit(db, actor.username, 'เปิดรอบเผา', String(id));
    return id;
  });
}

export async function requireRound(db: Db, id: number) {
  const round = await one(db, `SELECT temperature,to_char(started_on,'YYYY-MM-DD') AS started_on,
    to_char(finished_on,'YYYY-MM-DD') AS finished_on FROM firing_rounds WHERE id=$1`, [id]);
  if (!round) fail('ไม่พบรอบเผา', 404);
  return round;
}

export function loadRound(db: Db, body: Body, actor: Recorder) {
  const roundId = integer(body.round_id, 'รอบเผา');
  const pieces = integer(body.pieces, 'จำนวนแผ่นเข้าเตา');
  const batchId = body.batch_id == null ? null : integer(body.batch_id, 'ชุดชุบ');
  const issueId = batchId === null ? integer(body.issue_id, 'ใบเบิกบรีส') : null;
  return finishingRequest(db, 'load', body, { roundId, batchId, issueId, pieces }, async () => {
    const round = await requireRound(db, roundId);
    if (round.finished_on) fail('รอบนี้เผาเสร็จแล้ว', 409);
    const source = await one(db, firingSources + (batchId === null ? ' WHERE s.batch_id IS NULL AND s.issue_id=$1' : ' WHERE s.batch_id=$1'),
      [batchId ?? issueId]);
    if (!source) fail('ไม่พบงานรอเผาที่เลือก', 404);
    if (pieces > source.waiting_pieces) fail('จำนวนแผ่นเกินยอดรอเผา', 409);
    if (round.started_on < source.ready_on) fail('วันที่เข้าเตาต้องตรงกับหรือหลังวันที่งานพร้อมเผา', 409);
    if (source.clay_min === null || (source.color_id !== null && source.color_min === null))
      fail('รอตั้งช่วงอุณหภูมิ', 409);
    if (round.temperature < source.clay_min || round.temperature > source.clay_max ||
      (source.color_id !== null && (round.temperature < source.color_min || round.temperature > source.color_max)))
      fail('อุณหภูมิที่ตั้งอยู่นอกช่วงของดินหรือสีเคลือบ', 409);
    const { id } = await one(db, `INSERT INTO firing_loads(round_id,issue_id,batch_id,type_id,order_id,color_id,
      color_name,clay,pieces_per_sqm,pieces,temperature_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [roundId, source.issue_id, batchId, source.type_id, source.order_id, source.color_id, source.color_name,
      source.clay, source.pieces_per_sqm, pieces, JSON.stringify({
        clay_min: source.clay_min, clay_max: source.clay_max, color_min: source.color_min, color_max: source.color_max,
      })]);
    await audit(db, actor.username, 'ยืนยันแผ่นเข้าเตา', String(id));
    return id;
  });
}

export function finishRound(db: Db, body: Body, actor: Recorder) {
  const id = integer(body.round_id, 'รอบเผา');
  const date = calendarDate(body.finished_on, 'วันที่เผาเสร็จ');
  return finishingRequest(db, 'finish', body, { id, date }, async () => {
    const round = await requireRound(db, id);
    if (round.finished_on) fail('บันทึกเผาเสร็จแล้ว', 409);
    if (date < round.started_on) fail('วันที่เผาเสร็จต้องตรงกับหรือหลังวันที่เข้าเตา');
    if (!(await one(db, 'SELECT 1 FROM firing_loads WHERE round_id=$1 AND pieces>0', [id]))) fail('ยังไม่มีแผ่นเข้าเตา', 409);
    await db.query('UPDATE firing_rounds SET finished_on=$2 WHERE id=$1', [id, date]);
    await audit(db, actor.username, 'บันทึกเผาเสร็จ', String(id));
    return id;
  });
}

export function correctLoad(db: Db, body: Body, actor: Recorder) {
  const id = integer(body.load_id, 'รายการเข้าเตา');
  const pieces = integer(body.pieces, 'จำนวนแผ่นเข้าเตา', 0);
  const reason = pressingText(body.reason, 'เหตุผลที่แก้ยอดเข้าเตา', true);
  return finishingRequest(db, 'load-correction', body, { id, pieces, reason }, async () => {
    const load = await one(db, 'SELECT * FROM firing_load_balances WHERE id=$1', [id]);
    if (!load) fail('ไม่พบรายการเข้าเตา', 404);
    const sorted = load.pieces - load.unsorted_pieces;
    if (pieces < sorted) fail('ยอดเข้าเตาใหม่ต่ำกว่ายอดที่คัดแล้ว', 409);
    const source = await one(db, firingSources + ' WHERE s.issue_id=$1 AND s.batch_id IS NOT DISTINCT FROM $2::integer',
      [load.issue_id, load.batch_id]);
    if (pieces > load.pieces + source.waiting_pieces) fail('จำนวนแผ่นเกินยอดรอเผา', 409);
    await db.query('UPDATE firing_loads SET pieces=$2 WHERE id=$1', [id, pieces]);
    await audit(db, actor.username, 'แก้ยอดเข้าเตา', id + ' · ' + load.pieces + ' → ' + pieces + ' · ' + reason);
    return id;
  });
}
