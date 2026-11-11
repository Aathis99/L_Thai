import { fail } from '../auth.js';
import { all, audit, one, type Db } from '../database.js';
import { calendarDate, integer, pressingText } from './catalog.js';

type Body = Record<string, unknown>;
type Recorder = { id: number; username: string };

function restEnd(pressedOn: string, restDays: number): string {
  const date = new Date(pressedOn + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + restDays);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() > 9999) fail('วันครบกำหนดพักอยู่นอกช่วงที่รองรับ');
  return date.toISOString().slice(0, 10);
}

export function listEntries(db: Db, orderId?: number) {
  return all(db, `SELECT e.id,e.order_id,to_char(e.pressed_on,'YYYY-MM-DD') AS pressed_on,
    e.full_racks,e.loose_pieces,e.note,e.effective_pieces AS pieces,e.original_pieces,e.pieces_per_rack,e.rest_days,
    to_char(s.ready_on,'YYYY-MM-DD') AS ready_on,
    CASE WHEN e.effective_pieces=e.pieces THEN e.square_meters
      ELSE e.effective_pieces/e.pieces_per_sqm END AS square_meters,
    e.employee_id,w.name AS employee_name,e.recorded_by,u.username AS recorded_by_username,e.recorded_at
    FROM pressing_effective_entries e JOIN pressing_stock_sources s ON s.entry_id=e.id
    JOIN employees w ON w.id=e.employee_id JOIN users u ON u.id=e.recorded_by
    ${orderId === undefined ? '' : 'WHERE e.order_id=$1'} ORDER BY e.id`,
  orderId === undefined ? [] : [orderId]);
}

function parseEntryValues(body: Body) {
  return {
    pressed_on: calendarDate(body.pressed_on, 'วันที่ปั๊ม'),
    employee_id: integer(body.employee_id, 'ผู้ปั๊ม'),
    full_racks: integer(body.full_racks, 'จำนวนไม้เต็ม', 0),
    loose_pieces: integer(body.loose_pieces ?? 0, 'จำนวนแผ่นเศษ', 0),
    note: pressingText(body.note, 'หมายเหตุ', false),
  };
}

async function requireActiveWorker(db: Db, employeeId: number) {
  if (!(await one(db, 'SELECT 1 FROM employees WHERE id=$1 AND active=1 AND archived=0', [employeeId])))
    fail('กรุณาเลือกผู้ปั๊มที่ยังทำงานอยู่');
}

function entrySquareMeters(pieces: number, piecesPerSqm: number | null): number | null {
  if (piecesPerSqm === null) return null;
  const squareMeters = pieces / piecesPerSqm;
  if (!Number.isFinite(squareMeters)) fail('จำนวน ตร.ม. อยู่นอกช่วงที่รองรับ');
  return squareMeters;
}

