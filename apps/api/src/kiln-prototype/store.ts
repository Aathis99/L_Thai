import type pg from 'pg';
import { fail, text } from '../auth.js';
import { all, one, transaction, type Db } from '../database.js';
import { listSources } from '../finishing/firing.js';
import { demoState, emptyState, transition, summarize, sources, type Command, type Item, type Model } from './model.js';

export async function assertQa(db: Db) {
  if (process.env.KILN_QA_MODE !== 'true') fail('แบบจำลองนี้เปิดใช้เฉพาะ QA', 404);
  const target = await one(db, 'SELECT current_database() AS name');
  if (!/^lthai_.*_qa$/.test(target.name)) fail('ปฏิเสธการใช้แบบจำลองกับฐานที่ไม่ใช่ QA ที่กำหนด', 403);
}
export async function installPrototype(pool: pg.Pool) {
  await assertQa(pool);
  await transaction(pool, async db => {
    await db.query(`CREATE TABLE IF NOT EXISTS kiln_prototype_state (
      id integer PRIMARY KEY CHECK(id=1),revision integer NOT NULL,state jsonb NOT NULL);
      CREATE TABLE IF NOT EXISTS kiln_prototype_events (
      id serial PRIMARY KEY,request_id text NOT NULL UNIQUE,payload jsonb NOT NULL,revision integer NOT NULL,
      actor text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now(),before_state jsonb NOT NULL,after_state jsonb NOT NULL);
      INSERT INTO kiln_prototype_state VALUES(1,0,'${JSON.stringify(emptyState())}'::jsonb) ON CONFLICT DO NOTHING;`);
  });
}
export async function copiedCatalog(db: Db): Promise<Item[]> {
  const orders = await all(db, `SELECT o.*,t.width,t.length,t.name AS tile_name,t.clay AS tile_clay,t.pieces_per_sqm AS tile_rate,
    cr.minimum AS clay_min,cr.maximum AS clay_max,gr.minimum AS color_min,gr.maximum AS color_max
    FROM pressing_orders o JOIN pressing_types t ON t.id=o.type_id
    LEFT JOIN firing_clay_ranges cr ON cr.clay=coalesce(o.production_clay,t.clay)
    LEFT JOIN firing_color_ranges gr ON gr.color_id=o.color_id ORDER BY o.id`);
  const ready = await listSources(db);
  return orders.flatMap(order => {
    const entries = ready.filter(source => source.order_id === order.id);
    return (entries.length ? entries : [null]).map(source => ({
      id: source ? `copied:${source.issue_id}:${source.batch_id ?? 'breeze'}` : `copied-order:${order.id}`,
      orderKey: `copied-order:${order.id}`, reference: order.customer_reference || `สั่งสต็อก #${order.id}`,
      name: `${order.width}×${order.length} ${order.tile_name ?? ''}`.trim(),
      clay: source?.clay ?? order.production_clay ?? order.tile_clay,
      color: order.color_name ?? '', purpose: order.purpose,
      target: Number(order.customer_pieces ?? order.target_pieces), rate: Number(source?.pieces_per_sqm ?? order.pieces_per_sqm ?? order.tile_rate ?? 0),
      ready: Math.max(0, Number(source?.waiting_pieces ?? 0)), readyOn: source?.ready_on ?? '2026-11-19',
      clayRange: order.clay_min ? [order.clay_min, order.clay_max] : undefined,
      colorRange: order.color_min ? [order.color_min, order.color_max] : undefined,
      shapeRange: undefined, accepted: [], synthetic: false,
    } satisfies Item));
  });
}
export async function readPrototype(db: Db) {
  await assertQa(db);
  const row = await one(db, 'SELECT revision,state FROM kiln_prototype_state WHERE id=1');
  const state = row.state as Model;
  const events = await all(db, `SELECT id,revision,actor,recorded_at,payload->'command' AS command,before_state,after_state
    FROM kiln_prototype_events ORDER BY id DESC LIMIT 100`);
  return { revision: row.revision as number, state, summary: summarize(state), sources: sources(state), copiedItems: await copiedCatalog(db),
    history: events.map(({ before_state, after_state, ...event }) => ({ ...event, changes: differences(before_state, after_state) })) };
}

