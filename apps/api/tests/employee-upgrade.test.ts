import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

test('guarded name upgrade preserves ids, refuses wrong targets/conflicts and is idempotent', async t => {
  let upgrade: any;
  try { ({ upgradeEmployeeNames: upgrade } = await import('../src/employee-upgrade.js')); } catch {}
  assert.equal(typeof upgrade, 'function', 'explicit guarded upgrade must exist');
  const qaDatabase = new URL(process.env.DATABASE_URL!).pathname.slice(1);
  assert.match(qaDatabase, /^lthai_.*_qa$/, 'tests require QA database');
  const schema = `upgrade_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}` });
  t.after(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });
  await pool.query(`CREATE TABLE employees(id SERIAL PRIMARY KEY,code TEXT,name TEXT NOT NULL,
    social_security_number TEXT NOT NULL DEFAULT '',taxpayer_id TEXT NOT NULL DEFAULT '',updated_at TIMESTAMPTZ DEFAULT now());
    CREATE TABLE audit(actor TEXT,action TEXT,target TEXT);
    CREATE TABLE data_migrations(key TEXT PRIMARY KEY,details JSONB NOT NULL);
    INSERT INTO employees(code,name) VALUES('x','นายOld Multi Word Family'),('y','Extra Person');
    UPDATE employees SET social_security_number='1234567890123',taxpayer_id='1234567890123' WHERE id=2;`);
  const payload = { version: 1, sourceSha256: 'a'.repeat(64), markdownSha256: 'b'.repeat(64), rows: [
    { id: 1, code: 'x', expected: { name: 'นายOld Multi Word Family', social_security_number: '', taxpayer_id: '' },
      prefix: 'นาย', first_name: 'Old Multi Word', last_name: 'Family', social_security_number: '0123456789012', taxpayer_id: '0123456789012' },
    { id: 2, code: 'y', expected: { name: 'Extra Person', social_security_number: '1234567890123', taxpayer_id: '1234567890123' },
      prefix: '', first_name: 'Extra', last_name: 'Person', social_security_number: '', taxpayer_id: '' },
  ] };
  const options = { expectedDatabase: qaDatabase };
  await assert.rejects(upgrade(pool, payload, { expectedDatabase: 'wrong' }), /target|database/i);
  const conflict = structuredClone(payload); conflict.rows[1].expected.name = 'Changed';
  await assert.rejects(upgrade(pool, conflict, options), /changed|conflict/i);
  assert.equal((await pool.query('SELECT name FROM employees WHERE id=1')).rows[0].name, 'นายOld Multi Word Family');
  assert.equal((await upgrade(pool, payload, { ...options, dryRun: true })).status, 'preview');
  assert.equal((await pool.query('SELECT name FROM employees')).rowCount, 2);
  assert.equal((await upgrade(pool, payload, options)).status, 'upgraded');
  assert.deepEqual((await pool.query('SELECT id,prefix,first_name,last_name FROM employees ORDER BY id')).rows,
    [{ id: 1, prefix: 'นาย', first_name: 'Old Multi Word', last_name: 'Family' }, { id: 2, prefix: '', first_name: 'Extra', last_name: 'Person' }]);
  assert.equal((await pool.query('SELECT social_security_number FROM employees WHERE id=1')).rows[0].social_security_number, '0123456789012');
  assert.deepEqual((await pool.query('SELECT social_security_number,taxpayer_id FROM employees WHERE id=2')).rows[0],
    { social_security_number: '1234567890123', taxpayer_id: '1234567890123' });
  await assert.rejects(pool.query('SELECT name FROM employees'), /does not exist/);
  assert.equal((await upgrade(pool, payload, options)).status, 'skipped');
  const different = structuredClone(payload); different.rows[0].first_name = 'Different';
  await assert.rejects(upgrade(pool, different, options), /different|changed|already/i);
});
