import type { Request, Response } from 'express';
import { fail } from '../auth.js';
import { audit, type Db } from '../database.js';
import { createOrder, listOrders, listTypes, listWorkers, removeType, saveType, updateOrderTarget } from './catalog.js';

export interface PressingAccess {
  db: Db;
  require(permission: string): void;
  mutate<T>(permission: string, run: (db: Db, actor: { id: number; username: string }) => Promise<T>): Promise<T>;
}

function routeId(value: string): number {
  const id = Number(value);
  if (!/^[1-9]\d*$/.test(value) || id > 2147483647) fail('รหัสรายการไม่ถูกต้อง');
  return id;
}

export async function handlePressingRoute(req: Request, res: Response, access: PressingAccess): Promise<boolean> {
  const match = req.path.match(/^\/pressing\/(types|orders|workers)(?:\/([^/]+))?$/);
  if (!match) return false;
  const [, resource, rawId] = match;
  const { method, body = {} } = req;

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
