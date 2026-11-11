import { fail } from '../auth.js';
import { all, audit, one, type Db } from '../database.js';
import { integer, pressingText } from './catalog.js';

type Body = Record<string, unknown>;
type Recorder = { id: number; username: string };

function calendarDate(value: unknown, label: string): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !value.startsWith('0000')) {
    const date = new Date(value + 'T00:00:00Z');
    if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value) return value;
  }
  fail(`กรุณาระบุ${label}ให้ถูกต้อง (YYYY-MM-DD)`);
}

function restEnd(pressedOn: string, restDays: number): string {
  const date = new Date(pressedOn + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + restDays);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() > 9999) fail('วันครบกำหนดพักอยู่นอกช่วงที่รองรับ');
  return date.toISOString().slice(0, 10);
}

export function listEntries(db: Db, orderId?: number) {
  return all(db, `SELECT e.id,e.order_id,to_char(e.pressed_on,'YYYY-MM-DD') AS pressed_on,
    e.full_racks,e.loose_pieces,e.note,e.pieces,e.pieces_per_rack,e.rest_days,
    to_char(s.ready_on,'YYYY-MM-DD') AS ready_on,e.square_meters,
    e.employee_id,w.name AS employee_name,e.recorded_by,u.username AS recorded_by_username,e.recorded_at
    FROM pressing_entries e JOIN pressing_stock_sources s ON s.entry_id=e.id
    JOIN employees w ON w.id=e.employee_id JOIN users u ON u.id=e.recorded_by
    ${orderId === undefined ? '' : 'WHERE e.order_id=$1'} ORDER BY e.id`,
  orderId === undefined ? [] : [orderId]);
}

export async function recordEntry(db: Db, body: Body, actor: Recorder): Promise<number> {
  const requestId = pressingText(body.request_id, 'รหัสคำขอ', true);
  const orderId = integer(body.order_id, 'ใบสั่งผลิต');
  const pressedOn = calendarDate(body.pressed_on, 'วันที่ปั๊ม');
  const employeeId = integer(body.employee_id, 'ผู้ปั๊ม');
  const racks = integer(body.full_racks, 'จำนวนไม้เต็ม', 0);
  const loose = integer(body.loose_pieces ?? 0, 'จำนวนแผ่นเศษ', 0);
  const note = pressingText(body.note, 'หมายเหตุ', false);
  const existing = await one(db, `SELECT id,order_id,to_char(pressed_on,'YYYY-MM-DD') AS pressed_on,
    employee_id,full_racks,loose_pieces,note FROM pressing_entries WHERE request_id=$1`, [requestId]);
  if (existing) {
    if (existing.order_id !== orderId || existing.pressed_on !== pressedOn || existing.employee_id !== employeeId
      || existing.full_racks !== racks || existing.loose_pieces !== loose || existing.note !== note)
      fail('รหัสคำขอนี้มีข้อมูลยอดปั๊มอื่นแล้ว', 409);
    return existing.id;
  }

  const type = await one(db, `SELECT t.id,t.active,t.pieces_per_rack,t.rest_days,t.pieces_per_sqm,t.destination
    FROM pressing_orders o JOIN pressing_types t ON t.id=o.type_id WHERE o.id=$1`, [orderId]);
  if (!type) fail('ไม่พบใบสั่งผลิตที่เลือก');
  if (!type.active) fail('ประเภทกระเบื้องที่เลือกหยุดใช้แล้ว', 409);
  if (!(await one(db, 'SELECT 1 FROM employees WHERE id=$1 AND active=1 AND archived=0', [employeeId])))
    fail('กรุณาเลือกผู้ปั๊มที่ยังทำงานอยู่');
  const pieces = integer(racks * type.pieces_per_rack + loose, 'ยอดปั๊ม');
  const readyOn = restEnd(pressedOn, type.rest_days);
  const squareMeters = type.pieces_per_sqm === null ? null : pieces / type.pieces_per_sqm;
  if (squareMeters !== null && !Number.isFinite(squareMeters)) fail('จำนวน ตร.ม. อยู่นอกช่วงที่รองรับ');

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

export function listStock(db: Db) {
  return all(db, `SELECT s.id,s.type_id,s.entry_id,e.order_id,to_char(e.pressed_on,'YYYY-MM-DD') AS pressed_on,
    to_char(s.as_of,'YYYY-MM-DD') AS as_of,to_char(s.ready_on,'YYYY-MM-DD') AS ready_on,
    coalesce(s.ready_on <= (now() AT TIME ZONE 'Asia/Bangkok')::date,s.ready_confirmed) AS ready,
    s.destination,coalesce(e.pieces,s.opening_pieces) AS remaining_pieces,
    CASE WHEN o.purpose='customer' THEN 0 ELSE coalesce(e.pieces,s.opening_pieces) END AS general_pieces,
    CASE WHEN o.purpose='customer' THEN e.pieces ELSE 0 END AS restricted_pieces
    FROM pressing_stock_sources s LEFT JOIN pressing_entries e ON e.id=s.entry_id
    LEFT JOIN pressing_orders o ON o.id=e.order_id ORDER BY s.id`);
}
