import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import type { Pool, PoolClient } from 'pg';
import { baselineRoles, grantAdminProductionPermissions } from './database.js';

const SHEET = 'พนักงาน ปี2569';
const LOCK = 20261109;
const LEGACY_KEY = 'legacy-sqlite-v1';
const tables = {
  roles: ['id', 'name', 'permissions'],
  positions: ['id', 'name'],
  employees: ['id', 'code', 'name', 'department', 'position_id', 'phone', 'active', 'archived', 'created_at', 'updated_at'],
  users: ['id', 'username', 'name', 'password_hash', 'role_id', 'employee_id', 'active', 'deleted'],
  audit: ['id', 'actor', 'action', 'target', 'created_at'],
} as const;
type Table = keyof typeof tables;

export interface EmployeeImportPayload {
  sourceSha256: string;
  sheet: typeof SHEET;
  employees: { serial: number; code: string; name: string; phone: string }[];
}
export interface EmployeeImportResult { status: 'imported' | 'skipped'; employees: number }
export interface LegacyMigrationResult {
  status: 'migrated' | 'skipped';
  counts: Record<string, number>;
  backupPath?: string;
}

async function begin(client: PoolClient) {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock($1)', [LOCK]);
  await client.query(`CREATE TABLE IF NOT EXISTS data_migrations (
    key TEXT PRIMARY KEY, details JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
}

function validateEmployees(payload: EmployeeImportPayload) {
  if (!payload || typeof payload.sourceSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(payload.sourceSha256)) {
    throw new Error('Employee import requires a valid source SHA256');
  }
  if (payload.sheet !== SHEET) throw new Error(`Employee import requires the exact worksheet ${SHEET}`);
  if (!Array.isArray(payload.employees) || payload.employees.length !== 36) throw new Error('Employee import requires 36 rows');
  const serials = new Set<number>();
  const names = new Set<string>();
  for (const row of payload.employees) {
    if (!row || !Number.isInteger(row.serial) || row.serial < 1 || row.serial > 36 || serials.has(row.serial)
      || row.code !== `EMP69-${String(row.serial).padStart(3, '0')}`) {
      throw new Error('Employee import has an invalid or duplicate serial/code');
    }
    if (typeof row.name !== 'string' || !row.name.trim() || row.name !== row.name.trim() || row.name.length > 120
      || names.has(row.name.toLocaleLowerCase('th'))) throw new Error('Employee import has an invalid or duplicate name');
    if (typeof row.phone !== 'string' || !/^[0-9-]{11}$/.test(row.phone)) throw new Error('Employee import requires original text phone values');
    serials.add(row.serial); names.add(row.name.toLocaleLowerCase('th'));
  }
}

/** Import the minimal, validated staging payload; never create employee login accounts. */
export async function importEmployees(pool: Pool, payload: EmployeeImportPayload): Promise<EmployeeImportResult> {
  validateEmployees(payload);
  const key = `employees-2569:${payload.sourceSha256.toLowerCase()}:${SHEET}`;
  const client = await pool.connect();
  try {
    await begin(client);
    const previous = await client.query('SELECT details FROM data_migrations WHERE key=$1', [key]);
    if (previous.rowCount) {
      await client.query('COMMIT');
      return { status: 'skipped', employees: Number(previous.rows[0].details.employees) };
    }
    const conflicts = await client.query(`SELECT 1 FROM employees
      WHERE lower(code)=ANY($1::text[]) OR lower(name)=ANY($2::text[]) LIMIT 1`, [
      payload.employees.map(row => row.code.toLowerCase()), payload.employees.map(row => row.name.toLocaleLowerCase('th')),
    ]);
    if (conflicts.rowCount) throw new Error('Employee import conflict: a generated code or employee name already exists; no rows imported');
    for (const row of [...payload.employees].sort((a, b) => a.serial - b.serial)) {
      await client.query('INSERT INTO employees(code,name,phone) VALUES($1,$2,$3)', [row.code, row.name, row.phone]);
    }
    await client.query('INSERT INTO data_migrations(key,details) VALUES($1,$2::jsonb)', [key, JSON.stringify({
      sourceSha256: payload.sourceSha256.toLowerCase(), sheet: SHEET, employees: payload.employees.length,
    })]);
    await client.query('COMMIT');
    return { status: 'imported', employees: payload.employees.length };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

async function requireUninitialized(client: PoolClient) {
  for (const table of ['employees', 'positions', 'users', 'sessions', 'audit', 'data_migrations', 'pressing_types', 'pressing_orders', 'color_chart_entries']) {
    if ((await client.query(`SELECT 1 FROM ${table} LIMIT 1`)).rowCount) {
      throw new Error('Legacy migration requires an uninitialized destination (empty apart from seeded roles)');
    }
  }
  const existingRoles = (await client.query('SELECT id,name,permissions FROM roles ORDER BY id')).rows;
  if (existingRoles.some(role => {
    const baseline = baselineRoles.find(row => row.id === role.id);
    if (!baseline || role.name !== baseline.name) return true;
    try {
      const permissions: unknown = JSON.parse(role.permissions);
      return !Array.isArray(permissions) || JSON.stringify([...permissions].sort()) !== JSON.stringify([...baseline.permissions].sort());
    } catch { return true; }
  })) throw new Error('Legacy migration requires an uninitialized destination with unchanged seeded roles');
}

function sqliteValue(column: string, value: unknown) {
  // SQLite datetime('now') is UTC even though its text has no timezone suffix.
  if ((column === 'created_at' || column === 'updated_at') && typeof value === 'string') {
    return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(value) ? `${value.replace(' ', 'T')}Z` : value;
  }
  return value;
}

/** Snapshot with SQLite's online backup API so WAL data is included before reading records. */
export async function migrateLegacy(pool: Pool, sqlitePath: string, backupDirectory: string): Promise<LegacyMigrationResult> {
  const client = await pool.connect();
  let snapshot: DatabaseSync | undefined;
  try {
    await begin(client);
    const previous = await client.query('SELECT details FROM data_migrations WHERE key=$1', [LEGACY_KEY]);
    if (previous.rowCount) {
      await client.query('COMMIT');
      return { status: 'skipped', counts: previous.rows[0].details.counts, backupPath: previous.rows[0].details.backupPath };
    }
    await requireUninitialized(client);
    await mkdir(backupDirectory, { recursive: true });
    const backupPath = join(backupDirectory, `factory-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}.sqlite`);
    const source = new DatabaseSync(sqlitePath, { readOnly: true });
    try { await backup(source, backupPath); } finally { source.close(); }
    snapshot = new DatabaseSync(backupPath, { readOnly: true });
    const sourceTables = snapshot.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(row => String(row.name));
    const knownTables = [...Object.keys(tables), 'sessions'];
    if (sourceTables.some(table => !knownTables.includes(table)) || knownTables.some(table => !sourceTables.includes(table))) {
      throw new Error('Legacy source schema is unsupported; migration would omit or lose tables');
    }
    const counts: Record<string, number> = {};
    await client.query('DELETE FROM roles');
    for (const table of Object.keys(tables) as Table[]) {
      const columns = tables[table];
      const actualColumns = snapshot.prepare(`PRAGMA table_info(${table})`).all().map(row => String(row.name));
      if (actualColumns.length !== columns.length || actualColumns.some(column => !(columns as readonly string[]).includes(column))) {
        throw new Error(`Legacy source schema is unsupported for table ${table}`);
      }
      const rows = snapshot.prepare(`SELECT ${columns.join(',')} FROM ${table} ORDER BY id`).all();
      for (const row of rows) {
        await client.query(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map((_, index) => `$${index + 1}`).join(',')})`,
          columns.map(column => sqliteValue(column, row[column])));
      }
      counts[table] = rows.length;
    }
    await grantAdminProductionPermissions(client);
    // ALTER SEQUENCE RESTART rolls back with the transaction; setval does not.
    for (const table of Object.keys(tables)) {
      const sequence = (await client.query(`SELECT pg_get_serial_sequence('${table}','id') AS name, COALESCE(MAX(id),0)+1 AS next FROM ${table}`)).rows[0];
      await client.query(`ALTER SEQUENCE ${sequence.name} RESTART WITH ${Number(sequence.next)}`);
    }
    const sourceSha256 = createHash('sha256').update(await readFile(backupPath)).digest('hex');
    await client.query('INSERT INTO data_migrations(key,details) VALUES($1,$2::jsonb)', [LEGACY_KEY, JSON.stringify({ counts, sourceSha256, backupPath })]);
    await client.query('COMMIT');
    return { status: 'migrated', counts, backupPath };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { snapshot?.close(); client.release(); }
}
