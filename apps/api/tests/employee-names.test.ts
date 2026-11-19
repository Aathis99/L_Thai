import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import pg from 'pg';
import { createApplication } from '../src/app.js';
import { migrate } from '../src/database.js';
import { formatEmployeeName } from '../src/employee-names.js';

test('employee name formatting joins nonempty canonical parts with one space', () => {
  assert.equal(formatEmployeeName({ prefix: 'Dr.', first_name: 'Mary Jane', last_name: 'van der Meer' }), 'Dr. Mary Jane van der Meer');
  assert.equal(formatEmployeeName({ prefix: '', first_name: 'Solo', last_name: '' }), 'Solo');
});

async function fixture(t: TestContext) {
  const control = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const target = (await control.query('SELECT current_database() AS name')).rows[0];
  assert.match(target.name, /^lthai_.*_qa$/, 'employee-name tests require a separate verified QA database');
  const schema = 'employee_names_test_' + randomUUID().replaceAll('-', '');
  await control.query('CREATE SCHEMA ' + schema);
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: '-c search_path=' + schema });
  t.after(async () => {
    await pool.end();
    await control.query('DROP SCHEMA ' + schema + ' CASCADE');
    await control.end();
  });
  return pool;
}

test('startup refuses the legacy employee name schema without modifying it', async t => {
  const pool = await fixture(t);
  await pool.query("CREATE TABLE employees(id integer PRIMARY KEY,code text,name text); INSERT INTO employees VALUES(7,'OLD','Original Name')");
  await assert.rejects(migrate(pool), /employees\.name.*(?:upgrade|mapping)/i);
  assert.deepEqual((await pool.query('SELECT * FROM employees')).rows, [{ id: 7, code: 'OLD', name: 'Original Name' }]);
  assert.equal((await pool.query("SELECT to_regclass('roles') AS table_name")).rows[0].table_name, null);
});

test('new schema stores only bounded employee name parts and supports repeated startup', async t => {
  const pool = await fixture(t);
  await migrate(pool);
  await migrate(pool);
  const columns = (await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='employees'")).rows.map(row => row.column_name);
  assert.ok(!columns.includes('name'));
  for (const part of ['prefix', 'first_name', 'last_name']) assert.ok(columns.includes(part));
  await pool.query("INSERT INTO employees(code,first_name) VALUES('SINGLE','Solo')");
  assert.deepEqual((await pool.query('SELECT prefix,first_name,last_name FROM employees')).rows, [{ prefix: '', first_name: 'Solo', last_name: '' }]);
  for (const values of [['', '', ''], ['', ' ', ''], ['x'.repeat(41), 'Valid', ''], ['', 'x'.repeat(121), ''], ['', 'Valid', 'x'.repeat(121)]]) {
    await assert.rejects(pool.query('INSERT INTO employees(code,prefix,first_name,last_name) VALUES($1,$2,$3,$4)', [randomUUID(), ...values]));
  }
});

test('employee CRUD normalizes separate names, preserves omitted optional values and rejects legacy writes', async t => {
  const pool = await fixture(t);
  await migrate(pool);
  const { server } = createApplication(pool);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise<void>(resolve => { server.close(() => resolve()); server.closeIdleConnections(); }); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api`;
  let cookie = '';
  async function call(path: string, method = 'GET', data?: unknown) {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', cookie }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: response.status, body: await response.json() as any, cookie: response.headers.get('set-cookie')?.split(';')[0] || '' };
  }
  const password = 'employee-name-test';
  await call('/setup', 'POST', { username: 'admin', name: 'Account Name', password });
  cookie = (await call('/login', 'POST', { username: 'admin', password })).cookie;
  const created = await call('/employees', 'POST', { code: 'PARTS', prefix: '  Dr.  ', first_name: '  Mary   Jane\tAnne ', last_name: ' van  der\nMeer ', social_security_number: '0000000000001', taxpayer_id: '0000000000002' });
  assert.equal(created.status, 201);
  const id = created.body.id;
  let row = (await call('/employees')).body.items[0];
  assert.equal(Object.hasOwn(row, 'name'), false);
  assert.deepEqual([row.prefix, row.first_name, row.last_name], ['Dr.', 'Mary Jane Anne', 'van der Meer']);
  assert.equal((await call('/employees/' + id, 'PUT', { code: 'PARTS', first_name: '  Jane   Mary ', active: true })).status, 200);
  row = (await call('/employees')).body.items[0];
  assert.deepEqual([row.prefix, row.first_name, row.last_name, row.social_security_number, row.taxpayer_id], ['Dr.', 'Jane Mary', 'van der Meer', '0000000000001', '0000000000002']);
  assert.equal((await call('/employees/' + id, 'PUT', { code: 'PARTS', first_name: 'Solo', prefix: '', last_name: '' })).status, 200);
  row = (await call('/employees')).body.items[0];
  assert.deepEqual([row.prefix, row.first_name, row.last_name], ['', 'Solo', '']);
  assert.equal((await call('/me')).body.user.name, 'Account Name');
  for (const invalid of [{}, { first_name: '' }, { first_name: ' \t ' }, { first_name: null }, { first_name: 'x'.repeat(121) }, { first_name: 'Valid', prefix: 'x'.repeat(41) }, { first_name: 'Valid', last_name: 'x'.repeat(121) }]) {
    assert.equal((await call('/employees', 'POST', { code: 'INVALID', ...invalid })).status, 400);
  }
  for (const [path, method] of [['/employees', 'POST'], ['/employees/' + id, 'PUT']]) {
    const legacy = await call(path, method, { code: 'LEGACY', name: 'Do Not Split' });
    assert.equal(legacy.status, 400);
    assert.match(legacy.body.error, /first_name/);
  }
  const maximum = await call('/employees', 'POST', { code: 'MAX', prefix: 'x'.repeat(40), first_name: 'x'.repeat(120), last_name: 'x'.repeat(120) });
  assert.equal(maximum.status, 201);
  assert.equal((await call('/employees', 'POST', { code: 'DUPLICATE-NAME', first_name: 'Solo' })).status, 201);
});
