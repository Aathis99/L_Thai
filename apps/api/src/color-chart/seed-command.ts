import { resolve } from 'node:path';
import { applyColorChartSeed, readColorChartSeed } from './seed.js';

try {
  const [mode, workbookPath, preparedPath, ...extra] = process.argv.slice(2);
  if ((mode !== '--preview' && mode !== '--apply') || !workbookPath || !preparedPath || extra.length) {
    throw new Error('ใช้ color-chart:seed --preview หรือ --apply ตามด้วย <workbook> <prepared-json>');
  }
  const base = process.env.INIT_CWD ?? process.cwd();
  const workbook = resolve(base, workbookPath);
  const prepared = resolve(base, preparedPath);
  if (mode === '--preview') {
    const { sourceSha256, sheet, items } = await readColorChartSeed(workbook, prepared);
    console.log(JSON.stringify({
      sourceSha256, sheet,
      items: items.map(({ display_order, name, note }) => ({ display_order, name, note })),
    }, null, 2));
  } else {
    const { default: pg } = await import('pg');
    const { databaseUrl } = await import('../config.js');
    const pool = new pg.Pool({ connectionString: databaseUrl() });
    try {
      console.log(JSON.stringify(await applyColorChartSeed(pool, workbook, prepared)));
    } finally {
      await pool.end();
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'นำเข้าชาร์ตสีไม่สำเร็จ');
  process.exitCode = 1;
}