export async function recordEntry(db: Db, body: Body, actor: Recorder): Promise<number> {
  const requestId = pressingText(body.request_id, 'รหัสคำขอ', true);
  const orderId = integer(body.order_id, 'ใบสั่งผลิต');
  const { pressed_on: pressedOn, employee_id: employeeId, full_racks: racks,
    loose_pieces: loose, note } = parseEntryValues(body);
  const existing = await one(db, `SELECT e.id,e.order_id,to_char(e.pressed_on,'YYYY-MM-DD') AS pressed_on,
    e.employee_id,e.full_racks,e.loose_pieces,e.note,(
      SELECT previous_values FROM pressing_entry_adjustments WHERE entry_id=e.id AND request_id IS NULL
      ORDER BY id LIMIT 1
    ) AS original_values FROM pressing_entries e WHERE e.request_id=$1`, [requestId]);
  if (existing) {
    const original = existing.original_values ?? existing;
    if (existing.order_id !== orderId || original.pressed_on !== pressedOn || original.employee_id !== employeeId
      || original.full_racks !== racks || original.loose_pieces !== loose || original.note !== note)
      fail('รหัสคำขอนี้มีข้อมูลยอดปั๊มอื่นแล้ว', 409);
    return existing.id;
  }

  const type = await one(db, `SELECT t.id,t.active,t.pieces_per_rack,t.rest_days,t.pieces_per_sqm,t.destination
    FROM pressing_orders o JOIN pressing_types t ON t.id=o.type_id WHERE o.id=$1`, [orderId]);
  if (!type) fail('ไม่พบใบสั่งผลิตที่เลือก');
  if (!type.active) fail('ประเภทกระเบื้องที่เลือกหยุดใช้แล้ว', 409);
  await requireActiveWorker(db, employeeId);
  const pieces = integer(racks * type.pieces_per_rack + loose, 'ยอดปั๊ม');
  const readyOn = restEnd(pressedOn, type.rest_days);
  const squareMeters = entrySquareMeters(pieces, type.pieces_per_sqm);

  const { id } = await one(db, `INSERT INTO pressing_entries(request_id,order_id,pressed_on,employee_id,
    full_racks,loose_pieces,note,pieces,pieces_per_rack,rest_days,pieces_per_sqm,square_meters,recorded_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
  [requestId, orderId, pressedOn, employeeId, racks, loose, note, pieces,
    type.pieces_per_rack, type.rest_days, type.pieces_per_sqm, squareMeters, actor.id]);
  await db.query(`INSERT INTO pressing_stock_sources(type_id,entry_id,ready_on,destination)
    VALUES($1,$2,$3,$4)`, [type.id, id, readyOn, type.destination]);
  await audit(db, actor.username, 'บันทึกยอดปั๊ม', String(id));
  return id;
}

export async function recordOpening(db: Db, body: Body, actor: Recorder): Promise<number> {
  const sourceKey = pressingText(body.source_key, 'รหัสแหล่งยอดตั้งต้น', true);
  const typeId = integer(body.type_id, 'ประเภทกระเบื้อง');
  const asOf = calendarDate(body.as_of, 'วันที่ตรวจยอดตั้งต้น');
  const pieces = integer(body.pieces, 'จำนวนแผ่นตั้งต้น');
  const readyOn = body.ready_on == null ? null : calendarDate(body.ready_on, 'วันครบกำหนดพัก');
  const readyConfirmed = body.ready_confirmed;
  if (typeof readyConfirmed !== 'boolean') fail('กรุณาระบุสถานะยืนยันความพร้อม');
  const existing = await one(db, `SELECT id,type_id,to_char(as_of,'YYYY-MM-DD') AS as_of,
    opening_pieces,to_char(ready_on,'YYYY-MM-DD') AS ready_on,ready_confirmed
    FROM pressing_stock_sources WHERE source_key=$1`, [sourceKey]);
  if (existing) {
    if (existing.type_id !== typeId || existing.as_of !== asOf || existing.opening_pieces !== pieces
      || existing.ready_on !== readyOn || existing.ready_confirmed !== readyConfirmed)
      fail('รหัสแหล่งยอดตั้งต้นนี้มีข้อมูลอื่นแล้ว', 409);
    return existing.id;
  }

  const type = await one(db, 'SELECT active,destination FROM pressing_types WHERE id=$1', [typeId]);
  if (!type) fail('ไม่พบประเภทกระเบื้องที่เลือก');
  if (!type.active) fail('ประเภทกระเบื้องที่เลือกหยุดใช้แล้ว', 409);
  const { id } = await one(db, `INSERT INTO pressing_stock_sources(type_id,source_key,as_of,opening_pieces,
    ready_on,ready_confirmed,destination) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
  [typeId, sourceKey, asOf, pieces, readyOn, readyConfirmed, type.destination]);
  await audit(db, actor.username, 'บันทึกยอดตั้งต้นงานปั๊ม', String(id));
  return id;
}

const stockSources = `FROM pressing_stock_sources s LEFT JOIN pressing_effective_entries e ON e.id=s.entry_id
  LEFT JOIN pressing_orders o ON o.id=e.order_id
  CROSS JOIN LATERAL (
    SELECT coalesce(sum(pieces) FILTER (WHERE allocation='general'),0) AS general,
      coalesce(sum(pieces) FILTER (WHERE allocation='order'),0) AS restricted,
      count(*) > 0 AS has_issues
    FROM pressing_net_issue_lines WHERE source_id=s.id
  ) issued
  CROSS JOIN LATERAL (
    SELECT coalesce(sum(pieces),0) AS pieces FROM pressing_releases WHERE source_id=s.id
  ) released`;

