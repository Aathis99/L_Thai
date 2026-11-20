import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
import { transaction } from '../database.js';
import { importProducts, parseProductsMarkdown } from './import.js';

const [file, sourceIdentity, ...extra] = process.argv.slice(2);
if (!file || !sourceIdentity || extra.length) {
  console.error('Usage: tile-catalog import <markdown-file> <source-identity>');
  process.exitCode = 1;
} else if (!process.env.DATABASE_URL?.trim()) {
  console.error('DATABASE_URL is required for the separate QA database');
  process.exitCode = 1;
} else {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const rows = parseProductsMarkdown(await readFile(resolve(process.env.INIT_CWD ?? process.cwd(), file), 'utf8'));
    const result = await transaction(pool, async db => {
      const target = (await db.query('SELECT pg_catalog.current_database() AS database_name')).rows[0];
      if (!/^lthai_.*_qa$/.test(target.database_name))
        throw new Error('Tile product import requires a separate QA database');
      return importProducts(db, rows, sourceIdentity);
    });
    console.log(JSON.stringify(result));
  } catch {
    console.error('Tile product import failed; no changes committed. Verify the QA target, source identity, and input.');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
