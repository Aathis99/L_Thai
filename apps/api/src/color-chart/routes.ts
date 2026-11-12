import type { Request, Response } from 'express';
import type { SessionRouteAccess } from '../app.js';
import { fail } from '../auth.js';
import { audit } from '../database.js';
import { listColorChart, removeColorChartEntry, saveColorChartEntry } from './catalog.js';

function routeId(value: string): number {
  if (!/^[1-9]\d*$/.test(value) || Number(value) > 2147483647) fail('รหัสรายการไม่ถูกต้อง');
  return Number(value);
}

export async function handleColorChartRoute(req: Request, res: Response, access: SessionRouteAccess): Promise<boolean> {
  const match = req.path.match(/^\/color-chart(?:\/([^/]+))?$/);
  if (!match) return false;
  const [, rawId] = match;
  const { method, body = {} } = req;
  if (method === 'GET' && rawId === undefined) {
    access.require('color_chart.read');
    res.json({ items: await listColorChart(access.db) });
    return true;
  }
  const create = method === 'POST' && rawId === undefined;
  const update = method === 'PUT' && rawId !== undefined;
  const remove = method === 'DELETE' && rawId !== undefined;
  if (!create && !update && !remove) return false;

  const id = await access.mutate('color_chart.manage', async (db, actor) => {
    if (remove) {
      const id = await removeColorChartEntry(db, routeId(rawId));
      await audit(db, actor.username, 'ลบรายการชาร์ตสี', String(id));
      return id;
    }
    const id = await saveColorChartEntry(db, body, update ? routeId(rawId) : undefined);
    await audit(db, actor.username, create ? 'เพิ่มรายการชาร์ตสี' : 'แก้ไขรายการชาร์ตสี', String(id));
    return id;
  });
  res.status(create ? 201 : 200).json({ id });
  return true;
}