const stockBalances = `SELECT s.id,s.type_id,s.entry_id,e.order_id,to_char(e.pressed_on,'YYYY-MM-DD') AS pressed_on,
  to_char(s.as_of,'YYYY-MM-DD') AS as_of,to_char(s.ready_on,'YYYY-MM-DD') AS ready_on,
  coalesce(s.ready_on <= (statement_timestamp() AT TIME ZONE 'Asia/Bangkok')::date,
    s.ready_confirmed OR s.ready_confirmed_later) AS ready,
  s.destination,(coalesce(e.effective_pieces,s.opening_pieces)-issued.general-issued.restricted)::integer AS remaining_pieces,
  ((CASE WHEN o.purpose='customer' THEN released.pieces ELSE coalesce(e.effective_pieces,s.opening_pieces) END)
    -issued.general)::integer AS general_pieces,
  ((CASE WHEN o.purpose='customer' THEN e.effective_pieces-released.pieces ELSE 0 END)
    -issued.restricted)::integer AS restricted_pieces
  ${stockSources}`;

export function listStock(db: Db) {
  return all(db, stockBalances + ' ORDER BY s.id');
}

async function entryForCorrection(db: Db, entryId: number) {
  const entry = await one(db, `SELECT e.order_id,e.pieces_per_rack,e.pieces_per_sqm,e.rest_days,e.effective_pieces,
    jsonb_build_object('pressed_on',to_char(e.pressed_on,'YYYY-MM-DD'),'employee_id',e.employee_id,
      'full_racks',e.full_racks,'loose_pieces',e.loose_pieces,'note',e.note,
      'ready_on',to_char(s.ready_on,'YYYY-MM-DD')) AS values,
    (issued.has_issues OR released.pieces > 0) AS has_movement,
    (CASE WHEN o.purpose='customer' THEN issued.restricted + released.pieces
      ELSE issued.general END)::integer AS minimum_pieces
    ${stockSources} WHERE s.entry_id=$1`, [entryId]);
  if (!entry) fail('ไม่พบรายการปั๊มที่เลือก', 404);
  return entry;
}

export async function editEntry(db: Db, entryId: number, body: Body, actor: Recorder): Promise<number> {
  const values = parseEntryValues(body);
  const entry = await entryForCorrection(db, entryId);
  if (body.order_id !== undefined && body.order_id !== entry.order_id)
    fail('เปลี่ยนใบสั่งผลิตของรายการปั๊มไม่ได้', 409);
  if (entry.has_movement) fail('รายการนี้มีการเบิกหรือปล่อยยอดแล้ว กรุณาลงรายการปรับยอด', 409);
  const before = entry.values;
  if (Object.entries(values).every(([key, value]) => before[key] === value)) return entryId;
  if (before.employee_id !== values.employee_id) await requireActiveWorker(db, values.employee_id);
  const pieces = integer(values.full_racks * entry.pieces_per_rack + values.loose_pieces, 'ยอดปั๊ม');
  const readyOn = restEnd(values.pressed_on, entry.rest_days);
  const squareMeters = entrySquareMeters(pieces, entry.pieces_per_sqm);

  const { corrected_at } = await one(db, `INSERT INTO pressing_entry_adjustments(entry_id,previous_pieces,
    corrected_pieces,previous_values,corrected_values,corrected_by,corrected_at)
    VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()) RETURNING corrected_at::text`,
  [entryId, entry.effective_pieces, pieces, before, { ...values, ready_on: readyOn }, actor.id]);
  await db.query(`UPDATE pressing_entries SET pressed_on=$2,employee_id=$3,full_racks=$4,
    loose_pieces=$5,note=$6,pieces=$7,square_meters=$8 WHERE id=$1`,
  [entryId, values.pressed_on, values.employee_id, values.full_racks, values.loose_pieces, values.note, pieces, squareMeters]);
  await db.query('UPDATE pressing_stock_sources SET ready_on=$2 WHERE entry_id=$1', [entryId, readyOn]);
  await auditMovement(db, actor, 'แก้ไขรายการปั๊ม', entryId, corrected_at);
  return entryId;
}

