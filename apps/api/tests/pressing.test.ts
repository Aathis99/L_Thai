import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
import { createApplication } from '../src/app.js';
import { migrate } from '../src/database.js';

dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl, 'DATABASE_URL is required for pressing API tests');

const oldAdminPermissions = [
  'employees.read', 'employees.create', 'employees.update', 'employees.delete',
  'positions.manage', 'users.manage', 'roles.manage', 'audit.read',
];
const tile = {
  width: 1, length: 1.5, clay: 'แดง', name: 'ทดสอบ', pieces_per_rack: 750,
  rest_days: 4, destination: 'color', pieces_per_sqm: 50,
};

test('pressing catalog, orders and worker selection use session permissions', async t => {
  const schema = `pressing_test_${randomUUID().replaceAll('-', '')}`;
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
  // Give the seeded administrator exactly the permission list from a pre-pressing installation.
  await pool.query('UPDATE roles SET permissions=$1 WHERE id=1', [JSON.stringify(oldAdminPermissions)]);
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
  const admin = (await call('/login', 'POST', { username: 'admin', password })).cookie;
  assert.ok(admin);
  const worker = await call('/employees', 'POST', {
    code: 'EMP-1', name: 'คนปั๊ม', phone: '081-2345678',
  }, admin);
  assert.equal(worker.status, 201);
  assert.equal((await call('/employees', 'POST', { code: 'EMP-2', name: 'พักงาน', active: false }, admin)).status, 201);
  const archived = await call('/employees', 'POST', { code: 'EMP-3', name: 'ออกแล้ว' }, admin);
  assert.equal(archived.status, 201);
  assert.equal((await call('/employees/' + archived.body.id, 'DELETE', undefined, admin)).status, 200);
  const role = await call('/roles', 'POST', { name: 'อ่านอย่างเดียว', permissions: ['employees.read'] }, admin);
  assert.equal(role.status, 201);
  assert.equal((await call('/users', 'POST', {
    username: 'reader', name: 'ผู้อ่าน', role_id: role.body.id, password,
  }, admin)).status, 201);
  const reader = (await call('/login', 'POST', { username: 'reader', password })).cookie;
  assert.ok(reader);
  await migrate(pool);

  const press = (path: string, method = 'GET', data?: unknown, cookie = admin) =>
    call('/pressing' + path, method, data, cookie);

  await t.test('migration grants role 1 access and leaves other roles unchanged', async () => {
    const adminStatus = (await press('/types', 'POST', tile)).status;
    assert.equal(adminStatus, 201);
    const readerStatus = (await press('/types', 'POST', tile, reader)).status;
    assert.equal(readerStatus, 403);
    const roles = (await call('/roles', 'GET', undefined, admin)).body.items;
    assert.deepEqual(roles.find((row: { id: number }) => row.id === role.body.id).permissions, ['employees.read']);
    assert.deepEqual(roles.find((row: { id: number }) => row.id === 1).permissions.sort(), [
      ...oldAdminPermissions, 'pressing.read', 'pressing.manage', 'pressing.record',
      'pressing.issue', 'pressing.release', 'pressing.sort', 'pressing.correct',
    ].sort());
  });

  await t.test('writes require both read and manage; worker selection exposes only eligible workers', async () => {
    assert.equal((await press('/workers', 'GET', undefined, '')).status, 401);
    assert.equal((await press('/workers', 'GET', undefined, reader)).status, 403);
    assert.equal((await call('/roles/' + role.body.id, 'PUT', {
      name: 'จัดการอย่างเดียว', permissions: ['pressing.manage'],
    }, admin)).status, 200);
    assert.equal((await press('/types', 'POST', tile, reader)).status, 403);
    assert.equal((await call('/roles/' + role.body.id, 'PUT', {
      name: 'อ่านงานปั๊ม', permissions: ['pressing.read'],
    }, admin)).status, 200);
    assert.equal((await press('/types', 'POST', tile, reader)).status, 403);
    const workers = await press('/workers', 'GET', undefined, reader);
    assert.equal(workers.status, 200);
    assert.deepEqual(workers.body.items, [{ id: worker.body.id, code: 'EMP-1', name: 'คนปั๊ม' }]);
  });

  await t.test('catalog validates type values and deletes an unused type', async () => {
    for (const invalid of [
      { width: 0 }, { length: '1' }, { clay: 'red' }, { pieces_per_rack: 1.2 },
      { rest_days: -1 }, { destination: 'paint' }, { pieces_per_sqm: 0 },
    ]) {
      assert.equal((await press('/types', 'POST', { ...tile, ...invalid })).status, 400);
    }
    const unused = await press('/types', 'POST', { ...tile, clay: 'สี', clay_color: 'ทดสอบ', destination: 'kiln' });
    assert.equal(unused.status, 201);
    const unusedPath = '/types/' + unused.body.id;
    const saved = await press(unusedPath, 'PUT', { ...tile, clay: 'จ้อ', rest_days: 0 });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body, { id: unused.body.id });
    const updated = (await press('/types')).body.items.find((row: { id: number }) => row.id === unused.body.id);
    assert.equal(updated.clay, 'จ้อ');
    assert.equal(updated.rest_days, 0);
    assert.equal((await press(unusedPath, 'DELETE')).status, 200);
    assert.ok((await press('/types')).body.items.every((row: { id: number }) => row.id !== unused.body.id));
  });

  await t.test('orders keep their original type and purpose after a target change and type retirement', async () => {
    const type = await press('/types', 'POST', { ...tile, clay: 'ขาว' });
    assert.equal(type.status, 201);
    const order = { type_id: type.body.id, target_pieces: 1000, purpose: 'customer', customer_reference: 'SALE-01' };
    assert.equal((await press('/orders', 'POST', { ...order, customer_reference: ' ' })).status, 400);
    assert.equal((await press('/orders', 'POST', { ...order, target_pieces: 0 })).status, 400);
    assert.equal((await press('/orders', 'POST', { ...order, type_id: 2147483647 })).status, 400);
    const created = await press('/orders', 'POST', order);
    assert.equal(created.status, 201);
    const orderPath = '/orders/' + created.body.id;
    assert.equal((await press(orderPath, 'PUT', { target_pieces: 2000, purpose: 'stock' })).status, 409);
    const saved = await press(orderPath, 'PUT', { target_pieces: 1200 });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body, { id: created.body.id });
    const stock = await press('/orders', 'POST', { type_id: type.body.id, target_pieces: 200, purpose: 'stock' });
    assert.equal(stock.status, 201);
    assert.equal((await press('/types/' + type.body.id, 'DELETE')).status, 200);
    assert.equal((await press('/orders', 'POST', order)).status, 409);
    const findOrder = async () => (await press('/orders')).body.items.find((row: { id: number }) => row.id === created.body.id);
    const historical = await findOrder();
    assert.deepEqual(historical, { ...order, id: created.body.id, target_pieces: 1200 });
    const types = await press('/types');
    assert.equal(types.body.items.find((row: { id: number }) => row.id === type.body.id).active, false);
    const audit = (await call('/audit', 'GET', undefined, admin)).body.items;
    assert.ok(audit.some((row: { actor: string; target: string; action: string }) =>
      row.actor === 'admin' && row.target === String(created.body.id)
      && row.action.includes('1000') && row.action.includes('1200')));
    await migrate(pool);
    assert.deepEqual(await findOrder(), historical);
    assert.deepEqual((await press('/types')).body, types.body);
  });
});
