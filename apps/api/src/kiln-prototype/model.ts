// QA model only. Never used by the production inventory ledger.
import { fail } from '../auth.js';
import { calendarDate, integer } from '../pressing/catalog.js';

export const grades = ['A+', 'A-', 'B'] as const;
export type Grade = typeof grades[number];
export const outcomes = [...grades, 'waste', 'underfired', 'touchup'] as const;
export type Counts = Record<typeof outcomes[number], number>;
export type Range = [number, number];
export interface Item {
  id: string; orderKey: string; reference: string; name: string; clay: string; color: string;
  purpose: 'customer' | 'stock'; target: number; rate: number; ready: number; readyOn: string;
  clayRange?: Range; colorRange?: Range; shapeRange?: Range; accepted: Grade[]; synthetic: boolean;
  productId?:number|null;productName?:string|null;productCode?:string|null;requiresMesh?:boolean;clayColor?:string|null;
}
export interface Plan { id: number; sourceId: string; kilnId: number; rail: number; date: string; pieces: number; unit: string; input: number; temperature: number; cancelled?: boolean }
export interface Reservation { id: number; planId: number; sourceId: string; kilnId: number; rail: number; pieces: number; status: 'reserved' | 'loaded' | 'cancelled' }
export interface Load { id: number; reservationId: number; sourceId: string; pieces: number; criteria: Pick<Item, 'clayRange' | 'colorRange' | 'shapeRange'> }
export interface Round {
  id: number; kilnId: number; rail: number; temperature: number; startedAt: string;
  stoppedAt?: string; withdrawnAt?: string; unloadedAt?: string;
  logs: { id: number; at: string; temperature: number; cone: string; note: string }[]; loads: Load[];
}
export interface Qc { id: number; loadId: number; at: string; counts: Counts; defects: { name: string; pieces: number }[]; note: string }
export interface Allocation { id: number; qcId: number; grade: Grade; pieces: number; destination: 'order' | 'stock'; at: string }
export interface Model {
  version: 1; nextId: number; items: Item[]; kilns: { id: number; name: string }[];
  plans: Plan[]; reservations: Reservation[]; rounds: Round[]; qcs: Qc[];
  repairReady: { qcId: number; kind: 'underfired' | 'touchup'; pieces: number }[];
  allocations: Allocation[]; stockGrades: Grade[];
  railsReady: { kilnId: number; rail: number }[];
}
export type Command = { op: string; [key: string]: any };
const total = (values: number[]) => values.reduce((a, b) => a + b, 0);
const find = <T>(items: T[], predicate: (item: T) => boolean, label: string): T => items.find(predicate) ?? fail(`ไม่พบ${label}`, 404);
const id = (s: Model) => s.nextId++;
const count = (value: unknown, label = 'จำนวน', min = 0) => integer(value, label, min);
function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) fail('วันเวลาต้องถูกต้องและมีเขตเวลา');
  calendarDate(value.slice(0, 10), 'วันที่');
  const time = value.slice(11, 19).split(':').map(Number);
  if (time[0] > 23 || time[1] > 59 || (time[2] ?? 0) > 59) fail('เวลาไม่ถูกต้อง');
  return value;
}
const after = (at: string, min: string) => { if (Date.parse(at) < Date.parse(min)) fail('วันเวลาต้องตรงกับหรือหลังเหตุการณ์ก่อนหน้า'); };
const bangkokDay = (at: string) => new Date(Date.parse(at) + 7 * 3600000).toISOString().slice(0, 10);
function text(value: unknown, label: string, optional = false, max = 250): string {
  if (optional && (value === undefined || value === '')) return '';
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`กรุณาระบุ${label}ให้ถูกต้อง`);
  return value.trim();
}
export function emptyState(items: Item[] = []): Model {
  return { version: 1, nextId: 1, items, kilns: [1, 2, 3, 4, 5, 6, 8].map(id => ({ id, name: `เตา ${id}` })), plans: [], reservations: [], rounds: [], qcs: [], repairReady: [], allocations: [], stockGrades: [], railsReady: [] };
}
export function demoState(): Model {
  const make = (id: string, reference: string, name: string, ready: number, purpose: Item['purpose'], shapeRange: Range, target = 1000): Item => ({
    id, orderKey: id, reference, name, ready, purpose, shapeRange, target, clay: 'ขาว', color: 'สีทดลอง', rate: 50,
    readyOn: '2026-11-19', clayRange: [1050, 1250], colorRange: [1100, 1200], accepted: ['A+'], synthetic: true,
  });
  const s = emptyState([
    make('demo-od', 'QA-OD-001', 'แผ่นเรียบ 2×8 · ออเดอร์ทดลอง', 1000, 'customer', [1100, 1200]),
    make('demo-os', 'QA-OS-001', 'แผ่นเรียบ 4×4 · สั่งเก็บสต็อก', 500, 'stock', [1100, 1200], 500),
    make('demo-shape', 'QA-OD-002', 'ขอบโค้ง · ทดสอบรูปแบบไม่ผ่าน 1150°C', 100, 'customer', [1000, 1100], 100),
    make('demo-future', 'QA-OD-003', 'งานชุบยังไม่เสร็จ · วางแผนรอได้', 0, 'customer', [1100, 1200], 300),
  ]);
  s.stockGrades = ['A+']; // Explicit synthetic scenario policy, not a factory default.
  return s;
}
function qcById(s: Model, qcId: number) { return find(s.qcs, q => q.id === qcId, 'ผล QC'); }
export function loadById(s: Model, loadId: number) { return find(s.rounds.flatMap(r => r.loads), l => l.id === loadId, 'รายการเข้าเผา'); }
export function rootItem(s: Model, sourceId: string, seen = new Set<string>()): Item {
  if (!sourceId.startsWith('repair:')) return find(s.items, i => i.id === sourceId, 'งานต้นทาง');
  if (seen.has(sourceId)) fail('งานซ่อมอ้างอิงเป็นวงวน');
  seen.add(sourceId);
  const match = /^repair:(\d+):(underfired|touchup)$/.exec(sourceId);
  if (!match) fail('รหัสงานซ่อมไม่ถูกต้อง');
  const qc = qcById(s, Number(match[1]));
  return rootItem(s, loadById(s, qc.loadId).sourceId, seen);
}
export function sourceInfo(s: Model, sourceId: string) {
  const item = rootItem(s, sourceId);
  let ready = item.ready, readyOn = item.readyOn;
  if (sourceId.startsWith('repair:')) {
    const [, qcId, kind] = sourceId.split(':');
    const qc = qcById(s, Number(qcId));
    ready = s.repairReady.find(r => r.qcId === qc.id && r.kind === kind)?.pieces ?? 0;
    readyOn = bangkokDay(qc.at);
  }
  const used = total(s.reservations.filter(r => r.sourceId === sourceId && r.status !== 'cancelled').map(r => r.pieces));
  const code = item.purpose === 'customer' ? (sourceId.startsWith('repair:') ? 'ODP' : 'OD') : (sourceId.startsWith('repair:') ? 'OSP' : 'OS');
  return { ...item, sourceId, available: ready - used, sourceReady: ready, sourceUsed: used, readyOn, code };
}
export function sources(s: Model) {
  return [...s.items.map(i => sourceInfo(s, i.id)), ...s.qcs.flatMap(q => (['underfired', 'touchup'] as const)
    .filter(k => q.counts[k] > 0 || s.reservations.some(r => r.sourceId === `repair:${q.id}:${k}`) || s.plans.some(p => p.sourceId === `repair:${q.id}:${k}`))
    .map(k => sourceInfo(s, `repair:${q.id}:${k}`)))];
}
export function railState(s: Model, kilnId: number, rail: number) {
  const round = s.rounds.find(r => r.kilnId === kilnId && r.rail === rail && !r.unloadedAt);
  if (round) return { stage: round.withdrawnAt ? 'cooling' : 'firing', round };
  return { stage: s.reservations.some(r => r.kilnId === kilnId && r.rail === rail && r.status === 'reserved') ? 'preparing' : 'empty', round: undefined };
}
function checkRail(s: Model, kilnId: number, rail: number) {
  find(s.kilns, k => k.id === kilnId, 'เตา');
  if (rail !== 1 && rail !== 2) fail('เบอร์เตาต้องเป็น 1 หรือ 2');
}
function compatible(s: Model, sourceId: string, temperature: number) {
  const item = rootItem(s, sourceId);
  const ranges = [item.clayRange, ...(item.color ? [item.colorRange] : []), item.shapeRange];
  if (ranges.some(r => !r)) fail('ข้อมูลช่วงอุณหภูมิสี ดิน หรือรูปแบบยังไม่ครบ');
  if (ranges.some(r => temperature < r![0] || temperature > r![1])) fail('อุณหภูมิไม่ผ่านสี ดิน หรือรูปแบบกระเบื้อง');
}
function counts(value: unknown): Counts {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('กรุณาระบุผลคัด');
  return Object.fromEntries(outcomes.map(k => [k, count((value as any)[k] ?? 0, `ยอด ${k}`)])) as Counts;
}
function defects(value: unknown, waste: number): Qc['defects'] {
  if (!Array.isArray(value)) fail('รายการอาการเสียไม่ถูกต้อง');
  const entries = value.map(v => ({ name: text(v?.name, 'อาการเสีย', false, 120), pieces: count(v?.pieces, 'จำนวนเสีย', 1) }));
  if (new Set(entries.map(v => v.name)).size !== entries.length || total(entries.map(v => v.pieces)) !== waste) fail('ยอดอาการเสียหลักต้องรวมตรงกับยอดเสียและไม่ซ้ำชื่อ');
  return entries;
}
export function orderAllocated(s: Model, orderKey: string) {
  return total(s.allocations.filter(a => a.destination === 'order' && rootItem(s, loadById(s, qcById(s, a.qcId).loadId).sourceId).orderKey === orderKey).map(a => a.pieces));
}
function validate(s: Model) {
  for (const item of s.items) {
    count(item.ready); count(item.target); if (!Number.isFinite(item.rate) || item.rate < 0) fail('อัตราแผ่นต่อ ตร.ม. ไม่ถูกต้อง');
    for (const range of [item.clayRange, item.colorRange, item.shapeRange]) if (range && (range.length !== 2 || range.some(n => !Number.isInteger(n) || n <= 0) || range[0] > range[1])) fail('ช่วงอุณหภูมิไม่ถูกต้อง');
    if (item.accepted.some(g => !grades.includes(g))) fail('เกรดที่ออเดอร์ยอมรับไม่ถูกต้อง');
    if (orderAllocated(s, item.orderKey) > item.target) fail('ยอดพร้อมส่งเกินยอดออเดอร์');
  }
  if (s.stockGrades.some(g => !grades.includes(g))) fail('เกรดรับสต็อกไม่ถูกต้อง');
  for (const source of sources(s)) if (source.available < 0) fail('ยอดของพร้อมเหลือไม่พอหรือถูกกันแล้ว');
  for (const round of s.rounds) for (const load of round.loads) {
    count(load.pieces, 'จำนวนเข้าเผา');
    if (total(s.qcs.filter(q => q.loadId === load.id).map(q => total(Object.values(q.counts)))) > load.pieces) fail('ยอดคัด QC เกินจำนวนเข้าเผา');
  }
  for (const q of s.qcs) {
    defects(q.defects, q.counts.waste);
    for (const g of grades) {
      const allocations = s.allocations.filter(a => a.qcId === q.id && a.grade === g);
      if (total(allocations.map(a => a.pieces)) > q.counts[g]) fail('ยอดจัดสรร/รับสต็อกเกินผลคัดเกรด');
      const item = rootItem(s, loadById(s, q.loadId).sourceId);
      for (const a of allocations.filter(a => a.pieces > 0)) {
        if (a.destination === 'order' && (item.purpose !== 'customer' || !item.accepted.includes(g))) fail('เกรดไม่ตรงกับที่ออเดอร์ยอมรับ');
        if (a.destination === 'stock' && !s.stockGrades.includes(g)) fail('ยังไม่กำหนดให้เกรดนี้รับสต็อกได้');
        if (a.destination === 'stock' && item.purpose === 'customer' && orderAllocated(s, item.orderKey) < item.target) fail('ต้องกันยอดให้ออเดอร์ครบก่อนรับส่วนเกินเข้าสต็อก');
      }
    }
    for (const kind of ['underfired', 'touchup'] as const) {
      const ready = s.repairReady.find(r => r.qcId === q.id && r.kind === kind)?.pieces ?? 0;
      if (ready > q.counts[kind] || ready < 0) fail('จำนวนพร้อมซ่อมเกินยอดรอซ่อม');
    }
  }
}