export async function adjustEntry(db: Db, entryId: number, body: Body, actor: Recorder): Promise<number> {
  const requestId = pressingText(body.request_id, 'รหัสคำขอ', true);
  const pieces = integer(body.corrected_pieces, 'ยอดปั๊มที่แก้ไข', 0);
  const reason = pressingText(body.reason, 'เหตุผลที่ปรับยอด', true);
  const existing = await one(db, `SELECT id,entry_id,corrected_pieces,reason FROM pressing_entry_adjustments
    WHERE request_id=$1`, [requestId]);
  if (existing) {
    if (existing.entry_id !== entryId || existing.corrected_pieces !== pieces || existing.reason !== reason)
      fail('รหัสคำขอนี้มีข้อมูลปรับยอดอื่นแล้ว', 409);
    return existing.id;
  }

  const entry = await entryForCorrection(db, entryId);
  if (!entry.has_movement) fail('รายการนี้ยังไม่มีการเบิกหรือปล่อยยอด กรุณาแก้ไขรายการปั๊ม', 409);
  if (pieces < entry.minimum_pieces) fail('ยอดปั๊มที่แก้ไขต่ำกว่ายอดที่เบิกหรือปล่อยแล้ว', 409);
  entrySquareMeters(pieces, entry.pieces_per_sqm);
  const { id, corrected_at } = await one(db, `INSERT INTO pressing_entry_adjustments(entry_id,request_id,
    previous_pieces,corrected_pieces,reason,corrected_by,corrected_at)
    VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()) RETURNING id,corrected_at::text`,
  [entryId, requestId, entry.effective_pieces, pieces, reason, actor.id]);
  await auditMovement(db, actor, 'ปรับยอดปั๊ม', entryId, corrected_at);
  return id;
}

export async function listEntryAdjustments(db: Db, entryId: number) {
  if (!(await one(db, 'SELECT 1 FROM pressing_entries WHERE id=$1', [entryId])))
    fail('ไม่พบรายการปั๊มที่เลือก', 404);
  return all(db, `SELECT a.id,a.entry_id,CASE WHEN a.request_id IS NULL THEN 'edit' ELSE 'adjustment' END AS kind,
    a.previous_pieces,a.corrected_pieces,a.previous_values,a.corrected_values,a.reason,
    a.corrected_by,u.username AS corrected_by_username,a.corrected_at
    FROM pressing_entry_adjustments a JOIN users u ON u.id=a.corrected_by WHERE a.entry_id=$1 ORDER BY a.id`, [entryId]);
}

export async function confirmOpeningReady(db: Db, id: number, body: Body, actor: Recorder): Promise<number> {
  if (body.confirmed_ready !== true) fail('กรุณายืนยันความพร้อมของยอดตั้งต้น');
  const source = await one(db, `SELECT entry_id,ready_on,ready_confirmed,ready_confirmed_later
    FROM pressing_stock_sources WHERE id=$1`, [id]);
  if (!source) fail('ไม่พบแหล่งสต็อกที่เลือก', 404);
  if (source.entry_id !== null || source.ready_on !== null)
    fail('ยืนยันความพร้อมได้เฉพาะยอดตั้งต้นที่ไม่มีวันครบกำหนดพัก', 409);
  if (!source.ready_confirmed && !source.ready_confirmed_later) {
    await db.query('UPDATE pressing_stock_sources SET ready_confirmed_later=true WHERE id=$1', [id]);
    await audit(db, actor.username, 'ยืนยันความพร้อมยอดตั้งต้น', String(id));
  }
  return id;
}

