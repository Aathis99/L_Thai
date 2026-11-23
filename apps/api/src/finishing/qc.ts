import { fail } from '../auth.js';
import { all, audit, one, type Db } from '../database.js';
import { calendarDate, integer, pressingText } from '../pressing/catalog.js';
import { requireRound } from './firing.js';
import { finishingRequest, type Body, type Recorder } from './requests.js';

export function listQc(db: Db) {
  return all(db, `SELECT q.*,to_char(q.sorted_on,'YYYY-MM-DD') AS sorted_on,
    t.type_id,t.clay,t.color_name,t.orders,t.loads,t.product_id,t.product_code,t.product_name,t.production_clay_color,
    coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM firing_qc_allocations a WHERE a.qc_id=q.id),'[]') AS allocations,
    CASE WHEN q.orders_filled AND q.voided_at IS NULL THEN q.unallocated_pieces ELSE 0 END AS stock_available
    FROM firing_qc_balances q CROSS JOIN LATERAL (
      SELECT min(l.type_id) AS type_id,min(l.clay) AS clay,min(l.color_name) AS color_name,
        array_agg(DISTINCT l.order_id ORDER BY l.order_id) AS orders,
        CASE WHEN count(DISTINCT o.product_id)=1 AND count(o.product_id)=count(*) THEN min(o.product_id) END product_id,
        CASE WHEN count(DISTINCT o.product_id)=1 AND count(o.product_id)=count(*) THEN min(o.product_snapshot->>'product_code') END product_code,
        CASE WHEN count(DISTINCT o.product_id)=1 AND count(o.product_id)=count(*) THEN min(o.product_snapshot->>'name') END product_name,
        CASE WHEN count(DISTINCT o.product_id)=1 AND count(o.product_id)=count(*) THEN min(o.production_clay_color) END production_clay_color,
        jsonb_agg(jsonb_build_object('id',l.id,'order_id',l.order_id,'pieces',x.pieces,'product_id',o.product_id,'product_code',o.product_snapshot->>'product_code','product_name',o.product_snapshot->>'name','production_clay_color',o.production_clay_color) ORDER BY l.id) AS loads
      FROM firing_qc_loads x JOIN firing_loads l ON l.id=x.load_id LEFT JOIN pressing_orders o ON o.id=l.order_id WHERE x.qc_id=q.id
    ) t ORDER BY q.id DESC`);
}