export function transition(input: Model, c: Command): Model {
  const s = structuredClone(input);
  const unready = (kilnId: number, rail: number) => { s.railsReady = s.railsReady.filter(r => r.kilnId !== kilnId || r.rail !== rail); };
  switch (c.op) {
    case 'plan': {
      const source = sourceInfo(s, text(c.sourceId, 'งานต้นทาง'));
      checkRail(s, c.kilnId, c.rail);
      const pieces = count(c.pieces, 'จำนวนแผน', 1), date = calendarDate(c.date, 'วันที่แผน');
      if (c.unit !== 'pieces' && c.unit !== 'sqm') fail('หน่วยแผนไม่ถูกต้อง');
      if (c.unit === 'sqm' && source.rate <= 0) fail('ยังไม่กำหนดอัตราแผ่นต่อ ตร.ม. กรุณาตั้งค่าหรือใช้หน่วยแผ่น');
      if (typeof c.input !== 'number' || !Number.isFinite(c.input) || c.input <= 0) fail('ค่าปริมาณแผนไม่ถูกต้อง');
      if (c.unit === 'pieces' && c.input !== pieces) fail('ยอดแผนกับจำนวนแผ่นต้องตรงกัน');
      if (c.unit === 'sqm' && Math.abs(c.input * source.rate - pieces) >= 1) fail('กรุณายืนยันจำนวนเต็มที่ใกล้กับพื้นที่ที่กรอก');
      s.plans.push({ id: id(s), sourceId: c.sourceId, kilnId: c.kilnId, rail: c.rail, date, pieces, unit: c.unit, input: c.input, temperature: count(c.temperature, 'อุณหภูมิ', 1) });
      break;
    }
    case 'reserve': {
      const plan = find(s.plans, p => p.id === c.planId, 'แผน');
      if (plan.cancelled) fail('แผนนี้ยกเลิกแล้ว');
      const pieces = count(c.pieces, 'จำนวนเตรียม', 1);
      if (railState(s, plan.kilnId, plan.rail).round) fail('เบอร์นี้ยังใช้งานอยู่');
      const planned = total(s.reservations.filter(r => r.planId === plan.id && r.status !== 'cancelled').map(r => r.pieces));
      if (pieces + planned > plan.pieces) fail('ยอดเตรียมเกินแผน กรุณาปรับแผนก่อน');
      compatible(s, plan.sourceId, plan.temperature);
      s.reservations.push({ id: id(s), planId: plan.id, sourceId: plan.sourceId, kilnId: plan.kilnId, rail: plan.rail, pieces, status: 'reserved' });
      unready(plan.kilnId, plan.rail);
      break;
    }
    case 'plan-edit': {
      const p = find(s.plans, p => p.id === c.planId, 'แผน');
      if (p.cancelled) fail('แผนนี้ยกเลิกแล้ว');
      const pieces = count(c.pieces, 'จำนวนแผนที่แก้', 1);
      if (total(s.reservations.filter(r => r.planId === p.id && r.status !== 'cancelled').map(r => r.pieces)) > pieces) fail('ยอดแผนที่แก้น้อยกว่าของที่เตรียมหรือเข้าเผาแล้ว');
      p.pieces = pieces; p.input = pieces; p.unit = 'pieces'; p.date = calendarDate(c.date, 'วันที่แผน'); p.temperature = count(c.temperature, 'อุณหภูมิ', 1);
      for (const r of s.reservations.filter(r => r.planId === p.id && r.status === 'reserved')) unready(r.kilnId, r.rail);
      break;
    }
    case 'plan-cancel': {
      const p = find(s.plans, p => p.id === c.planId, 'แผน');
      const prepared = s.reservations.filter(r => r.planId === p.id && r.status !== 'cancelled');
      if (prepared.some(r => r.status === 'loaded')) fail('แผนนี้มีรายการเข้าเผาแล้ว ให้แก้ยอดที่รายการเข้าเผา');
      p.cancelled = true;
      for (const r of prepared) { r.status = 'cancelled'; unready(r.kilnId, r.rail); }
      break;
    }
    case 'move': {
      const r = find(s.reservations, r => r.id === c.reservationId, 'รายการเตรียม');
      const pieces = count(c.pieces, 'จำนวนย้าย', 1);
      checkRail(s, c.kilnId, c.rail);
      if (r.status !== 'reserved' || pieces > r.pieces || railState(s, c.kilnId, c.rail).round) fail('ย้ายได้เฉพาะของเตรียมที่ยังไม่เข้าเผาและเบอร์ปลายทางว่าง');
      compatible(s, r.sourceId, find(s.plans, p => p.id === r.planId, 'แผน').temperature);
      unready(r.kilnId, r.rail); unready(c.kilnId, c.rail);
      r.pieces -= pieces;
      if (!r.pieces) r.status = 'cancelled';
      s.reservations.push({ ...r, id: id(s), kilnId: c.kilnId, rail: c.rail, pieces, status: 'reserved' });
      break;
    }
    case 'cancel': {
      const r = find(s.reservations, r => r.id === c.reservationId, 'รายการเตรียม');
      if (r.status !== 'reserved') fail('ยกเลิกได้เฉพาะรายการที่ยังไม่เข้าเผา');
      unready(r.kilnId, r.rail);
      r.status = 'cancelled'; break;
    }
    case 'rail-ready': {
      checkRail(s, c.kilnId, c.rail);
      if (railState(s, c.kilnId, c.rail).round || !s.reservations.some(r => r.kilnId === c.kilnId && r.rail === c.rail && r.status === 'reserved')) fail('เบอร์นี้ยังไม่มีของเตรียมหรือยังใช้งานอยู่');
      unready(c.kilnId, c.rail); s.railsReady.push({ kilnId: c.kilnId, rail: c.rail }); break;
    }
    case 'start': {
      checkRail(s, c.kilnId, c.rail);
      const at = timestamp(c.at), temperature = count(c.temperature, 'อุณหภูมิ', 1);
      if (s.rounds.some(r => r.kilnId === c.kilnId && !r.withdrawnAt)) fail('เตานี้มีเบอร์อยู่ในเตาแล้ว');
      for (const previous of s.rounds.filter(r => r.kilnId === c.kilnId)) {
        if (previous.withdrawnAt) after(at, previous.withdrawnAt);
        if (previous.rail === c.rail && previous.unloadedAt) after(at, previous.unloadedAt);
      }
      if (railState(s, c.kilnId, c.rail).round) fail('เบอร์นี้ยังใช้งานอยู่');
      if (!s.railsReady.some(r => r.kilnId === c.kilnId && r.rail === c.rail)) fail('กรุณายืนยันเบอร์พร้อมเข้าก่อน');
      const prepared = s.reservations.filter(r => r.kilnId === c.kilnId && r.rail === c.rail && r.status === 'reserved');
      if (!prepared.length) fail('ยังไม่มีของเตรียมลงเบอร์');
      const round: Round = { id: id(s), kilnId: c.kilnId, rail: c.rail, temperature, startedAt: at, logs: [], loads: [] };
      for (const r of prepared) {
        compatible(s, r.sourceId, temperature);
        if (sourceInfo(s, r.sourceId).readyOn > bangkokDay(at)) fail('วันเข้าเผาก่อนของพร้อม');
        if (r.sourceId.startsWith('repair:')) {
          const parent = qcById(s, Number(r.sourceId.split(':')[1])); after(at, parent.at);
        }
        const item = rootItem(s, r.sourceId);
        r.status = 'loaded'; round.loads.push({ id: id(s), reservationId: r.id, sourceId: r.sourceId, pieces: r.pieces,
          criteria: { clayRange: item.clayRange, colorRange: item.colorRange, shapeRange: item.shapeRange } });
      }
      unready(c.kilnId, c.rail);
      s.rounds.push(round); break;
    }
    case 'stop': case 'withdraw': case 'unload': {
      const round = find(s.rounds, r => r.id === c.roundId, 'รอบเผา'), at = timestamp(c.at);
      if (c.op === 'stop') {
        if (round.stoppedAt) fail('บันทึกปิดไฟแล้ว'); after(at, round.startedAt);
        if (round.logs.some(l => Date.parse(l.at) > Date.parse(at))) fail('เวลาปิดไฟต้องไม่ก่อนบันทึกอุณหภูมิที่มีอยู่');
        round.stoppedAt = at;
      }
      if (c.op === 'withdraw') { if (!round.stoppedAt || round.withdrawnAt) fail('ต้องปิดไฟก่อนและยังไม่ได้นำออก'); after(at, round.stoppedAt); round.withdrawnAt = at; }
      if (c.op === 'unload') { if (!round.withdrawnAt || round.unloadedAt) fail('ต้องนำออกก่อนและยังไม่ได้ลงของเสร็จ'); after(at, round.withdrawnAt); round.unloadedAt = at; }
      break;
    }
    case 'log': {
      const round = find(s.rounds, r => r.id === c.roundId, 'รอบเผา'), at = timestamp(c.at);
      after(at, round.startedAt);
      if (round.stoppedAt && Date.parse(at) > Date.parse(round.stoppedAt)) fail('เวลาอ่านอุณหภูมิหลังปิดไฟ');
      if (round.logs.some(l => Date.parse(l.at) === Date.parse(at))) fail('เวลานี้มีบันทึกแล้ว ให้ใช้แก้ข้อมูล');
      const temperature = count(c.temperature, 'อุณหภูมิจริง');
      if (temperature > 2000) fail('อุณหภูมิจริงเกินช่วงเครื่องมือที่แบบจำลองรองรับ');
      round.logs.push({ id: id(s), at, temperature, cone: text(c.cone, 'เบอร์โคน', true, 40), note: text(c.note, 'หมายเหตุ', true) }); break;
    }
    case 'qc': {
      const load = loadById(s, c.loadId), round = find(s.rounds, r => r.loads.some(l => l.id === load.id), 'รอบเผา');
      if (!round.unloadedAt) fail('ต้องเอาของลงจากเบอร์ก่อนคัด QC');
      const at = timestamp(c.at); after(at, round.unloadedAt);
      const result = counts(c.counts);
      if (!total(Object.values(result))) fail('กรุณาระบุจำนวนที่คัด');
      s.qcs.push({ id: id(s), loadId: load.id, at, counts: result, defects: defects(c.defects ?? [], result.waste), note: text(c.note, 'หมายเหตุ', true) }); break;
    }
    case 'repair-ready': {
      const q = qcById(s, c.qcId);
      if (c.kind !== 'underfired' && c.kind !== 'touchup') fail('ประเภทซ่อมไม่ถูกต้อง');
      const pieces = count(c.pieces, 'จำนวนพร้อมกลับเตา', 1);
      const ready = s.repairReady.find(r => r.qcId === q.id && r.kind === c.kind);
      if (ready) ready.pieces += pieces; else s.repairReady.push({ qcId: q.id, kind: c.kind, pieces }); break;
    }
    case 'allocate': {
      const qc = qcById(s, c.qcId);
      if (!grades.includes(c.grade)) fail('เกรดไม่ถูกต้อง');
      if (c.destination !== 'order' && c.destination !== 'stock') fail('ปลายทางไม่ถูกต้อง');
      const at = timestamp(c.at ?? new Date().toISOString()); after(at, qc.at);
      s.allocations.push({ id: id(s), qcId: c.qcId, grade: c.grade, destination: c.destination, pieces: count(c.pieces, 'จำนวนจัดสรร', 1), at }); break;
    }
    case 'policy': {
      if (!Array.isArray(c.accepted) || !Array.isArray(c.stockGrades)) fail('รายการเกรดไม่ถูกต้อง');
      const item = find(s.items, i => i.id === c.sourceId, 'งาน');
      for (const i of s.items.filter(i => i.orderKey === item.orderKey)) i.accepted = c.accepted;
      s.stockGrades = c.stockGrades; break;
    }
    case 'settings': {
      const item = find(s.items, i => i.id === c.sourceId, 'งาน');
      for (const key of ['clayRange', 'colorRange', 'shapeRange'] as const) if (c[key] !== undefined) item[key] = c[key];
      if (c.rate !== undefined) {
        if (typeof c.rate !== 'number' || !Number.isFinite(c.rate) || c.rate <= 0) fail('อัตราแผ่นต่อ ตร.ม. ต้องมากกว่า 0');
        item.rate = c.rate;
      }
      if (c.ready !== undefined) {
        if (!item.synthetic) fail('ยอดต้นทางสำเนาจริงให้อ่านอย่างเดียว');
        item.ready = count(c.ready);
      }
      break;
    }
    case 'correct': {
      if (c.loadId !== undefined) {
        const load = loadById(s, c.loadId); load.pieces = count(c.pieces, 'ยอดเข้าเผาที่แก้');
        find(s.reservations, r => r.id === load.reservationId, 'รายการเตรียม').pieces = load.pieces;
      }
      if (c.logId !== undefined) {
        const log = find(s.rounds.flatMap(r => r.logs), l => l.id === c.logId, 'บันทึกไฟ'); log.temperature = count(c.temperature, 'อุณหภูมิที่แก้');
        if (log.temperature > 2000) fail('อุณหภูมิเกินช่วงแบบจำลอง');
      }
      for (const patch of c.qcs ?? []) { const q = qcById(s, patch.id); q.counts = counts(patch.counts); q.defects = defects(patch.defects ?? [], q.counts.waste); }
      for (const patch of c.allocations ?? []) find(s.allocations, a => a.id === patch.id, 'จัดสรร/สต็อก').pieces = count(patch.pieces, 'ยอดจัดสรรที่แก้');
      for (const patch of c.repairReady ?? []) find(s.repairReady, r => r.qcId === patch.qcId && r.kind === patch.kind, 'ยอดซ่อมพร้อม').pieces = count(patch.pieces, 'ยอดพร้อมที่แก้');
      break;
    }
    default: fail('ไม่รู้จักการทำงานนี้');
  }
  validate(s);
  return s;
}
export function summarize(s: Model) {
  const loads = s.rounds.flatMap(r => r.loads), qcTotal = total(s.qcs.map(q => total(Object.values(q.counts))));
  const repairTotal = total(s.qcs.map(q => q.counts.underfired + q.counts.touchup));
  const repairUsed = total(s.reservations.filter(r => r.sourceId.startsWith('repair:') && r.status === 'loaded').map(r => r.pieces));
  return { planned: total(s.plans.filter(p => !p.cancelled).map(p => p.pieces)), reserved: total(s.reservations.filter(r => r.status === 'reserved').map(r => r.pieces)),
    throughput: total(loads.map(l => l.pieces)), freshFired: total(loads.filter(l => !l.sourceId.startsWith('repair:')).map(l => l.pieces)),
    waitingQc: total(loads.map(l => l.pieces)) - qcTotal, repairWaiting: repairTotal - repairUsed,
    waste: total(s.qcs.map(q => q.counts.waste)), orderReady: total(s.allocations.filter(a => a.destination === 'order').map(a => a.pieces)),
    stock: total(s.allocations.filter(a => a.destination === 'stock').map(a => a.pieces)) };
}