export function listIssues(db: Db) {
  return all(db, `SELECT i.id,i.type_id,i.order_id,i.destination,i.confirmed_ready,i.pooled,
    i.issued_by,u.username AS issued_by_username,i.issued_at,
    jsonb_agg(jsonb_build_object('id',l.id,'source_id',l.source_id,'pieces',l.pieces,
      'allocation',l.allocation) ORDER BY l.id) AS lines
    FROM pressing_issues i JOIN users u ON u.id=i.issued_by JOIN pressing_issue_lines l ON l.issue_id=i.id
    GROUP BY i.id,u.username ORDER BY i.id`);
}

type IssueLine = { source_id: number; pieces: number; allocation: 'general' | 'order' };

function parseIssueLines(value: unknown): IssueLine[] {
  if (!Array.isArray(value) || !value.length) fail('กรุณาระบุรายการเบิกอย่างน้อยหนึ่งรายการ');
  const lines = value.map((line: unknown): IssueLine => {
    if (!line || typeof line !== 'object') fail('รายการเบิกไม่ถูกต้อง');
    const { source_id, pieces, allocation } = line as Body;
    if (allocation !== 'general' && allocation !== 'order') fail('กรุณาเลือกส่วนสต็อกที่ต้องการเบิก');
    return { source_id: integer(source_id, 'แหล่งสต็อก'), pieces: integer(pieces, 'จำนวนแผ่นที่เบิก'), allocation };
  });
  return lines.sort((a, b) => a.source_id - b.source_id || a.allocation.localeCompare(b.allocation) || a.pieces - b.pieces);
}

function auditMovement(db: Db, actor: Recorder, action: string, id: number, movedAt: string) {
  return db.query('INSERT INTO audit(actor,action,target,created_at) VALUES($1,$2,$3,$4)',
    [actor.username, action, String(id), movedAt]);
}

export async function recordIssue(db: Db, body: Body, actor: Recorder): Promise<number> {
  const requestId = pressingText(body.request_id, 'รหัสคำขอ', true);
  const typeId = integer(body.type_id, 'ประเภทกระเบื้อง');
  const orderId = body.order_id == null ? null : integer(body.order_id, 'ใบสั่งผลิต');
  const destination = body.destination;
  if (destination !== 'color' && destination !== 'kiln') fail('กรุณาเลือกปลายทางเบิก');
  const confirmedReady = body.confirmed_ready;
  if (typeof confirmedReady !== 'boolean') fail('กรุณาระบุสถานะยืนยันความพร้อม');
  const pooled = body.pooled === undefined ? false : body.pooled;
  if (typeof pooled !== 'boolean') fail('กรุณาระบุว่าเบิกจากกองรวมหรือไม่');
  const lines = parseIssueLines(body.lines);

  // Keep the normalized request separately from the quantities used for stock and corrections.
  const payload = JSON.stringify({ type_id: typeId, order_id: orderId, destination,
    confirmed_ready: confirmedReady, pooled, lines });
  const existing = await one(db, `SELECT id,request_payload=$2::jsonb AS same_request
    FROM pressing_issues WHERE request_id=$1`, [requestId, payload]);
  if (existing) {
    if (!existing.same_request) fail('รหัสคำขอนี้มีข้อมูลเบิกอื่นแล้ว', 409);
    return existing.id;
  }
  if (!confirmedReady) fail('ต้องยืนยันความพร้อมก่อนเบิก', 409);
  if (orderId !== null && !(await one(db, 'SELECT 1 FROM pressing_orders WHERE id=$1 AND type_id=$2', [orderId, typeId])))
    fail('ใบสั่งผลิตที่เลือกไม่ตรงกับประเภทกระเบื้องที่เบิก', 409);

  const combined = new Map<string, IssueLine>();
  for (const line of lines) {
    const key = line.source_id + ':' + line.allocation;
    const previous = combined.get(key);
    combined.set(key, { ...line, pieces: (previous?.pieces ?? 0) + line.pieces });
  }
  const sourceIds = [...new Set(lines.map(line => line.source_id))];
  const sources = await all(db, stockBalances + ' WHERE s.id=ANY($1::integer[])', [sourceIds]);
  const sourcesById = new Map(sources.map(source => [source.id, source]));
  for (const line of combined.values()) {
    const source = sourcesById.get(line.source_id);
    if (!source || source.type_id !== typeId) fail('แหล่งสต็อกไม่ตรงกับประเภทกระเบื้องที่เบิก', 409);
    if (!source.ready) fail('แหล่งสต็อกยังไม่พร้อมเบิก', 409);
    if (source.destination !== destination) fail('ปลายทางเบิกไม่ตรงกับแหล่งสต็อก', 409);
    if (line.allocation === 'order' && (orderId === null || source.order_id !== orderId))
      fail('ยอดที่ผูกใบสั่งใช้ได้เฉพาะกับใบสั่งผลิตเดิม', 409);
    const available = line.allocation === 'order' ? source.restricted_pieces : source.general_pieces;
    if (line.pieces > available) fail('จำนวนแผ่นที่เบิกมากกว่ายอดที่ใช้ได้', 409);
  }

  const { id, issued_at } = await one(db, `INSERT INTO pressing_issues(request_id,request_payload,type_id,order_id,
    destination,confirmed_ready,pooled,issued_by,issued_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,clock_timestamp()) RETURNING id,issued_at::text`,
  [requestId, payload, typeId, orderId, destination, confirmedReady, pooled, actor.id]);
  await db.query(`INSERT INTO pressing_issue_lines(issue_id,source_id,pieces,allocation)
    SELECT $1,source_id,pieces,allocation FROM jsonb_to_recordset($2::jsonb)
      AS line(source_id integer,pieces integer,allocation text) ORDER BY source_id,allocation`,
  [id, JSON.stringify([...combined.values()])]);
  await auditMovement(db, actor, 'ยืนยันเบิกสต็อกงานปั๊ม', id, issued_at);
  return id;
}