export async function recordQc(db: Db, body: Body, actor: Recorder) {
  const roundId = integer(body.round_id, 'รอบเผา');
  const date = calendarDate(body.sorted_on, 'วันที่คัด');
  const good = integer(body.good_pieces, 'แผ่นดี', 0);
  const waste = integer(body.waste_pieces, 'แผ่นเสีย', 0);
  if (!Array.isArray(body.lines) || !body.lines.length) fail('กรุณาเลือกรายการเข้าเตาที่คัด');
  const lines = body.lines.map((line: unknown) => {
    if (!line || typeof line !== 'object') fail('ข้อมูลรายการคัดไม่ถูกต้อง');
    const { load_id, pieces } = line as Body;
    return { load_id: integer(load_id, 'รายการเข้าเตา'), pieces: integer(pieces, 'จำนวนที่คัด') };
  }).sort((a, b) => a.load_id - b.load_id);
  if (new Set(lines.map(l => l.load_id)).size !== lines.length) fail('รายการเข้าเตาซ้ำ');
  if (lines.reduce((sum, line) => sum + line.pieces, 0) !== good + waste) fail('ยอดดีและเสียรวมต้องเท่ากับยอดคัด');
  return finishingRequest(db, 'qc', body, { roundId, date, good, waste, lines }, async () => {
    const round = await requireRound(db, roundId);
    if (!round.finished_on) fail('กรุณาบันทึกเผาเสร็จก่อนคัด', 409);
    if (date < round.finished_on) fail('วันที่คัดต้องตรงกับหรือหลังวันที่เผาเสร็จ');
    const loads = await all(db, `SELECT l.id,l.type_id,l.clay,l.color_id,l.order_id,l.unsorted_pieces,o.product_id FROM firing_load_balances l
      JOIN pressing_orders o ON o.id=l.order_id WHERE l.round_id=$1 AND l.id=ANY($2::integer[]) ORDER BY l.id`, [roundId, lines.map(l => l.load_id)]);
    if (loads.length !== lines.length) fail('รายการเข้าเตาไม่ตรงกับรอบที่เลือก', 409);
    const first = loads[0];
    if (loads.some(l => l.type_id !== first.type_id || l.clay !== first.clay || l.color_id !== first.color_id || l.product_id!==first.product_id))
      fail('กองคัดรวมต้องเป็นประเภทกระเบื้องและสีเดียวกัน', 409);
    if (lines.some((line, index) => line.pieces > loads[index].unsorted_pieces)) fail('จำนวนที่คัดเกินยอดรอคัด QC', 409);
    const { id } = await one(db, `INSERT INTO firing_qc(round_id,sorted_on,good_pieces,waste_pieces,recorded_by)
      VALUES($1,$2,$3,$4,$5) RETURNING id`, [roundId, date, good, waste, actor.id]);
    await db.query(`INSERT INTO firing_qc_loads(qc_id,load_id,pieces)
      SELECT $1,load_id,pieces FROM jsonb_to_recordset($2::jsonb) AS l(load_id integer,pieces integer)`,
    [id, JSON.stringify(lines)]);
    if (loads.length === 1) await reserveDirect(db, id, first.order_id, good, actor);
    await audit(db, actor.username, loads.length > 1 ? 'บันทึก QC กองคัดรวม' : 'บันทึก QC รายการเข้าเตา', String(id));
    return id;
  });
}

async function reserveDirect(db: Db, qc: number, order: number, available: number, actor: Recorder) {
  const balance = await one(db, 'SELECT missing_pieces FROM finishing_order_balances WHERE id=$1', [order]);
  const pieces = Math.min(available, balance.missing_pieces);
  if (pieces > 0) {
    await db.query('INSERT INTO firing_qc_allocations(qc_id,order_id,pieces,recorded_by) VALUES($1,$2,$3,$4)',
      [qc, order, pieces, actor.id]);
  }
}

async function requireQc(db: Db, id: number) {
  const qc = await one(db, 'SELECT * FROM firing_qc_balances WHERE id=$1', [id]);
  if (!qc) fail('ไม่พบผลคัด QC', 404);
  if (qc.voided_at) fail('ผลคัดนี้ถูกยกเลิกแล้ว', 409);
  return qc;
}

export function allocateGood(db: Db, body: Body, actor: Recorder) {
  const qcId = integer(body.qc_id, 'ผลคัด QC');
  const orderId = integer(body.order_id, 'ใบสั่งผลิต');
  const pieces = integer(body.pieces, 'แผ่นดีที่จัดสรร');
  return finishingRequest(db, 'allocation', body, { qcId, orderId, pieces }, async () => {
    const qc = await requireQc(db, qcId);
    const order = await one(db, `SELECT b.missing_pieces FROM finishing_order_balances b WHERE b.id=$2 AND EXISTS (
      SELECT 1 FROM firing_qc_loads x JOIN firing_loads l ON l.id=x.load_id WHERE x.qc_id=$1 AND l.order_id=b.id
    )`, [qcId, orderId]);
    if (!order) fail('ใบสั่งผลิตไม่ได้อยู่ในผลคัดนี้', 409);
    if (pieces > qc.unallocated_pieces || pieces > order.missing_pieces)
      fail('จำนวนแผ่นเกินยอดดีที่ยังจัดสรรได้หรือยอดขาดของใบสั่ง', 409);
    const { id } = await one(db, `INSERT INTO firing_qc_allocations(qc_id,order_id,pieces,recorded_by)
      VALUES($1,$2,$3,$4) RETURNING id`, [qcId, orderId, pieces, actor.id]);
    await audit(db, actor.username, 'จัดสรรแผ่นดีจาก QC', String(id));
    return id;
  });
}

