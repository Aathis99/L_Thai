import type { Request, Response } from 'express';
import { fail } from '../auth.js';
import { audit, type Db } from '../database.js';
import { createOrder, listOrders, listTypes, listWorkers, removeType, saveType, updateOrderTarget } from './catalog.js';
import {
  adjustEntry, confirmOpeningReady, editEntry, listEntries, listEntryAdjustments, listIssueReversals,
  listIssues, listStock, recordEntry, recordIssue, recordOpening, releaseSurplus, reverseIssue,
} from './stock.js';

export interface PressingAccess {
  db: Db;
  require(permission: string): void;
  mutate<T>(permission: string, run: (db: Db, actor: { id: number; username: string }) => Promise<T>): Promise<T>;
}

function routeId(value: unknown): number {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || Number(value) > 2147483647)
    fail('รหัสรายการไม่ถูกต้อง');
  return Number(value);
}

export async function handlePressingRoute(req: Request, res: Response, access: PressingAccess): Promise<boolean> {
  const { method, body = {} } = req;
  if (method === 'GET' && req.path === '/pressing/entries') {
    access.require('pressing.read');
    const orderId = req.query.order_id === undefined ? undefined : routeId(req.query.order_id);
    res.json({ items: await listEntries(access.db, orderId) });
    return true;
  }
  if (method === 'GET' && req.path === '/pressing/stock') {
    access.require('pressing.read');
    res.json({ items: await listStock(access.db) });
    return true;
  }
  if (method === 'POST' && req.path === '/pressing/entries') {
    const id = await access.mutate('pressing.record', (db, actor) => recordEntry(db, body, actor));
    res.status(201).json({ id });
    return true;
  }
  const entryMatch = req.path.match(/^\/pressing\/entries\/([^/]+)$/);
  if (method === 'PUT' && entryMatch) {
    const id = await access.mutate('pressing.correct', (db, actor) => editEntry(db, routeId(entryMatch[1]), body, actor));
    res.json({ id });
    return true;
  }
  const adjustmentMatch = req.path.match(/^\/pressing\/entries\/([^/]+)\/adjustments$/);
  if (method === 'GET' && adjustmentMatch) {
    access.require('pressing.read');
    res.json({ items: await listEntryAdjustments(access.db, routeId(adjustmentMatch[1])) });
    return true;
  }
  if (method === 'POST' && adjustmentMatch) {
    const id = await access.mutate('pressing.correct',
      (db, actor) => adjustEntry(db, routeId(adjustmentMatch[1]), body, actor));
    res.status(201).json({ id });
    return true;
  }
  if (method === 'POST' && req.path === '/pressing/opening') {
    const id = await access.mutate('pressing.manage', (db, actor) => recordOpening(db, body, actor));
    res.status(201).json({ id });
    return true;
  }

  if (method === 'GET' && req.path === '/pressing/issues') {
    access.require('pressing.read');
    res.json({ items: await listIssues(access.db) });
    return true;
  }
  if (method === 'POST' && req.path === '/pressing/issues') {
    const id = await access.mutate('pressing.issue', (db, actor) => recordIssue(db, body, actor));
    res.status(201).json({ id });
    return true;
  }
  const reversalMatch = req.path.match(/^\/pressing\/issues\/([^/]+)\/reversals$/);
  if (method === 'GET' && reversalMatch) {
    access.require('pressing.read');
    res.json({ items: await listIssueReversals(access.db, routeId(reversalMatch[1])) });
    return true;
  }
  if (method === 'POST' && reversalMatch) {
    const id = await access.mutate('pressing.correct',
      (db, actor) => reverseIssue(db, routeId(reversalMatch[1]), body, actor));
    res.status(201).json({ id });
    return true;
  }
  if (method === 'POST' && req.path === '/pressing/releases') {
    const id = await access.mutate('pressing.release', (db, actor) => releaseSurplus(db, body, actor));
    res.status(201).json({ id });
    return true;
  }
  const readyMatch = req.path.match(/^\/pressing\/stock\/([^/]+)\/ready$/);
  if (method === 'POST' && readyMatch) {
    const id = await access.mutate('pressing.issue',
      (db, actor) => confirmOpeningReady(db, routeId(readyMatch[1]), body, actor));
    res.json({ id });
    return true;
  }

  const match = req.path.match(/^\/pressing\/(types|orders|workers)(?:\/([^/]+))?$/);
  if (!match) return false;
  const [, resource, rawId] = match;

  if (method === 'GET' && rawId === undefined) {
    access.require('pressing.read');
    const list = { types: listTypes, orders: listOrders, workers: listWorkers }[resource as 'types' | 'orders' | 'workers'];
    res.json({ items: await list(access.db) });
    return true;
  }
  if (resource === 'workers') return false;
  const create = method === 'POST' && rawId === undefined;
  const update = method === 'PUT' && rawId !== undefined;
  const remove = method === 'DELETE' && resource === 'types' && rawId !== undefined;
  if (!create && !update && !remove) return false;

  const id = await access.mutate('pressing.manage', async (db, actor) => {
    if (resource === 'types') {
      if (remove) {
        const id = routeId(rawId);
        const retired = await removeType(db, id);
        await audit(db, actor.username, retired ? 'หยุดใช้ประเภทกระเบื้อง' : 'ลบประเภทกระเบื้อง', String(id));
        return id;
      }
      const id = await saveType(db, body, update ? routeId(rawId) : undefined);
      await audit(db, actor.username, create ? 'เพิ่มประเภทกระเบื้อง' : 'แก้ไขประเภทกระเบื้อง', String(id));
      return id;
    }
    if (create) {
      const id = await createOrder(db, body);
      await audit(db, actor.username, 'เพิ่มใบสั่งผลิต', String(id));
      return id;
    }
    const id = routeId(rawId);
    const { previous, target } = await updateOrderTarget(db, id, body);
    if (previous !== target)
      await audit(db, actor.username, `แก้ยอดสั่งปั๊มจาก ${previous} เป็น ${target}`, String(id));
    return id;
  });
  res.status(create ? 201 : 200).json({ id });
  return true;
}