export function differences(before: any, after: any, path = ''): { field: string; before: string; after: string }[] {
  if (JSON.stringify(before) === JSON.stringify(after) || path === 'nextId') return [];
  const label: Record<string, string> = { items: 'งาน', plans: 'แผน', reservations: 'เตรียม', rounds: 'รอบ', qcs: 'QC', counts: 'ผลคัด', pieces: 'แผ่น', temperature: 'อุณหภูมิ', ready: 'พร้อม', allocations: 'จัดสรร/รับสต็อก', loads: 'เข้าเผา', logs: 'บันทึกไฟ', repairReady: 'ซ่อมพร้อม', stockGrades: 'เกรดรับสต็อก', accepted: 'เกรดออเดอร์รับ', railsReady: 'เบอร์พร้อม', status: 'สถานะ', waste: 'เสีย', underfired: 'ไม่สุก', touchup: 'แต้ม', defects: 'อาการเสีย', cancelled: 'ยกเลิก' };
  const show = (v: any) => v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v).slice(0, 600);
  if (Array.isArray(before) && Array.isArray(after) && [...before, ...after].every(v => v && typeof v === 'object' && !Array.isArray(v))) {
    const key = (v: any) => String(v.id ?? v.name ?? (v.qcId !== undefined ? `${v.qcId}:${v.kind}` : `${v.kilnId}/${v.rail}`));
    const keys = [...new Set([...before.map(key), ...after.map(key)])];
    return keys.flatMap(k => differences(before.find(v => key(v) === k), after.find(v => key(v) === k), `${path} #${k}`));
  }
  if (before && after && typeof before === 'object' && typeof after === 'object' && !Array.isArray(before) && !Array.isArray(after)) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap(k => differences(before[k], after[k], `${path ? path + ' · ' : ''}${label[k] ?? k}`));
  }
  return [{ field: path, before: show(before), after: show(after) }];
}
export async function savePrototype(db: Db, body: any, actor: string) {
  await assertQa(db);
  const requestId = text(body.request_id, 'รหัสคำขอ', true, 100);
  const c = body.command as Command;
  if (!c || typeof c !== 'object' || Array.isArray(c)) fail('ข้อมูลคำสั่งไม่ถูกต้อง');
  if (!Number.isInteger(body.revision) || body.revision < 0) fail('ฉบับข้อมูลไม่ถูกต้อง');
  const payload = { command: c, revision: body.revision };
  const existing = await one(db, `SELECT payload=$2::jsonb AS matches FROM kiln_prototype_events WHERE request_id=$1`, [requestId, JSON.stringify(payload)]);
  if (existing) {
    if (!existing.matches) fail('รหัสคำขอถูกใช้กับข้อมูลอื่นแล้ว', 409);
    return { ...await readPrototype(db), replayed: true };
  }
  const row = await one(db, 'SELECT revision,state FROM kiln_prototype_state WHERE id=1 FOR UPDATE');
  if (row.revision !== body.revision) fail('มีผู้อื่นแก้ข้อมูลแล้ว กรุณาโหลดข้อมูลล่าสุดและตรวจรายการก่อนบันทึก', 409);
  let state: Model;
  if (c.op === 'demo') {
    if (c.confirm !== 'RESET-QA') fail('กรุณายืนยันเริ่มตัวอย่างใหม่');
    state = demoState();
  } else if (c.op === 'import') {
    const available = await copiedCatalog(db);
    const selected = available.find(i => i.id === c.sourceId);
    if (!selected) fail('ไม่พบงานในสำเนาฐาน QA');
    state = structuredClone(row.state);
    if (state.items.some(i => i.id === selected.id)) fail('งานนี้มีในแบบจำลองแล้ว');
    state.items.push(selected);
  } else state = transition(row.state, c);
  await db.query('UPDATE kiln_prototype_state SET state=$1,revision=revision+1 WHERE id=1', [JSON.stringify(state)]);
  await db.query(`INSERT INTO kiln_prototype_events(request_id,payload,revision,actor,before_state,after_state)
    VALUES($1,$2,$3,$4,$5,$6)`, [requestId, JSON.stringify(payload), row.revision + 1, actor, JSON.stringify(row.state), JSON.stringify(state)]);
  return { ...await readPrototype(db), replayed: false };
}
