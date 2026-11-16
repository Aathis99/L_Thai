import { fail, text } from '../auth.js';
import { all, one, type Db } from '../database.js';

type Body = Record<string, unknown>;

function positiveNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
    fail(`กรุณาระบุ${label}เป็นจำนวนมากกว่า 0`);
  return value;
}

export function integer(value: unknown, label: string, minimum = 1): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > 2147483647)
    fail(`กรุณาระบุ${label}เป็นจำนวนเต็มที่ถูกต้อง`);
  return value;
}

export function calendarDate(value: unknown, label: string): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !value.startsWith('0000')) {
    const date = new Date(value + 'T00:00:00Z');
    if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value) return value;
  }
  fail(`กรุณาระบุ${label}ให้ถูกต้อง (YYYY-MM-DD)`);
}

export function pressingText(value: unknown, label: string, required: true): string;
export function pressingText(value: unknown, label: string, required: false): string | null;
export function pressingText(value: unknown, label: string, required: boolean): string | null {
  const normalized = text(value ?? undefined, label, required);
  if (/[\u0000\uD800-\uDFFF]/u.test(normalized)) fail(`กรุณาระบุ${label}ให้ถูกต้อง`);
  return normalized || null;
}

export function listTypes(db: Db) {
  return all(db, `SELECT id,width,length,clay,name,clay_color,pieces_per_rack,
    rest_days,destination,pieces_per_sqm,active FROM pressing_types ORDER BY id`);
}

