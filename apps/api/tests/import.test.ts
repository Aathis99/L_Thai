import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
import { migrate } from '../src/database.js';
import { importEmployees, migrateLegacy, type EmployeeImportPayload } from '../src/import.js';

dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl, 'DATABASE_URL is required for real PostgreSQL import tests');
async function fixture(t: TestContext) {
  const schema = `import_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
  const directory = await mkdtemp(join(tmpdir(), 'lthai-import-'));
  t.after(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
    await rm(directory, { recursive: true, force: true });
  });
  await migrate(pool);
  return { pool, directory };
}

function payload(hash = 'a'.repeat(64)): EmployeeImportPayload {
  return {
    sourceSha256: hash, sheet: 'พนักงาน ปี2569',
    employees: Array.from({ length: 36 }, (_, index) => ({
      serial: index + 1, code: `EMP69-${String(index + 1).padStart(3, '0')}`,
      name: `Synthetic Person ${index + 1}`, phone: '081-2345678',
    })),
  };
}

test('employee import is atomic and idempotent, preserves phone text and later edits, creates no users', async t => {
  const { pool } = await fixture(t);
  const concurrent = await Promise.all([importEmployees(pool, payload()), importEmployees(pool, payload())]);
  assert.deepEqual(concurrent.map(result => result.status).sort(), ['imported', 'skipped']);
  assert.ok(concurrent.every(result => result.employees === 36));
  const first = (await pool.query("SELECT * FROM employees WHERE code='EMP69-001'")).rows[0];
  assert.equal(first.phone, '081-2345678');
  assert.equal(first.department, '');
  assert.equal(first.position_id, null);
  assert.equal((await pool.query('SELECT * FROM users')).rowCount, 0);
  await pool.query("UPDATE employees SET name='Edited after import' WHERE id=$1", [first.id]);
  assert.deepEqual(await importEmployees(pool, payload()), { status: 'skipped', employees: 36 });
  assert.equal((await pool.query('SELECT name FROM employees WHERE id=$1', [first.id])).rows[0].name, 'Edited after import');
  await assert.rejects(importEmployees(pool, payload('b'.repeat(64))), /conflict/i);
  assert.equal((await pool.query('SELECT * FROM employees')).rowCount, 36);
});

test('employee import rejects malformed, conflicting codes/names without partial writes', async t => {
  const { pool } = await fixture(t);
  const invalid = payload(); invalid.employees[35].serial = 35;
  await assert.rejects(importEmployees(pool, invalid), /serial|code/i);
  assert.equal((await pool.query('SELECT * FROM employees')).rowCount, 0);
  await pool.query("INSERT INTO employees(code,name) VALUES('other-code','Synthetic Person 36')");
  await assert.rejects(importEmployees(pool, payload()), /conflict/i);
  assert.equal((await pool.query('SELECT * FROM employees')).rowCount, 1);
  assert.equal((await pool.query('SELECT * FROM data_migrations')).rowCount, 0);
});

async function legacyFixture(path: string) {
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE roles(id INTEGER PRIMARY KEY,name TEXT,permissions TEXT);
    CREATE TABLE positions(id INTEGER PRIMARY KEY,name TEXT);
    CREATE TABLE employees(id INTEGER PRIMARY KEY,code TEXT,name TEXT,department TEXT,position_id INTEGER,phone TEXT,active INTEGER,archived INTEGER,created_at TEXT,updated_at TEXT);
    CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT,name TEXT,password_hash TEXT,role_id INTEGER,employee_id INTEGER,active INTEGER,deleted INTEGER);
    CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER,expires INTEGER);
    CREATE TABLE audit(id INTEGER PRIMARY KEY,actor TEXT,action TEXT,target TEXT,created_at TEXT);
    INSERT INTO roles VALUES(7,'Synthetic custom role','["employees.read"]');
    INSERT INTO positions VALUES(8,'Synthetic position');
    INSERT INTO employees VALUES(19,'LEG-019','Synthetic archived person','',8,'081-2345678',0,1,'2025-01-02 03:04:05','2025-02-03 04:05:06');
    INSERT INTO users VALUES(29,'synthetic','Synthetic account','synthetic-password-hash',7,19,0,1);
    INSERT INTO sessions VALUES('old-token',29,9999999999999);
    INSERT INTO audit VALUES(39,'synthetic','archive','19','2025-02-03 04:05:06');`);
  db.close();
}

test('legacy snapshot includes uncheckpointed WAL, preserves data and resets sequences while invalidating sessions', async t => {
  const { pool, directory } = await fixture(t);
  const path = join(directory, 'source.sqlite'); await legacyFixture(path);
  const writer = new DatabaseSync(path);
  writer.exec("PRAGMA journal_mode=WAL; INSERT INTO audit VALUES(40,'synthetic','wal-event','19','2025-02-03 04:05:07')");
  const result = await (async () => {
    try { return await migrateLegacy(pool, path, join(directory, 'backups')); }
    finally { writer.close(); }
  })();
  assert.equal(result.status, 'migrated');
  assert.deepEqual(result.counts, { roles: 1, positions: 1, employees: 1, users: 1, audit: 2 });
  const employee = (await pool.query('SELECT * FROM employees')).rows[0];
  assert.equal(employee.id, 19); assert.equal(employee.archived, 1); assert.equal(employee.active, 0);
  assert.equal(employee.created_at.toISOString(), '2025-01-02T03:04:05.000Z');
  assert.equal((await pool.query('SELECT * FROM users')).rows[0].password_hash, 'synthetic-password-hash');
  assert.equal((await pool.query('SELECT * FROM sessions')).rowCount, 0);
  assert.deepEqual((await pool.query('SELECT id FROM audit ORDER BY id')).rows.map(row => row.id), [39, 40]);
  assert.equal((await pool.query("INSERT INTO employees(code,name) VALUES('new','New Person') RETURNING id")).rows[0].id, 20);
  const snapshot = new DatabaseSync(result.backupPath!, { readOnly: true });
  assert.equal(snapshot.prepare('SELECT COUNT(*) AS count FROM sessions').get()!.count, 1); snapshot.close();
  assert.equal((await migrateLegacy(pool, path, join(directory, 'backups'))).status, 'skipped');
});

test('legacy migration rejects nonempty destination and rolls back every table when source data is invalid', async t => {
  const { pool, directory } = await fixture(t);
  const path = join(directory, 'source.sqlite'); await legacyFixture(path);
  await pool.query("INSERT INTO positions(name) VALUES('Existing')");
  await assert.rejects(migrateLegacy(pool, path, join(directory, 'backups')), /uninitialized|empty/i);
  await pool.query('DELETE FROM positions');
  const db = new DatabaseSync(path); db.exec('UPDATE users SET role_id=999'); db.close();
  await assert.rejects(migrateLegacy(pool, path, join(directory, 'backups')));
  assert.equal((await pool.query('SELECT * FROM employees')).rowCount, 0);
  assert.equal((await pool.query('SELECT * FROM roles')).rowCount, 3);
  assert.equal((await pool.query('SELECT * FROM data_migrations')).rowCount, 0);
});
