import { fail, text } from '../auth.js';
import { all, one, type Db } from '../database.js';

function chartText(value: unknown, label: string, required: boolean, max: number): string {
  const result = text(value, label, required, max);
  if (/[\u0000\uD800-\uDFFF]/u.test(result)) fail(`กรุณาระบุ${label}ให้ถูกต้อง`);
  return result;
}

export function validateColorChartName(value: unknown): { name: string; normalizedName: string } {
  const name = chartText(value, 'ชื่อสีกระเบื้อง', true, 120);
  return { name, normalizedName: name.toLowerCase().replace(/\s+/g, ' ') };
}

export function validateColorChartNote(value: unknown): string | null {
  return chartText(value ?? undefined, 'หมายเหตุ', false, 1000) || null;
}

export function listColorChart(db: Db) {
  return all(db, `SELECT e.id,e.display_order,e.name,e.note,(i.entry_id IS NOT NULL) AS has_image
    FROM color_chart_entries e LEFT JOIN color_chart_images i ON i.entry_id=e.id
    ORDER BY e.display_order`);
}

export async function saveColorChartEntry(db: Db, body: Record<string, unknown>, id?: number): Promise<number> {
  const { name, normalizedName } = validateColorChartName(body.name);
  const values = [name, normalizedName, validateColorChartNote(body.note)];
  const row = id === undefined
    ? await one(db, `INSERT INTO color_chart_entries(display_order,name,normalized_name,note)
        SELECT COALESCE(MAX(display_order),0)+1,$1,$2,$3 FROM color_chart_entries RETURNING id`, values)
    : await one(db, `UPDATE color_chart_entries SET name=$1,normalized_name=$2,note=$3
        WHERE id=$4 RETURNING id`, [...values, id]);
  if (!row) fail('ไม่พบรายการชาร์ตสี', 404);
  return row.id;
}

export async function removeColorChartEntry(db: Db, id: number): Promise<number> {
  const row = await one(db, 'DELETE FROM color_chart_entries WHERE id=$1 RETURNING id', [id]);
  if (!row) fail('ไม่พบรายการชาร์ตสี', 404);
  return row.id;
}
