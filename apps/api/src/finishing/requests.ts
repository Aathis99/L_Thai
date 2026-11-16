import { fail } from '../auth.js';
import { one, type Db } from '../database.js';
import { pressingText } from '../pressing/catalog.js';

export type Body = Record<string, unknown>;
export type Recorder = { id: number; username: string };

// The caller holds the application's write transaction for the lookup, mutation and receipt.
export async function finishingRequest(db: Db, operation: string, body: Body, payload: object, save: () => Promise<number>) {
  const id = pressingText(body.request_id, 'รหัสคำขอ', true);
  const json = JSON.stringify(payload);
  const existing = await one(db, `SELECT operation,result_id,payload=$2::jsonb AS matches
    FROM finishing_requests WHERE request_id=$1`, [id, json]);
  if (existing) {
    if (existing.operation !== operation || !existing.matches) fail('รหัสคำขอนี้ถูกใช้กับข้อมูลอื่นแล้ว', 409);
    return existing.result_id as number;
  }
  const result = await save();
  await db.query(`INSERT INTO finishing_requests(request_id,operation,payload,result_id)
    VALUES($1,$2,$3,$4)`, [id, operation, json, result]);
  return result;
}
