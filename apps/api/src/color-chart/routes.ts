import express, { type Request, type Response } from 'express';
import type { SessionRouteAccess } from '../app.js';
import { fail } from '../auth.js';
import { audit } from '../database.js';
import { listColorChart, removeColorChartEntry, saveColorChartEntry } from './catalog.js';
import {
  COLOR_CHART_IMAGE_TYPES, COLOR_CHART_UPLOAD_MAX_BYTES,
  encodeColorChartImage, readColorChartImage, removeColorChartImage, saveColorChartImage,
} from './images.js';

export const COLOR_CHART_IMAGE_PATH = /^\/color-chart\/([^/]+)\/image$/;
const parseImageBody = express.raw({
  type: COLOR_CHART_IMAGE_TYPES, limit: COLOR_CHART_UPLOAD_MAX_BYTES, inflate: false,
});

function routeId(value: string): number {
  if (!/^[1-9]\d*$/.test(value) || Number(value) > 2147483647) fail('รหัสรายการไม่ถูกต้อง');
  return Number(value);
}

async function handleColorChartImageRoute(
  req: Request, res: Response, access: SessionRouteAccess, rawId: string,
): Promise<boolean> {
  if (!['GET', 'PUT', 'DELETE'].includes(req.method)) return false;
  access.require('color_chart.read');
  if (req.method !== 'GET') access.require('color_chart.manage');
  const id = routeId(rawId);
  if (req.method === 'GET') {
    const image = await readColorChartImage(access.db, id);
    res.type('image/webp').send(image);
    return true;
  }

  let image: Buffer | undefined;
  if (req.method === 'PUT') {
    const contentType = req.is(COLOR_CHART_IMAGE_TYPES);
    if (!contentType) fail('รองรับเฉพาะภาพ JPEG, PNG และ WebP', 415);
    if ((req.get('content-encoding') ?? 'identity').toLowerCase() !== 'identity')
      fail('กรุณาส่งไฟล์ภาพโดยตรง', 415);
    await new Promise<void>((resolve, reject) => {
      parseImageBody(req, res, error => error ? reject(error) : resolve());
    });
    if (!Buffer.isBuffer(req.body)) fail('กรุณาเลือกไฟล์ภาพ');
    image = await encodeColorChartImage(req.body, contentType);
  }
  await access.mutate('color_chart.manage', async (db, actor) => {
    if (image) {
      await saveColorChartImage(db, id, image);
      await audit(db, actor.username, 'บันทึกภาพชาร์ตสี', String(id));
    } else if (await removeColorChartImage(db, id)) {
      await audit(db, actor.username, 'ลบภาพชาร์ตสี', String(id));
    }
  });
  res.json({ id });
  return true;
}

export async function handleColorChartRoute(req: Request, res: Response, access: SessionRouteAccess): Promise<boolean> {
  const imageMatch = req.path.match(COLOR_CHART_IMAGE_PATH);
  if (imageMatch) return handleColorChartImageRoute(req, res, access, imageMatch[1]);
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