export async function saveType(db: Db, body: Body, id?: number): Promise<number> {
  if (body.clay !== 'แดง' && body.clay !== 'ขาว' && body.clay !== 'จ้อ' && body.clay !== 'สี')
    fail('กรุณาเลือกประเภทดิน');
  if (body.destination !== 'color' && body.destination !== 'kiln')
    fail('กรุณาเลือกปลายทางเบิก');
  const values = [
    positiveNumber(body.width, 'ความกว้าง'),
    positiveNumber(body.length, 'ความยาว'),
    body.clay,
    pressingText(body.name, 'ชื่อเรียก', false),
    pressingText(body.clay_color, 'รายละเอียดดินสี', false),
    integer(body.pieces_per_rack, 'จำนวนแผ่นต่อไม้'),
    integer(body.rest_days, 'จำนวนวันพัก', 0),
    body.destination,
    body.pieces_per_sqm == null ? null : positiveNumber(body.pieces_per_sqm, 'จำนวนแผ่นต่อ ตร.ม.'),
  ];
  const row = id === undefined
    ? await one(db, `INSERT INTO pressing_types(width,length,clay,name,clay_color,pieces_per_rack,
        rest_days,destination,pieces_per_sqm) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, values)
    : await one(db, `UPDATE pressing_types SET width=$1,length=$2,clay=$3,name=$4,clay_color=$5,
        pieces_per_rack=$6,rest_days=$7,destination=$8,pieces_per_sqm=$9 WHERE id=$10 RETURNING id`, [...values, id]);
  if (!row) fail('ไม่พบประเภทกระเบื้อง', 404);
  return row.id;
}

export async function removeType(db: Db, id: number): Promise<boolean> {
  const { referenced } = await one(db, `SELECT EXISTS (SELECT 1 FROM pressing_orders WHERE type_id=$1)
    OR EXISTS (SELECT 1 FROM pressing_stock_sources WHERE type_id=$1)
    OR EXISTS (SELECT 1 FROM pressing_sort_results WHERE type_id=$1) AS referenced`, [id]);
  const query = referenced ? 'UPDATE pressing_types SET active=false WHERE id=$1 RETURNING id'
    : 'DELETE FROM pressing_types WHERE id=$1 RETURNING id';
  if (!(await one(db, query, [id]))) fail('ไม่พบประเภทกระเบื้อง', 404);
  return referenced;
}

export function listOrders(db: Db) {
  return all(db, `WITH totals AS (
    SELECT order_id, sum(effective_pieces)::double precision AS pieces FROM pressing_effective_entries GROUP BY order_id
  )
  SELECT o.id,o.type_id,o.target_pieces,o.purpose,o.customer_reference,
    o.customer_pieces,o.allowance_percent,o.allowance_pieces,o.color_id,o.color_name,o.pieces_per_sqm,o.production_clay,
    o.target_pieces / o.pieces_per_sqm AS target_square_meters,
    coalesce(t.pieces,0) AS pressed_pieces,
    greatest(o.target_pieces-coalesce(t.pieces,0),0) AS short_pieces,
     greatest(coalesce(t.pieces,0)-o.target_pieces,0) AS over_pieces,
     t.order_id IS NOT NULL AS has_entries,
     EXISTS (SELECT 1 FROM pressing_issues i WHERE i.order_id=o.id) AS has_issues
  FROM pressing_orders o LEFT JOIN totals t ON t.order_id=o.id ORDER BY o.id`);
}

export async function createOrder(db: Db, body: Body): Promise<number> {
  const typeId = integer(body.type_id, 'ประเภทกระเบื้อง');
  const purpose = body.purpose;
  if (purpose !== 'customer' && purpose !== 'stock') fail('กรุณาเลือกที่มาของใบสั่งผลิต');
  const reference = purpose === 'customer'
    ? pressingText(body.customer_reference, 'เลขอ้างอิงออเดอร์', true)
    : pressingText(body.customer_reference, 'เลขอ้างอิงออเดอร์', false);
  const type = await one(db, 'SELECT active,destination,clay,pieces_per_sqm FROM pressing_types WHERE id=$1', [typeId]);
  if (!type) fail('ไม่พบประเภทกระเบื้องที่เลือก');
  if (!type.active) fail('ประเภทกระเบื้องที่เลือกหยุดใช้แล้ว', 409);
  const production = body.customer_pieces !== undefined || body.allowance_percent !== undefined || body.color_id !== undefined;
  if (!production) {
    const target = integer(body.target_pieces, 'ยอดสั่งปั๊ม');
    return (await one(db, `INSERT INTO pressing_orders(type_id,target_pieces,purpose,customer_reference)
      VALUES($1,$2,$3,$4) RETURNING id`, [typeId, target, purpose, reference])).id;
  }
  if (purpose !== 'customer') fail('กรุณาระบุออเดอร์ลูกค้า');
  const details = await orderProductionDetails(db, type.destination, body);
  return (await one(db, `INSERT INTO pressing_orders(type_id,target_pieces,purpose,customer_reference,
    customer_pieces,allowance_percent,allowance_pieces,color_id,color_name,pieces_per_sqm,production_destination,production_clay)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
  [typeId, details.target, purpose, reference, details.customer, details.percent, details.allowance,
    details.color?.id ?? null, details.color?.name ?? null, type.pieces_per_sqm,type.destination,type.clay])).id;
}

async function orderProductionDetails(db: Db, destination: string, body: Body) {
  const customer = integer(body.customer_pieces, 'ยอดลูกค้าสั่ง');
  const percent = integer(body.allowance_percent, 'เปอร์เซ็นต์เผื่อ', 5);
  if (percent > 20) fail('เปอร์เซ็นต์เผื่อต้องอยู่ระหว่าง 5–20');
  const allowance = Math.ceil(customer * percent / 100);
  const target = integer(customer + allowance, 'ยอดสั่งปั๊ม');
  const color = destination === 'color'
    ? await one(db, 'SELECT id,name FROM color_chart_entries WHERE id=$1', [integer(body.color_id, 'สีเคลือบ')])
    : null;
  if (destination === 'color' && !color) fail('ไม่พบสีเคลือบที่เลือก');
  return { customer, percent, allowance, target, color };
}

