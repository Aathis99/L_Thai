import type { Request, Response } from 'express';
import { all, audit } from '../database.js';
import { integer, listWorkers, prepareLegacyOrder } from '../pressing/catalog.js';
import { fail } from '../auth.js';
import type { PressingAccess } from '../pressing/routes.js';
import { correctLoad, createRound, finishRound, listRanges, listRounds, listSources, loadRound, setRange } from './firing.js';
import { confirmFinishingIssue, correctGlazing, listFinishingIssues, listGlazing, recordGlazing } from './glazing.js';
import { allocateGood, correctQc, listQc, listReceipts, receiveStock, recordQc, voidAllocation, voidQc, voidReceipt } from './qc.js';
import { finishingRequest } from './requests.js';

const reads = {
  issues: listFinishingIssues,
  glazing: listGlazing,
  sources: listSources,
  rounds: listRounds,
  ranges: listRanges,
  qc: listQc,
  stock: listReceipts,
  workers: listWorkers,
  colors: (db: PressingAccess['db']) => all(db, `SELECT id,name FROM (
    SELECT id,name,display_order FROM color_chart_entries UNION ALL
    SELECT color_id,min(color_name),NULL FROM pressing_orders o WHERE color_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM color_chart_entries c WHERE c.id=o.color_id) GROUP BY color_id
    ) colors ORDER BY display_order NULLS LAST,id`),
  orders: (db: PressingAccess['db']) => all(db, `SELECT o.id,o.customer_reference,o.type_id,o.production_clay AS clay,o.color_name,b.customer_pieces,b.ready_pieces,b.missing_pieces
    FROM finishing_order_balances b JOIN pressing_orders o ON o.id=b.id ORDER BY o.id DESC`),
  types: (db: PressingAccess['db']) => all(db, 'SELECT id,width,length,clay,name FROM pressing_types ORDER BY id'),
};

const writes = {
  'confirm-issue': ['finishing.prepare', confirmFinishingIssue],
  'prepare-order': ['finishing.prepare', (db, body, actor) => {
    const id = integer(body.order_id, 'ใบสั่งผลิต');
    const payload = { id, customer_pieces: body.customer_pieces, allowance_percent: body.allowance_percent, color_id: body.color_id };
    return finishingRequest(db, 'prepare-order', body, payload, async () => {
      await prepareLegacyOrder(db, id, body);
      await audit(db, actor.username, 'เติมข้อมูลใบสั่งผลิตค้าง', String(id));
      return id;
    });
  }],
  glazing: ['finishing.glaze', recordGlazing],
  'glazing-correction': ['finishing.correct', correctGlazing],
  rounds: ['finishing.fire', createRound],
  loads: ['finishing.fire', loadRound],
  'load-correction': ['finishing.correct', correctLoad],
  finish: ['finishing.fire', finishRound],
  ranges: ['finishing.temperature', setRange],
  qc: ['finishing.qc', recordQc],
  'qc-correction': ['finishing.correct', correctQc],
  'qc-void': ['finishing.correct', voidQc],
  allocations: ['finishing.allocate', allocateGood],
  'allocation-void': ['finishing.allocate', voidAllocation],
  stock: ['finishing.stock', receiveStock],
  'stock-void': ['finishing.stock', voidReceipt],
} satisfies Record<string, [string, typeof recordGlazing]>;

export async function handleFinishingRoute(req: Request, res: Response, access: PressingAccess) {
  const resource = req.path.slice('/finishing/'.length);
  if (req.method === 'GET' && Object.hasOwn(reads, resource)) {
    access.require('finishing.read');
    res.json({ items: await reads[resource as keyof typeof reads](access.db) });
    return true;
  }
  if (req.method === 'POST' && Object.hasOwn(writes, resource)) {
    const [permission, run] = writes[resource as keyof typeof writes];
    const id = await access.mutate(permission, (db, actor) => {
      if(resource==='rounds'||resource==='loads')fail('งานเข้าเผาใหม่ให้ใช้แผนและเตรียมลงเบอร์ในหน้างานเตา',410);
      return run(db, req.body ?? {}, actor);
    });
    res.status(201).json({ id });
    return true;
  }
  return false;
}