export function receiveStock(db: Db, body: Body, actor: Recorder) {
  const qcId = integer(body.qc_id, 'ผลคัด QC');
  const pieces = integer(body.pieces, 'แผ่นที่รับเข้าสต็อก');
  return finishingRequest(db, 'stock', body, { qcId, pieces }, async () => {
    const qc = await requireQc(db, qcId);
    if (!qc.orders_filled) fail('ต้องกันแผ่นดีให้ครบทุกใบสั่งที่ร่วมผลคัดก่อนรับเข้าสต็อก', 409);
    if (pieces > qc.unallocated_pieces) fail('จำนวนแผ่นรับเข้าเกินยอดดีส่วนเกิน', 409);
    const { id } = await one(db, `INSERT INTO finished_stock_receipts(qc_id,type_id,clay,color_id,color_name,pieces,recorded_by)
      SELECT $1,l.type_id,l.clay,l.color_id,l.color_name,$2,$3
      FROM firing_qc_loads x JOIN firing_loads l ON l.id=x.load_id WHERE x.qc_id=$1 ORDER BY l.id LIMIT 1 RETURNING id`,
    [qcId, pieces, actor.id]);
    await audit(db, actor.username, 'ยืนยันรับเข้าสต็อกสินค้าสำเร็จ', String(id));
    return id;
  });
}

export function correctQc(db: Db, body: Body, actor: Recorder) {
  const qcId = integer(body.qc_id, 'ผลคัด QC');
  const good = integer(body.good_pieces, 'แผ่นดี', 0);
  const waste = integer(body.waste_pieces, 'แผ่นเสีย', 0);
  const reason = pressingText(body.reason, 'เหตุผลที่แก้ผลคัด', true);
  return finishingRequest(db, 'qc-correction', body, { qcId, good, waste, reason }, async () => {
    const qc = await requireQc(db, qcId);
    if (good + waste !== qc.good_pieces + qc.waste_pieces) fail('ยอดดีและเสียรวมต้องเท่ากับยอดเดิมที่คัด');
    if (good < qc.allocated_pieces + qc.stocked_pieces)
      fail('ยอดดีใหม่ต่ำกว่ายอดที่กันหรือรับเข้าสต็อกแล้ว', 409);
    await db.query('UPDATE firing_qc SET good_pieces=$2,waste_pieces=$3 WHERE id=$1', [qcId, good, waste]);
    const direct = await one(db, `SELECT min(l.order_id) AS order_id,count(*)::integer AS count
      FROM firing_qc_loads x JOIN firing_loads l ON l.id=x.load_id WHERE x.qc_id=$1`, [qcId]);
    if (direct.count === 1) await reserveDirect(db, qcId, direct.order_id, good - qc.allocated_pieces - qc.stocked_pieces, actor);
    await audit(db, actor.username, 'แก้ผลคัด QC',
      qcId + ' · ดี/เสีย ' + qc.good_pieces + '/' + qc.waste_pieces + ' → ' + good + '/' + waste + ' · ' + reason);
    return qcId;
  });
}

export function listReceipts(db: Db) {
  return all(db, `SELECT r.*,u.username AS recorded_by_username,NULL::text AS grade,false AS workflow,
      o.product_id,o.product_snapshot->>'name' product_name,o.product_snapshot->>'product_code' product_code,o.production_clay_color
    FROM finished_stock_receipts r JOIN users u ON u.id=r.recorded_by
    LEFT JOIN LATERAL (SELECT l.order_id FROM firing_qc_loads x JOIN firing_loads l ON l.id=x.load_id WHERE x.qc_id=r.qc_id ORDER BY l.id LIMIT 1) origin ON true
    LEFT JOIN pressing_orders o ON o.id=origin.order_id
    UNION ALL SELECT -a.id,a.qc_id,a.type_id,a.color_id,a.color_name,a.pieces,a.recorded_by,a.recorded_at,NULL::timestamptz,a.clay,u.username,a.grade,true,
      o.product_id,o.product_snapshot->>'name',o.product_snapshot->>'product_code',o.production_clay_color
    FROM kiln_workflow_allocations a JOIN users u ON u.id=a.recorded_by JOIN pressing_orders o ON o.id=a.order_id WHERE a.destination='stock'
    ORDER BY recorded_at DESC,id DESC`);
}

