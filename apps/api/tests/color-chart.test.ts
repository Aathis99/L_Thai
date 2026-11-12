import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
import { createApplication } from '../src/app.js';
import { migrate } from '../src/database.js';

dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl, 'DATABASE_URL is required for color chart API tests');

async function fixture(t: TestContext) {
  const schema = `color_chart_test_${randomUUID().replaceAll('-', '')}`;
  const control = new pg.Pool({ connectionString: databaseUrl });
  await control.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
  const { server } = createApplication(pool);
  t.after(async () => {
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    await pool.end();
    await control.query(`DROP SCHEMA ${schema} CASCADE`);
    await control.end();
  });
  await migrate(pool);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api`;

  async function call(path: string, method = 'GET', data?: unknown, cookie = '') {
    const response = await fetch(base + path, {
      method, headers: { 'Content-Type': 'application/json', cookie },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    return {
      status: response.status, body: await response.json() as any,
      cookie: response.headers.get('set-cookie')?.split(';')[0] || '',
    };
  }

  const password = 'test-password-long-enough';
  assert.equal((await call('/setup', 'POST', { username: 'admin', name: 'ผู้ดูแล', password })).status, 201);
  async function login(username: string) {
    const response = await call('/login', 'POST', { username, password });
    assert.equal(response.status, 200);
    assert.ok(response.cookie);
    return response.cookie;
  }
  return { pool, call, password, login, admin: await login('admin') };
}

test('color chart migration grants reserved admin access and catalog writes require both permissions', async t => {
  const { pool, call, password, login, admin } = await fixture(t);
  const previousPermissions = [
    'employees.read', 'employees.create', 'employees.update', 'employees.delete',
    'positions.manage', 'users.manage', 'roles.manage', 'audit.read',
    'pressing.read', 'pressing.manage', 'pressing.record', 'pressing.issue',
    'pressing.release', 'pressing.sort', 'pressing.correct',
  ];
  await pool.query('UPDATE roles SET permissions=$1 WHERE id=1', [JSON.stringify(previousPermissions)]);
  const role = await call('/roles', 'POST', { name: 'ผู้ดูชาร์ตสี', permissions: ['employees.read'] }, admin);
  assert.equal(role.status, 201);
  assert.equal((await call('/users', 'POST', {
    username: 'reader', name: 'ผู้อ่าน', role_id: role.body.id, password,
  }, admin)).status, 201);
  const reader = await login('reader');
  await migrate(pool);
  await migrate(pool);

  const adminPermissions = (await call('/me', 'GET', undefined, admin)).body.user.permissions;
  assert.deepEqual(adminPermissions.sort(), [...previousPermissions, 'color_chart.read', 'color_chart.manage'].sort());
  assert.deepEqual((await call('/me', 'GET', undefined, reader)).body.user.permissions, ['employees.read']);
  assert.equal((await call('/color-chart')).status, 401);
  assert.equal((await call('/color-chart', 'GET', undefined, reader)).status, 403);
  assert.deepEqual((await call('/color-chart', 'GET', undefined, admin)).body, { items: [] });

  const changePermissions = (permissions: string[]) => call(`/roles/${role.body.id}`, 'PUT', {
    name: 'ผู้ดูชาร์ตสี', permissions,
  }, admin);
  const entry = await call('/color-chart', 'POST', { name: 'ดินแดง' }, admin);
  assert.equal(entry.status, 201);
  assert.equal((await changePermissions(['color_chart.manage'])).status, 200);
  assert.equal((await call('/color-chart', 'POST', { name: 'แก้ไม่ได้' }, reader)).status, 403);
  assert.equal((await changePermissions(['color_chart.read'])).status, 200);
  assert.equal((await call('/color-chart', 'GET', undefined, reader)).status, 200);
  assert.equal((await call('/color-chart', 'POST', { name: 'เพิ่มไม่ได้' }, reader)).status, 403);
  assert.equal((await call(`/color-chart/${entry.body.id}`, 'PUT', { name: 'แก้ไม่ได้' }, reader)).status, 403);
  assert.equal((await call(`/color-chart/${entry.body.id}`, 'DELETE', undefined, reader)).status, 403);
});

test('color chart CRUD preserves display names and order, rejects normalized duplicates and audits changes', async t => {
  const { pool, call, admin } = await fixture(t);
  const chart = (path = '', method = 'GET', data?: unknown) => call('/color-chart' + path, method, data, admin);
  assert.equal((await chart('', 'POST', { name: ' \t ' })).status, 400);
  assert.equal((await chart('', 'POST', { name: 'invalid\u0000name' })).status, 400);
  assert.equal((await chart('', 'POST', { name: 'valid', note: 42 })).status, 400);
  const first = await chart('', 'POST', { name: '  ดินแดง (TERRA  COTTA)  ' });
  assert.equal(first.status, 201);
  const duplicate = await chart('', 'POST', { name: 'ดินแดง (terra\t cotta)' });
  assert.equal(duplicate.status, 409);
  const second = await chart('', 'POST', { name: 'ศิลาดล', note: '  ระวังการเผา  ' });
  assert.equal(second.status, 201);
  assert.deepEqual((await chart()).body, { items: [
    { id: first.body.id, display_order: 1, name: 'ดินแดง (TERRA  COTTA)', note: null, has_image: false },
    { id: second.body.id, display_order: 2, name: 'ศิลาดล', note: 'ระวังการเผา', has_image: false },
  ] });

  assert.equal((await chart(`/${first.body.id}`, 'PUT', { name: 'ศิลาดล' })).status, 409);
  const updated = await chart(`/${first.body.id}`, 'PUT', { name: 'ดินแดง (terra cotta)', note: 'เตือน' });
  assert.equal(updated.status, 200);
  assert.deepEqual(updated.body, { id: first.body.id });
  const deleted = await chart(`/${second.body.id}`, 'DELETE');
  assert.equal(deleted.status, 200);
  assert.deepEqual(deleted.body, { id: second.body.id });
  assert.equal((await chart(`/${second.body.id}`, 'DELETE')).status, 404);
  assert.equal((await chart(`/${second.body.id}`, 'PUT', { name: 'แก้ไม่ได้' })).status, 404);
  assert.equal((await chart('/2147483648', 'DELETE')).status, 400);
  assert.deepEqual((await chart()).body, { items: [
    { id: first.body.id, display_order: 1, name: 'ดินแดง (terra cotta)', note: 'เตือน', has_image: false },
  ] });
  assert.deepEqual((await pool.query("SELECT actor,action,target FROM audit WHERE action LIKE '%ชาร์ตสี' ORDER BY id")).rows, [
    { actor: 'admin', action: 'เพิ่มรายการชาร์ตสี', target: String(first.body.id) },
    { actor: 'admin', action: 'เพิ่มรายการชาร์ตสี', target: String(second.body.id) },
    { actor: 'admin', action: 'แก้ไขรายการชาร์ตสี', target: String(first.body.id) },
    { actor: 'admin', action: 'ลบรายการชาร์ตสี', target: String(second.body.id) },
  ]);
});

test('concurrent color chart creates append with distinct display orders', async t => {
  const { call, admin } = await fixture(t);
  const responses = await Promise.all(['แดง', 'ขาว', 'จ้อ'].map(name =>
    call('/color-chart', 'POST', { name }, admin)));
  assert.deepEqual(responses.map(response => response.status), [201, 201, 201]);
  const items = (await call('/color-chart', 'GET', undefined, admin)).body.items;
  assert.deepEqual(items.map((item: { display_order: number }) => item.display_order), [1, 2, 3]);
  assert.deepEqual(items.map((item: { name: string }) => item.name).sort(), ['จ้อ', 'ขาว', 'แดง'].sort());
});
