import type { Request, Response } from 'express';
import { fail } from '../auth.js';
import type { SessionRouteAccess } from '../app.js';
import { readPrototype, savePrototype } from './store.js';

const permissions: Record<string, string> = {
  demo: 'finishing.fire', import: 'finishing.fire', plan: 'finishing.fire', reserve: 'finishing.fire',
  move: 'finishing.fire', cancel: 'finishing.fire', 'rail-ready': 'finishing.fire', start: 'finishing.fire', stop: 'finishing.fire',
  withdraw: 'finishing.fire', unload: 'finishing.fire', log: 'finishing.fire', qc: 'finishing.qc',
  'repair-ready': 'finishing.qc', settings: 'finishing.temperature', policy: 'pressing.manage', correct: 'finishing.correct',
  'plan-edit': 'finishing.correct', 'plan-cancel': 'finishing.fire',
};
export async function handleKilnPrototype(req: Request, res: Response, access: SessionRouteAccess) {
  if (process.env.KILN_QA_MODE !== 'true') return false;
  access.require('finishing.read');
  if (req.method === 'GET' && req.path === '/kiln-qa/state') {
    res.json(await readPrototype(access.db)); return true;
  }
  if (req.method === 'POST' && req.path === '/kiln-qa/action') {
    const command = req.body?.command;
    const permission = command?.op === 'allocate' ? (command.destination === 'stock' ? 'finishing.stock' : 'finishing.allocate') : permissions[command?.op];
    if (!permission) fail('ไม่รู้จักการทำงานนี้');
    if (command.op === 'correct') {
      // Composite corrections never inherit permission from the kiln page.
      if (command.qcs?.length || command.repairReady?.length) access.require('finishing.qc');
      if (command.allocations?.length) { access.require('finishing.allocate'); access.require('finishing.stock'); }
    }
    if (command.op === 'policy') access.require('finishing.stock');
    const result = await access.mutate(permission, async (db, actor) => {
      const require = (p: string) => { if (!actor.permissions.includes(p)) fail('สิทธิ์ของบัญชีเปลี่ยนแล้ว กรุณาโหลดใหม่', 403); };
      if (command.op === 'correct') {
        if (command.qcs?.length || command.repairReady?.length) require('finishing.qc');
        if (command.allocations?.length) { require('finishing.allocate'); require('finishing.stock'); }
      }
      if (command.op === 'policy') require('finishing.stock');
      return savePrototype(db, req.body, actor.username);
    });
    res.status(201).json(result); return true;
  }
  return false;
}