type ReversalLine = { issue_line_id: number; pieces: number };

function parseReversalLines(value: unknown): ReversalLine[] {
  if (!Array.isArray(value) || !value.length) fail('กรุณาระบุรายการย้อนเบิกอย่างน้อยหนึ่งรายการ');
  const lines = value.map((line: unknown): ReversalLine => {
    if (!line || typeof line !== 'object') fail('รายการย้อนเบิกไม่ถูกต้อง');
    const { issue_line_id, pieces } = line as Body;
    return {
      issue_line_id: integer(issue_line_id, 'รายการที่เบิก'),
      pieces: integer(pieces, 'จำนวนแผ่นที่คืน'),
    };
  });
  return lines.sort((a, b) => a.issue_line_id - b.issue_line_id || a.pieces - b.pieces);
}

async function requireIssue(db: Db, issueId: number) {
  if (!(await one(db, 'SELECT 1 FROM pressing_issues WHERE id=$1', [issueId])))
    fail('ไม่พบรายการเบิกที่เลือก', 404);
}

export async function reverseIssue(db: Db, issueId: number, body: Body, actor: Recorder): Promise<number> {
  const requestId = pressingText(body.request_id, 'รหัสคำขอ', true);
  const reason = pressingText(body.reason, 'เหตุผลที่ย้อนเบิก', true);
  const lines = parseReversalLines(body.lines);
  const payload = JSON.stringify(lines);
  const existing = await one(db, `SELECT id,issue_id,reason,request_lines=$2::jsonb AS same_lines
    FROM pressing_issue_reversals WHERE request_id=$1`, [requestId, payload]);
  if (existing) {
    if (existing.issue_id !== issueId || existing.reason !== reason || !existing.same_lines)
      fail('รหัสคำขอนี้มีข้อมูลย้อนเบิกอื่นแล้ว', 409);
    return existing.id;
  }
  await requireIssue(db, issueId);

  const combined = new Map<number, number>();
  for (const { issue_line_id, pieces } of lines)
    combined.set(issue_line_id, (combined.get(issue_line_id) ?? 0) + pieces);
  const remaining = await all(db, `SELECT id,pieces FROM pressing_net_issue_lines
    WHERE issue_id=$1 AND id=ANY($2::integer[])`, [issueId, [...combined.keys()]]);
  if (remaining.length !== combined.size) fail('มีรายการที่ไม่ได้อยู่ในการเบิกที่เลือก', 409);
  const returns = remaining.map(({ id, pieces: previous_pieces }) => {
    const pieces = combined.get(id)!;
    if (pieces > previous_pieces) fail('จำนวนแผ่นที่คืนมากกว่ายอดเบิกที่ยังไม่ได้ย้อน', 409);
    return { issue_line_id: id, pieces, previous_pieces };
  });

  const { id, reversed_at } = await one(db, `INSERT INTO pressing_issue_reversals(issue_id,request_id,request_lines,
    reason,reversed_by,reversed_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()) RETURNING id,reversed_at::text`,
  [issueId, requestId, payload, reason, actor.id]);
  await db.query(`INSERT INTO pressing_issue_reversal_lines(reversal_id,issue_line_id,pieces,previous_pieces)
    SELECT $1,issue_line_id,pieces,previous_pieces FROM jsonb_to_recordset($2::jsonb)
      AS line(issue_line_id integer,pieces integer,previous_pieces integer)`, [id, JSON.stringify(returns)]);
  await auditMovement(db, actor, 'ย้อนรายการเบิกงานปั๊ม', issueId, reversed_at);
  return id;
}

