import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual, promisify } from 'node:util';
import { applyColorChartSeed, validateColorChartSeed } from './seed.js';

const runFile = promisify(execFile);
const extractor = fileURLToPath(new URL('../../../../scripts/extract-color-chart.py', import.meta.url));

async function extractWorkbook(workbook: string): Promise<unknown> {
  const python = process.env.LTHAI_COLOR_CHART_PYTHON || 'python';
  try {
    const { stdout } = await runFile(python, ['-X', 'utf8', extractor, '--stdout', workbook]);
    return JSON.parse(stdout);
  } catch (error) {
    const stderr = error instanceof Error && 'stderr' in error && typeof error.stderr === 'string'
      ? error.stderr.trim() : '';
    throw new Error(`เปิดไฟล์ Excel ไม่สำเร็จ: ${stderr || (error instanceof Error ? error.message : python)}`);
  }
}

try {
  const [mode, workbookPath, preparedPath, ...extra] = process.argv.slice(2);
  if ((mode !== '--preview' && mode !== '--apply') || !workbookPath || !preparedPath || extra.length) {
    throw new Error('ใช้ color-chart:seed --preview หรือ --apply ตามด้วย <workbook> <prepared-json>');
  }
  const base = process.env.INIT_CWD ?? process.cwd();
  const workbook = resolve(base, workbookPath);
  const prepared = resolve(base, preparedPath);
  const payload: unknown = JSON.parse(await readFile(prepared, 'utf8'));
  const canonical = await extractWorkbook(workbook);
  const seed = validateColorChartSeed(canonical);
  if (!payload || typeof payload !== 'object' || !('sourceSha256' in payload)
    || payload.sourceSha256 !== seed.sourceSha256) {
    throw new Error('SHA-256 ของ Excel ไม่ตรงกับข้อมูลที่เตรียม กรุณาเตรียมและตรวจข้อมูลใหม่');
  }
  if (!isDeepStrictEqual(payload, canonical)) {
    throw new Error('ข้อมูลที่เตรียมไม่ตรงกับ Excel กรุณาเตรียมและตรวจข้อมูลใหม่');
  }

  if (mode === '--preview') {
    console.log(JSON.stringify(canonical, null, 2));
  } else {
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (!databaseUrl) throw new Error('กรุณาระบุ DATABASE_URL สำหรับฐานข้อมูลเป้าหมายก่อนนำเข้าชาร์ตสี');
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: databaseUrl });
    try {
      console.log(JSON.stringify(await applyColorChartSeed(pool, seed)));
    } finally {
      await pool.end();
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'นำเข้าชาร์ตสีไม่สำเร็จ');
  process.exitCode = 1;
}
