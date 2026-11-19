import { createHash } from 'node:crypto';
import type { Pool } from 'pg';

export interface NameUpgradeRow {
  id: number; code: string;
  expected: { name: string; social_security_number: string; taxpayer_id: string };
  prefix: string; first_name: string; last_name: string;
  social_security_number: string; taxpayer_id: string;
}
export interface NameUpgradePayload {
  version: number; sourceSha256: string; markdownSha256: string; rows: NameUpgradeRow[];
}
const key = 'employee-name-parts-v1';
function clean(value: unknown, max: number, required = false): string {
  if (typeof value !== 'string') throw new Error('Name mapping requires text fields');
  const normalized = value.trim().replace(/\s+/gu, ' ');
  if (normalized.length > max || (required && !normalized)) throw new Error('Invalid mapped name length');
  return normalized;
}

/** Explicit reviewed full mapping, never a heuristic name splitter or startup data import. */
export async function upgradeEmployeeNames(pool: Pool, payload: NameUpgradePayload,
  options: { expectedDatabase: string; dryRun?: boolean }) {
  if (payload?.version !== 1 || !/^[a-f0-9]{64}$/i.test(payload.sourceSha256)
      || !/^[a-f0-9]{64}$/i.test(payload.markdownSha256) || !Array.isArray(payload.rows) || !payload.rows.length)
    throw new Error('Invalid version/source hashes/name mapping');
  const ids = new Set<number>();
  for (const row of payload.rows) {
    if (!Number.isSafeInteger(row.id) || row.id < 1 || ids.has(row.id) || typeof row.code !== 'string'
        || !row.expected || typeof row.expected.name !== 'string'
        || typeof row.expected.social_security_number !== 'string' || typeof row.expected.taxpayer_id !== 'string')
      throw new Error('Invalid/duplicate employee mapping');
    ids.add(row.id);
    clean(row.prefix, 40); clean(row.first_name, 120, true); clean(row.last_name, 120);
    for (const field of ['social_security_number', 'taxpayer_id'] as const)
      if (typeof row[field] !== 'string' || !/^([0-9]{13})?$/.test(row[field])) throw new Error('Invalid mapped identifier');
  }
  const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const target = (await client.query('SELECT current_database() AS name')).rows[0].name;
    if (!options.expectedDatabase || target !== options.expectedDatabase) throw new Error('Database target mismatch');
    await client.query('SELECT pg_advisory_xact_lock(20261109)');
    await client.query('LOCK TABLE employees IN ACCESS EXCLUSIVE MODE');
    const previous = (await client.query('SELECT details FROM data_migrations WHERE key=$1', [key])).rows[0];
    if (previous) {
      if (previous.details.payloadSha256 !== hash) throw new Error('Already upgraded with a different mapping');
      await client.query('COMMIT');
      return { status: 'skipped', employees: payload.rows.length };
    }
    const existing = (await client.query('SELECT id,code,name,social_security_number,taxpayer_id FROM employees ORDER BY id')).rows;
    if (existing.length !== payload.rows.length) throw new Error('Employee set changed; review mapping again');
    for (const row of payload.rows) {
      const old = existing.find(item => item.id === row.id);
      if (!old || old.code !== row.code || old.name !== row.expected.name
          || old.social_security_number !== row.expected.social_security_number || old.taxpayer_id !== row.expected.taxpayer_id)
        throw new Error(`Employee mapping conflict/changed at id ${row.id}`);
    }
    if (options.dryRun) {
      await client.query('ROLLBACK');
      return { status: 'preview', employees: existing.length };
    }
    await client.query(`ALTER TABLE employees ADD COLUMN prefix TEXT NOT NULL DEFAULT '',
      ADD COLUMN first_name TEXT, ADD COLUMN last_name TEXT NOT NULL DEFAULT ''`);
    for (const row of payload.rows) {
      // Blank source identifiers preserve the current value, including extra employees outside the source.
      await client.query(`UPDATE employees SET prefix=$1,first_name=$2,last_name=$3,
        social_security_number=COALESCE(NULLIF($4,''),social_security_number),
        taxpayer_id=COALESCE(NULLIF($5,''),taxpayer_id),updated_at=now() WHERE id=$6`,
      [clean(row.prefix,40), clean(row.first_name,120,true), clean(row.last_name,120), row.social_security_number, row.taxpayer_id, row.id]);
    }
    await client.query(`ALTER TABLE employees ALTER COLUMN first_name SET NOT NULL,
      ADD CONSTRAINT employee_prefix_length CHECK(length(prefix)<=40),
      ADD CONSTRAINT employee_first_name_length CHECK(btrim(first_name)<>'' AND char_length(first_name)<=120),
      ADD CONSTRAINT employee_last_name_length CHECK(length(last_name)<=120), DROP COLUMN name`);
    await client.query('INSERT INTO data_migrations(key,details) VALUES($1,$2::jsonb)', [key, JSON.stringify({
      payloadSha256: hash, sourceSha256: payload.sourceSha256, markdownSha256: payload.markdownSha256, employees: payload.rows.length,
    })]);
    await client.query('INSERT INTO audit(actor,action,target) VALUES($1,$2,$3)',
      ['data-migration', 'แยกส่วนชื่อและปรับทะเบียนพนักงานปี 2569', `${payload.rows.length} employees`]);
    await client.query('COMMIT');
    return { status: 'upgraded', employees: payload.rows.length };
  } catch (error) {
    await client.query('ROLLBACK'); throw error;
  } finally { client.release(); }
}