export function voidQc(db: Db, body: Body, actor: Recorder) {
  const id = integer(body.qc_id, 'ผลคัด QC');
  const reason = pressingText(body.reason, 'เหตุผลที่ยกเลิกผลคัด', true);
  return finishingRequest(db, 'qc-void', body, { id, reason }, async () => {
    const qc = await requireQc(db, id);
    if (qc.allocated_pieces || qc.stocked_pieces) fail('กรุณาย้อนยอดจัดสรรและรับเข้าสต็อกก่อนยกเลิกผลคัด', 409);
    await db.query('UPDATE firing_qc SET voided_at=now() WHERE id=$1', [id]);
    await audit(db, actor.username, 'ยกเลิกผลคัด QC', id + ' · ' + reason);
    return id;
  });
}

export function voidAllocation(db: Db, body: Body, actor: Recorder) {
  const id = integer(body.allocation_id, 'รายการจัดสรร');
  const reason = pressingText(body.reason, 'เหตุผลที่ย้อนยอดจัดสรร', true);
  return finishingRequest(db, 'allocation-void', body, { id, reason }, async () => {
    const allocation = await one(db, 'SELECT * FROM firing_qc_allocations WHERE id=$1 AND voided_at IS NULL', [id]);
    if (!allocation) fail('ไม่พบรายการจัดสรรที่ยังย้อนยอดได้', 404);
    if(await one(db,"SELECT 1 FROM kiln_workflow_allocations WHERE order_id=$1 AND destination='stock' LIMIT 1",[allocation.order_id]))
      fail('กรุณาปรับรายการรับสต็อกในงานเตาก่อนย้อนยอดจัดสรรใบนี้',409);
    const receipt = await one(db, `SELECT r.id FROM finished_stock_receipts r WHERE r.voided_at IS NULL AND EXISTS (
      SELECT 1 FROM firing_qc_loads x JOIN firing_loads l ON l.id=x.load_id WHERE x.qc_id=r.qc_id AND l.order_id=$1
    ) ORDER BY r.id LIMIT 1`, [allocation.order_id]);
    if (receipt) fail('กรุณาย้อนรายการรับเข้าสต็อก #' + receipt.id + ' ก่อนย้อนยอดจัดสรรใบนี้', 409);
    await db.query('UPDATE firing_qc_allocations SET voided_at=now() WHERE id=$1', [id]);
    await audit(db, actor.username, 'ย้อนยอดจัดสรรแผ่นดี', id + ' · ' + reason);
    return id;
  });
}

export function voidReceipt(db: Db, body: Body, actor: Recorder) {
  const id = integer(body.receipt_id, 'รายการรับเข้าสต็อก');
  const reason = pressingText(body.reason, 'เหตุผลที่ย้อนรับเข้าสต็อก', true);
  return finishingRequest(db, 'stock-void', body, { id, reason }, async () => {
    const receipt = await one(db, 'UPDATE finished_stock_receipts SET voided_at=now() WHERE id=$1 AND voided_at IS NULL RETURNING id', [id]);
    if (!receipt) fail('ไม่พบรายการรับเข้าที่ยังย้อนยอดได้', 404);
    await audit(db, actor.username, 'ย้อนรับเข้าสต็อกสินค้าสำเร็จ', id + ' · ' + reason);
    return id;
  });
}