export async function prepareLegacyOrder(db: Db, id: number, body: Body) {
  const order = await one(db, `SELECT o.*,t.destination,t.clay,t.pieces_per_sqm AS type_rate
    FROM pressing_orders o JOIN pressing_types t ON t.id=o.type_id WHERE o.id=$1`, [id]);
  if (!order) fail('ไม่พบใบสั่งผลิต', 404);
  if (order.purpose !== 'customer' || order.customer_pieces !== null) fail('ใบนี้ไม่มีข้อมูลออเดอร์ค้างให้เติม', 409);
  const details = await orderProductionDetails(db, order.destination, body);
  const { released } = await one(db, `SELECT EXISTS (
    SELECT 1 FROM pressing_entries e JOIN pressing_stock_sources s ON s.entry_id=e.id
    JOIN pressing_releases r ON r.source_id=s.id WHERE e.order_id=$1) AS released`, [id]);
  if (released && details.target > order.target_pieces) fail('มีการปล่อยส่วนเกินแล้ว กรุณาตรวจยอดที่จัดสรรก่อนเพิ่มเป้าปั๊ม', 409);
  await db.query(`UPDATE pressing_orders SET target_pieces=$2,customer_pieces=$3,allowance_percent=$4,
    allowance_pieces=$5,color_id=$6,color_name=$7,pieces_per_sqm=$8,production_destination=$9,production_clay=$10 WHERE id=$1`,
  [id, details.target, details.customer, details.percent, details.allowance, details.color?.id ?? null,
    details.color?.name ?? null, order.type_rate, order.destination, order.clay]);
  return id;
}

export async function updateOrderTarget(db: Db, id: number, body: Body) {
  const target = integer(body.target_pieces, 'ยอดสั่งปั๊ม');
  const order = await one(db, 'SELECT type_id,purpose,customer_reference,target_pieces,customer_pieces FROM pressing_orders WHERE id=$1', [id]);
  if (!order) fail('ไม่พบใบสั่งผลิต', 404);
  if (order.customer_pieces !== null) fail('ยอดสั่งปั๊มคำนวณจากยอดลูกค้าสั่งและเปอร์เซ็นต์เผื่อ', 409);
  for (const field of ['type_id', 'purpose', 'customer_reference']) {
    if (body[field] !== undefined && body[field] !== order[field])
      fail('แก้ไขได้เฉพาะยอดสั่งปั๊ม', 409);
  }
  await db.query('UPDATE pressing_orders SET target_pieces=$1 WHERE id=$2', [target, id]);
  return { previous: order.target_pieces as number, target };
}

export async function removeOrder(db: Db, id: number): Promise<string> {
  const order = await one(db, `SELECT o.type_id,o.target_pieces,o.customer_reference,
    t.width,t.length,t.clay,t.name
    FROM pressing_orders o JOIN pressing_types t ON t.id=o.type_id
    WHERE o.id=$1 FOR UPDATE OF o`, [id]);
  if (!order) fail('ไม่พบใบสั่งผลิต', 404);
  const { has_entries, has_issues } = await one(db, `SELECT
    EXISTS (SELECT 1 FROM pressing_entries WHERE order_id=$1) AS has_entries,
    EXISTS (SELECT 1 FROM pressing_issues WHERE order_id=$1) AS has_issues`, [id]);
  if (has_entries && has_issues) fail('ลบไม่ได้ เพราะมีรายการปั๊มและรายการเบิกอ้างถึงใบนี้แล้ว', 409);
  if (has_entries) fail('ลบไม่ได้ เพราะมีรายการปั๊มอ้างถึงใบนี้แล้ว', 409);
  if (has_issues) fail('ลบไม่ได้ เพราะมีรายการเบิกอ้างถึงใบนี้แล้ว', 409);
  await db.query('DELETE FROM pressing_orders WHERE id=$1', [id]);
  const tile = `${order.width} × ${order.length} ดิน${order.clay}${order.name ? ` ${order.name}` : ''}`;
  return [`ใบสั่งผลิต #${id}`, `ประเภท #${order.type_id} ${tile}`, `${order.target_pieces} แผ่น`,
    ...(order.customer_reference ? [`ออเดอร์ ${order.customer_reference}`] : [])].join(' · ');
}

export function listWorkers(db: Db) {
  return all(db, 'SELECT id,code,name FROM employees WHERE active=1 AND archived=0 ORDER BY code,id');
}