export async function listIssueReversals(db: Db, issueId: number) {
  await requireIssue(db, issueId);
  return all(db, `SELECT r.id,r.issue_id,r.reason,r.reversed_by,u.username AS reversed_by_username,r.reversed_at,
    jsonb_agg(jsonb_build_object('issue_line_id',l.id,'source_id',l.source_id,'allocation',l.allocation,
      'pieces',rl.pieces,'previous_pieces',rl.previous_pieces) ORDER BY l.id) AS lines
    FROM pressing_issue_reversals r JOIN users u ON u.id=r.reversed_by
    JOIN pressing_issue_reversal_lines rl ON rl.reversal_id=r.id JOIN pressing_issue_lines l ON l.id=rl.issue_line_id
    WHERE r.issue_id=$1 GROUP BY r.id,u.username ORDER BY r.id`, [issueId]);
}

export async function releaseSurplus(db: Db, body: Body, actor: Recorder): Promise<number> {
  const requestId = pressingText(body.request_id, 'รหัสคำขอ', true);
  const sourceId = integer(body.source_id, 'แหล่งสต็อก');
  const pieces = integer(body.pieces, 'จำนวนแผ่นที่ปล่อย');
  const existing = await one(db, 'SELECT id,source_id,pieces FROM pressing_releases WHERE request_id=$1', [requestId]);
  if (existing) {
    if (existing.source_id !== sourceId || existing.pieces !== pieces)
      fail('รหัสคำขอนี้มีข้อมูลปล่อยยอดอื่นแล้ว', 409);
    return existing.id;
  }

  const source = await one(db, stockBalances + ' WHERE s.id=$1', [sourceId]);
  if (!source) fail('ไม่พบแหล่งสต็อกที่เลือก', 404);
  if (pieces > source.restricted_pieces) fail('จำนวนแผ่นที่ปล่อยมากกว่ายอดที่ยังผูกกับใบสั่ง', 409);
  const { enough } = await one(db, `SELECT
    (SELECT sum(effective_pieces) FROM pressing_effective_entries WHERE order_id=o.id) - o.target_pieces -
    (SELECT coalesce(sum(r.pieces),0) FROM pressing_releases r JOIN pressing_stock_sources s ON s.id=r.source_id
      JOIN pressing_entries e ON e.id=s.entry_id WHERE e.order_id=o.id) >= $2::integer AS enough
    FROM pressing_orders o WHERE o.id=$1`, [source.order_id, pieces]);
  if (!enough) fail('จำนวนแผ่นที่ปล่อยมากกว่ายอดเกินของใบสั่งที่ยังไม่ปล่อย', 409);

  const { id, released_at } = await one(db, `INSERT INTO pressing_releases(request_id,source_id,pieces,released_by,released_at)
    VALUES($1,$2,$3,$4,clock_timestamp()) RETURNING id,released_at::text`, [requestId, sourceId, pieces, actor.id]);
  await auditMovement(db, actor, 'ปล่อยยอดปั๊มส่วนเกิน', id, released_at);
  return id;
}
