import type { Pool } from 'pg';
import { one, transaction } from '../database.js';
import { validateColorChartName, validateColorChartNote } from './catalog.js';

const SEED_KEY = 'color-chart-initial-v1';
const SHEET = 'Sheet1';
const ITEM_COUNT = 90;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('รูปแบบข้อมูลตั้งต้นชาร์ตสีไม่ถูกต้อง');
  }
  return value as Record<string, unknown>;
}

export function validateColorChartSeed(input: unknown) {
  const payload = record(input);
  const { sourceSha256 } = payload;
  if (typeof sourceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sourceSha256)) {
    throw new Error('ข้อมูลตั้งต้นชาร์ตสีต้องระบุ SHA-256 ของ Excel');
  }
  if (payload.sheet !== SHEET || !Array.isArray(payload.items) || payload.items.length !== ITEM_COUNT) {
    throw new Error(`ข้อมูลตั้งต้นชาร์ตสีต้องมาจาก ${SHEET} และมี ${ITEM_COUNT} รายการ`);
  }

  const names = new Map<string, number>();
  const items = payload.items.map((value: unknown, index) => {
    const display_order = index + 1;
    const row = record(value);
    if (row.display_order !== display_order) {
      throw new Error(`ลำดับชาร์ตสีไม่ถูกต้องที่ #${display_order}`);
    }
    const { name, normalizedName } = validateColorChartName(row.name);
    const previousOrder = names.get(normalizedName);
    if (previousOrder !== undefined) {
      throw new Error(`ชื่อซ้ำที่ #${previousOrder} และ #${display_order}: ${name}`);
    }
    names.set(normalizedName, display_order);
    const note = validateColorChartNote(row.note);
    if ((note !== null) !== [79, 80, 83].includes(display_order)) {
      throw new Error(`หมายเหตุชาร์ตสีไม่ตรงกับลำดับ #${display_order}`);
    }
    return { display_order, name, note, normalized_name: normalizedName };
  });
  if (items[78].note !== items[79].note) {
    throw new Error('หมายเหตุชาร์ตสีของ #79 และ #80 ต้องตรงกัน');
  }
  return { sourceSha256, sheet: SHEET, items };
}

export async function applyColorChartSeed(pool: Pool, seed: ReturnType<typeof validateColorChartSeed>) {
  const { sourceSha256, sheet, items } = seed;
  return transaction(pool, async db => {
    const previous = await one(db, 'SELECT details FROM data_migrations WHERE key=$1', [SEED_KEY]);
    if (previous) {
      if (previous.details.sourceSha256 !== sourceSha256) {
        throw new Error('เคยนำเข้าชาร์ตสีด้วย SHA-256 อื่น กรุณาตรวจสอบชุดข้อมูลเดิม');
      }
      return { status: 'skipped', items: previous.details.items, message: 'เคยนำเข้าแล้ว' };
    }

    const conflict = await one(db, `SELECT display_order,name FROM color_chart_entries
      WHERE normalized_name=ANY($1::text[]) OR display_order=ANY($2::int[])
      ORDER BY display_order LIMIT 1`, [
      items.map(item => item.normalized_name), items.map(item => item.display_order),
    ]);
    if (conflict) {
      throw new Error(`ชื่อหรือลำดับชนกับทะเบียนชาร์ตสี #${conflict.display_order}: ${conflict.name}`);
    }

    await db.query(`INSERT INTO color_chart_entries(display_order,name,normalized_name,note)
      SELECT display_order,name,normalized_name,note
      FROM jsonb_to_recordset($1::jsonb)
        AS item(display_order int,name text,normalized_name text,note text)
      ORDER BY display_order`, [JSON.stringify(items)]);
    await db.query('INSERT INTO data_migrations(key,details) VALUES($1,$2::jsonb)', [
      SEED_KEY, JSON.stringify({ sourceSha256, sheet, items: items.length }),
    ]);
    return { status: 'imported', items: items.length };
  });
}
