import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
import { createApplication } from '../src/app.js';
import { all, migrate, one, transaction } from '../src/database.js';
import { recordIssue, releaseSurplus } from '../src/pressing/stock.js';

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
      'color_chart.read', 'color_chart.manage',
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
      { name: 'ชื่อ\u0000' }, { clay_color: 'สี\u0000' },
      { name: 'ชื่อ\uD800' }, { clay_color: 'สี\uDFFF' },
    ]) {
      assert.equal((await press('/types', 'POST', { ...tile, ...invalid })).status, 400);
    }
    const unused = await press('/types', 'POST', { ...tile, clay: 'สี', clay_color: 'ทดสอบ🧱', destination: 'kiln' });
    assert.equal(unused.status, 201);
    const unusedPath = '/types/' + unused.body.id;
    const created = (await press('/types')).body.items.find((row: { id: number }) => row.id === unused.body.id);
    assert.equal(created.clay_color, 'ทดสอบ🧱');
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
    assert.equal((await press('/orders', 'POST', { ...order, customer_reference: 'SALE\u000001' })).status, 400);
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
    assert.deepEqual(historical, {
      ...order, id: created.body.id, target_pieces: 1200,
      pressed_pieces: 0, short_pieces: 1200, over_pieces: 0,
    });
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

  async function makeOrder(purpose: 'stock' | 'customer', target_pieces: number) {
    const type = await press('/types', 'POST', tile);
    assert.equal(type.status, 201);
    const order = await press('/orders', 'POST', {
      type_id: type.body.id, purpose, target_pieces,
      ...(purpose === 'customer' && { customer_reference: 'SALE-02' }),
    });
    assert.equal(order.status, 201);
    return { orderId: order.body.id, typeId: type.body.id };
  }

  const entryInput = (orderId: number, full_racks: number) => ({
    request_id: randomUUID(), order_id: orderId, pressed_on: '2099-01-29',
    employee_id: worker.body.id, full_racks,
  });

  await t.test('receipts calculate pieces and retain the recorded rate and rest days after type edits', async () => {
    const { orderId, typeId } = await makeOrder('stock', 30000);
    const fullRack = entryInput(orderId, 23);
    const recorded = await press('/entries', 'POST', { ...fullRack, pieces: 1 });
    assert.equal(recorded.status, 201);
    const loose = await press('/entries', 'POST', { ...entryInput(orderId, 2), loose_pieces: 100 });
    assert.equal(loose.status, 201);
    const resting = await press('/entries', 'POST', entryInput(orderId, 2));
    assert.equal(resting.status, 201);
    const stock = (await press('/stock')).body.items.find((row: { entry_id: number }) => row.entry_id === resting.body.id);
    assert.deepEqual(stock, {
      id: stock.id, type_id: typeId, entry_id: resting.body.id, order_id: orderId,
      pressed_on: '2099-01-29', as_of: null, ready_on: '2099-02-02',
      ready: false, destination: 'color', remaining_pieces: 1500, general_pieces: 1500, restricted_pieces: 0,
    });
    assert.equal((await press('/types/' + typeId, 'PUT', {
      ...tile, pieces_per_rack: 1000, rest_days: 0, pieces_per_sqm: 100, destination: 'kiln',
    })).status, 200);
    const replay = await press('/entries', 'POST', fullRack);
    assert.equal(replay.status, 201);
    assert.deepEqual(replay.body, recorded.body);
    assert.equal((await press('/entries', 'POST', { ...fullRack, full_racks: 22 })).status, 409);
    const entries = await press('/entries?order_id=' + orderId);
    assert.equal(entries.status, 200);
    assert.equal(entries.body.items.length, 3);
    const fullRackEntry = entries.body.items.find((row: { id: number }) => row.id === recorded.body.id);
    const looseEntry = entries.body.items.find((row: { id: number }) => row.id === loose.body.id);
    assert.equal(fullRackEntry.pieces, 17250);
    assert.equal(looseEntry.pieces, 1600);
    assert.deepEqual(fullRackEntry, {
      id: recorded.body.id, order_id: orderId, pressed_on: '2099-01-29', full_racks: 23,
      loose_pieces: 0, note: null, pieces: 17250, original_pieces: 17250, pieces_per_rack: 750, rest_days: 4,
      ready_on: '2099-02-02', square_meters: 345, employee_id: worker.body.id,
      employee_name: 'คนปั๊ม', recorded_by: 1, recorded_by_username: 'admin',
      recorded_at: fullRackEntry.recorded_at,
    });
    assert.ok(Number.isFinite(Date.parse(fullRackEntry.recorded_at)));
    assert.equal(looseEntry.square_meters, 32);
    assert.deepEqual((await press('/stock')).body.items.filter((row: { entry_id: number }) =>
      row.entry_id === resting.body.id), [stock]);
    assert.equal((await press('/types/' + typeId, 'DELETE')).status, 200);
    assert.equal((await press('/entries', 'POST', entryInput(orderId, 1))).status, 409);
    assert.deepEqual((await press('/entries', 'POST', fullRack)).body, recorded.body);
    await migrate(pool);
    assert.deepEqual((await press('/entries?order_id=' + orderId)).body, entries.body);
    const audit = (await call('/audit', 'GET', undefined, admin)).body.items;
    assert.equal(audit.filter((row: { actor: string; target: string; action: string }) =>
      row.actor === 'admin' && row.target === String(recorded.body.id) && row.action === 'บันทึกยอดปั๊ม').length, 1);
  });

  await t.test('two workers contribute to the same order and customer pieces stay allocated to it', async () => {
    const { orderId } = await makeOrder('customer', 5000);
    const secondWorker = await call('/employees', 'POST', { code: 'EMP-4', name: 'ผู้ปั๊มคนที่สอง' }, admin);
    assert.equal(secondWorker.status, 201);
    const first = { ...entryInput(orderId, 4), pressed_on: '2024-02-29' };
    const created = await Promise.all([first, first, {
      ...entryInput(orderId, 4), employee_id: secondWorker.body.id,
    }].map(input => press('/entries', 'POST', input)));
    assert.deepEqual(created.map(result => result.status), [201, 201, 201]);
    assert.deepEqual(created[0].body, created[1].body);
    const entries = (await press('/entries?order_id=' + orderId)).body.items;
    assert.deepEqual(entries.map((row: { employee_id: number }) => row.employee_id).sort((a: number, b: number) => a - b),
      [worker.body.id, secondWorker.body.id]);
    const findOrder = async () => (await press('/orders')).body.items.find((row: { id: number }) => row.id === orderId);
    const { pressed_pieces, short_pieces, over_pieces } = await findOrder();
    assert.deepEqual({ pressed_pieces, short_pieces, over_pieces }, { pressed_pieces: 6000, short_pieces: 0, over_pieces: 1000 });
    const source = (await press('/stock')).body.items.find((row: { entry_id: number }) => row.entry_id === created[0].body.id);
    assert.equal(source.ready, true);
    assert.equal(source.ready_on, '2024-03-04');
    assert.equal(source.general_pieces, 0);
    assert.equal(source.restricted_pieces, 3000);
    assert.equal((await press('/orders/' + orderId, 'PUT', { target_pieces: 6500 })).status, 200);
    const raised = await findOrder();
    assert.equal(raised.short_pieces, 500);
    assert.equal(raised.over_pieces, 0);
  });

  await t.test('opening stock is idempotent, keeps its readiness, and does not add production', async () => {
    const { orderId, typeId } = await makeOrder('stock', 500);
    const opening = { source_key: 'verified-count', type_id: typeId, as_of: '2024-02-29', pieces: 500, ready_confirmed: false };
    const created = await press('/opening', 'POST', opening);
    assert.equal(created.status, 201);
    assert.equal((await press('/types/' + typeId, 'PUT', { ...tile, destination: 'kiln' })).status, 200);
    const replay = await press('/opening', 'POST', opening);
    assert.equal(replay.status, 201);
    assert.deepEqual(replay.body, created.body);
    assert.equal((await press('/opening', 'POST', { ...opening, pieces: 501 })).status, 409);
    const known = await press('/opening', 'POST', {
      ...opening, source_key: 'checked-count', ready_confirmed: true,
    });
    assert.equal(known.status, 201);
    const future = await press('/opening', 'POST', {
      ...opening, source_key: 'dated-count', ready_on: '2099-02-02', ready_confirmed: true,
    });
    assert.equal(future.status, 201);
    const sources = (await press('/stock')).body.items.filter((row: { type_id: number }) => row.type_id === typeId);
    assert.equal(sources.length, 3);
    assert.deepEqual(sources.find((row: { id: number }) => row.id === created.body.id), {
      id: created.body.id, type_id: typeId, entry_id: null, order_id: null, pressed_on: null, as_of: '2024-02-29',
      ready_on: null, ready: false, destination: 'color', remaining_pieces: 500, general_pieces: 500, restricted_pieces: 0,
    });
    assert.equal(sources.find((row: { id: number }) => row.id === known.body.id).ready, true);
    assert.equal(sources.find((row: { id: number }) => row.id === future.body.id).ready, false);
    assert.equal(sources.find((row: { id: number }) => row.id === future.body.id).ready_on, '2099-02-02');
    const order = (await press('/orders')).body.items.find((row: { id: number }) => row.id === orderId);
    assert.equal(order.pressed_pieces, 0);
    assert.equal(order.short_pieces, 500);

    const openingOnly = await press('/types', 'POST', tile);
    assert.equal(openingOnly.status, 201);
    assert.equal((await press('/opening', 'POST', {
      ...opening, source_key: 'opening-only', type_id: openingOnly.body.id,
    })).status, 201);
    assert.equal((await press('/types/' + openingOnly.body.id, 'DELETE')).status, 200);
    const retired = (await press('/types')).body.items.find((row: { id: number }) => row.id === openingOnly.body.id);
    assert.equal(retired.active, false);
    assert.equal((await press('/opening', 'POST', {
      ...opening, source_key: 'retired-type', type_id: openingOnly.body.id,
    })).status, 409);
  });

  await t.test('receipt routes reject invalid payloads and require their respective write permissions', async () => {
    const { orderId, typeId } = await makeOrder('stock', 1000);
    const entry = entryInput(orderId, 2);
    const opening = { source_key: 'validation', type_id: typeId, as_of: '2024-02-29', pieces: 500, ready_confirmed: false };
    assert.equal((await press('/entries', 'POST', entry, reader)).status, 403);
    assert.equal((await press('/opening', 'POST', opening, reader)).status, 403);
    assert.equal((await press('/entries?order_id=1.5')).status, 400);
    assert.equal((await press('/entries?order_id=1%0A')).status, 400);
    for (const invalid of [
      { pressed_on: '2025-02-29' }, { pressed_on: '2025-4-01' }, { pressed_on: '0000-01-01' },
      { full_racks: 0 }, { full_racks: 1.5 }, { full_racks: 2147483647 }, { loose_pieces: -1 },
      { order_id: 2147483647 }, { employee_id: archived.body.id }, { note: 'งาน\u0000ปั๊ม' },
      { request_id: 'id\u0000' },
    ]) assert.equal((await press('/entries', 'POST', { ...entry, ...invalid })).status, 400);
    for (const invalid of [
      { as_of: '2024-02-30' }, { ready_on: '2024-09-31' }, { pieces: 0 },
      { ready_confirmed: 'true' }, { source_key: 'bad\u0000key' }, { type_id: 2147483647 },
    ]) assert.equal((await press('/opening', 'POST', { ...opening, ...invalid })).status, 400);
    assert.equal((await call('/roles/' + role.body.id, 'PUT', {
      name: 'บันทึกยอดปั๊ม', permissions: ['pressing.read', 'pressing.record'],
    }, admin)).status, 200);
    assert.equal((await press('/entries', 'POST', { ...entry, full_racks: 0, loose_pieces: 12 }, reader)).status, 201);
    assert.equal((await press('/opening', 'POST', opening, reader)).status, 403);
    assert.equal((await press('/entries?order_id=' + orderId)).body.items[0].pieces, 12);
  });

  const findSource = async (entryId: number) => {
    const { items } = (await press('/stock')).body;
    const source = items.find((row: { entry_id: number | null }) => row.entry_id === entryId);
    assert.ok(source);
    return source;
  };

  async function receive(orderId: number, pressedOn = '2024-02-29') {
    const receipt = await press('/entries', 'POST', { ...entryInput(orderId, 2), pressed_on: pressedOn });
    assert.equal(receipt.status, 201);
    return findSource(receipt.body.id);
  }

  const issueLine = (source_id: number, pieces: number, allocation: 'general' | 'order' = 'general') =>
    ({ source_id, pieces, allocation });
  const issueInput = (type_id: number, lines: ReturnType<typeof issueLine>[]) => ({
    request_id: randomUUID(), type_id, lines, destination: 'color', confirmed_ready: true,
  });

  await t.test('a confirmed withdrawal deducts only once and retains its original lines', async () => {
    const { orderId, typeId } = await makeOrder('stock', 1500);
    const source = await receive(orderId);
    const input = { ...issueInput(typeId, [issueLine(source.id, 200), issueLine(source.id, 400)]), pooled: true };
    const issued = await press('/issues', 'POST', input);
    assert.equal(issued.status, 201);
    const { remaining_pieces, general_pieces, restricted_pieces } = await findSource(source.entry_id);
    assert.deepEqual({ remaining_pieces, general_pieces, restricted_pieces }, {
      remaining_pieces: 900, general_pieces: 900, restricted_pieces: 0,
    });
    const listing = await press('/issues');
    assert.equal(listing.status, 200);
    const saved = listing.body.items.find((row: { id: number }) => row.id === issued.body.id);
    assert.equal(saved.order_id, null);
    assert.equal(saved.type_id, typeId);
    assert.equal(saved.destination, 'color');
    assert.equal(saved.confirmed_ready, true);
    assert.equal(saved.pooled, true);
    assert.equal(saved.issued_by_username, 'admin');
    assert.ok(Number.isFinite(Date.parse(saved.issued_at)));
    assert.equal(saved.lines.length, 1);
    assert.ok(Number.isInteger(saved.lines[0].id));
    assert.deepEqual(saved.lines[0], { id: saved.lines[0].id, ...issueLine(source.id, 600) });
    const replay = await press('/issues', 'POST', { ...input, lines: [...input.lines].reverse() });
    assert.equal(replay.status, 201);
    assert.deepEqual(replay.body, issued.body);
    assert.equal((await press('/issues', 'POST', { ...input, lines: [issueLine(source.id, 600)] })).status, 409);
    assert.equal((await press('/issues', 'POST', { ...input, pooled: false })).status, 409);
    assert.equal((await findSource(source.entry_id)).remaining_pieces, 900);
    await migrate(pool);
    assert.deepEqual((await press('/issues')).body, listing.body);
    const audit = (await call('/audit', 'GET', undefined, admin)).body.items;
    assert.equal(audit.filter((row: { actor: string; target: string; action: string }) =>
      row.actor === 'admin' && row.target === String(issued.body.id) && row.action === 'ยืนยันเบิกสต็อกงานปั๊ม').length, 1);
  });

  await t.test('withdrawal and release audit use the movement time after the transaction starts', async () => {
    const { orderId, typeId } = await makeOrder('customer', 1000);
    const source = await receive(orderId);
    const issue = { ...issueInput(typeId, [issueLine(source.id, 200, 'order')]), order_id: orderId };
    const release = { request_id: randomUUID(), source_id: source.id, pieces: 400 };
    const actor = { id: 1, username: 'admin' };
    const { cutoff, issueId, releaseId } = await transaction(pool, async db => {
      await db.query('SELECT pg_sleep(0.02)');
      const marker = await one(db, 'SELECT clock_timestamp()::text AS cutoff');
      const issueId = await recordIssue(db, issue, actor);
      const releaseId = await releaseSurplus(db, release, actor);
      return { cutoff: marker.cutoff, issueId, releaseId };
    });
    const timing = await all(pool, `SELECT movement.action, movement.at >= $1::timestamptz AS after_start,
      movement.at = a.created_at AS matches_audit FROM (
        SELECT id,issued_at AS at,'ยืนยันเบิกสต็อกงานปั๊ม' AS action FROM pressing_issues WHERE id=$2
        UNION ALL
        SELECT id,released_at,'ปล่อยยอดปั๊มส่วนเกิน' FROM pressing_releases WHERE id=$3
      ) movement JOIN audit a ON a.target=movement.id::text AND a.action=movement.action
      ORDER BY a.id`, [cutoff, issueId, releaseId]);
    assert.deepEqual(timing, [
      { action: 'ยืนยันเบิกสต็อกงานปั๊ม', after_start: true, matches_audit: true },
      { action: 'ปล่อยยอดปั๊มส่วนเกิน', after_start: true, matches_audit: true },
    ]);
  });

  await t.test('a withdrawal checks the Bangkok rest date, recorded destination, type, and confirmation', async () => {
    const { orderId, typeId } = await makeOrder('stock', 1500);
    const resting = await receive(orderId, '2099-01-29');
    assert.equal((await press('/issues', 'POST', issueInput(typeId, [issueLine(resting.id, 200)]))).status, 409);
    const color = await receive(orderId);
    assert.equal((await press('/types/' + typeId, 'PUT', { ...tile, destination: 'kiln' })).status, 200);
    const kiln = await receive(orderId);
    const input = issueInput(typeId, [issueLine(color.id, 200)]);
    const wrongType = await makeOrder('customer', 1000);
    for (const invalid of [
      { destination: 'kiln' }, { confirmed_ready: false }, { type_id: wrongType.typeId },
      { order_id: wrongType.orderId },
    ]) assert.equal((await press('/issues', 'POST', { ...input, ...invalid })).status, 409);
    assert.equal((await press('/issues', 'POST', input)).status, 201);
    const kilnInput = issueInput(typeId, [issueLine(kiln.id, 200)]);
    assert.equal((await press('/issues', 'POST', kilnInput)).status, 409);
    assert.equal((await press('/issues', 'POST', { ...kilnInput, destination: 'kiln' })).status, 201);
  });

  await t.test('only one concurrent withdrawal of 900 can commit against 1500 pieces', async () => {
    const { orderId, typeId } = await makeOrder('stock', 1500);
    const source = await receive(orderId);
    const inputs = [issueInput(typeId, [issueLine(source.id, 900)]), issueInput(typeId, [issueLine(source.id, 900)])];
    const results = await Promise.all(inputs.map(input => press('/issues', 'POST', input)));
    const statuses = results.map(result => result.status);
    assert.deepEqual(statuses.sort(), [201, 409]);
    assert.equal((await findSource(source.entry_id)).remaining_pieces, 600);
    const winner = results.findIndex(result => result.status === 201);
    const replay = await press('/issues', 'POST', inputs[winner]);
    assert.equal(replay.status, 201);
    assert.deepEqual(replay.body, results[winner].body);
    assert.equal((await findSource(source.entry_id)).remaining_pieces, 600);
  });

  await t.test('aggregated duplicate lines cannot overdraw and a rejected withdrawal leaves every source intact', async () => {
    const { orderId, typeId } = await makeOrder('stock', 1500);
    const first = await receive(orderId);
    const second = await receive(orderId);
    const before = await press('/issues');
    const input = issueInput(typeId, [issueLine(first.id, 400), issueLine(second.id, 800), issueLine(second.id, 800)]);
    assert.equal((await press('/issues', 'POST', input)).status, 409);
    assert.equal((await findSource(first.entry_id)).remaining_pieces, 1500);
    assert.equal((await findSource(second.entry_id)).remaining_pieces, 1500);
    assert.deepEqual((await press('/issues')).body, before.body);
    assert.equal((await press('/issues', 'POST', { ...input, lines: [issueLine(first.id, 400), issueLine(second.id, 400)] })).status, 201);
    assert.equal((await findSource(first.entry_id)).remaining_pieces, 1100);
    assert.equal((await findSource(second.entry_id)).remaining_pieces, 1100);
  });

  await t.test('released excess becomes general stock and the rest stays reserved for the original order', async () => {
    const { orderId, typeId } = await makeOrder('customer', 1000);
    const consumingOrder = await press('/orders', 'POST', {
      type_id: typeId, purpose: 'customer', target_pieces: 500, customer_reference: 'SALE-03',
    });
    assert.equal(consumingOrder.status, 201);
    const source = await receive(orderId);
    const release = { request_id: randomUUID(), source_id: source.id, pieces: 500 };
    const otherOrder = { ...issueInput(typeId, [issueLine(source.id, 500)]), order_id: consumingOrder.body.id };
    assert.equal((await press('/issues', 'POST', otherOrder)).status, 409);
    assert.equal((await press('/issues', 'POST', { ...otherOrder, lines: [issueLine(source.id, 500, 'order')] })).status, 409);
    assert.equal((await press('/releases', 'POST', { ...release, pieces: 501 })).status, 409);
    const released = await press('/releases', 'POST', release);
    assert.equal(released.status, 201);
    const { remaining_pieces, general_pieces, restricted_pieces, ready_on } = await findSource(source.entry_id);
    assert.deepEqual({ remaining_pieces, general_pieces, restricted_pieces, ready_on }, {
      remaining_pieces: 1500, general_pieces: 500, restricted_pieces: 1000, ready_on: '2024-03-04',
    });
    assert.equal((await press('/releases', 'POST', { ...release, request_id: randomUUID(), pieces: 1 })).status, 409);
    assert.equal((await press('/issues', 'POST', { ...otherOrder, lines: [issueLine(source.id, 501)] })).status, 409);
    assert.equal((await press('/issues', 'POST', otherOrder)).status, 201);
    assert.equal((await press('/issues', 'POST', issueInput(typeId, [issueLine(source.id, 600, 'order')]))).status, 409);
    const sameOrder = { ...issueInput(typeId, [issueLine(source.id, 600, 'order')]), order_id: orderId };
    assert.equal((await press('/issues', 'POST', sameOrder)).status, 201);
    assert.equal((await findSource(source.entry_id)).remaining_pieces, 400);
    const replay = await press('/releases', 'POST', release);
    assert.equal(replay.status, 201);
    assert.deepEqual(replay.body, released.body);
    assert.equal((await press('/releases', 'POST', { ...release, pieces: 499 })).status, 409);
    assert.equal((await findSource(source.entry_id)).general_pieces, 0);
    const audit = (await call('/audit', 'GET', undefined, admin)).body.items;
    assert.equal(audit.filter((row: { actor: string; target: string; action: string }) =>
      row.actor === 'admin' && row.target === String(released.body.id) && row.action === 'ปล่อยยอดปั๊มส่วนเกิน').length, 1);
  });

  await t.test('releases count excess across the order and never exceed the selected source balance', async () => {
    const { orderId, typeId } = await makeOrder('customer', 2000);
    const first = await receive(orderId);
    const second = await receive(orderId, '2099-01-29');
    const consume = { ...issueInput(typeId, [issueLine(first.id, 1200, 'order')]), order_id: orderId };
    assert.equal((await press('/issues', 'POST', consume)).status, 201);
    const release = { request_id: randomUUID(), source_id: first.id, pieces: 400 };
    assert.equal((await press('/releases', 'POST', release)).status, 409);
    assert.equal((await press('/releases', 'POST', { ...release, pieces: 300 })).status, 201);
    const secondRelease = { request_id: randomUUID(), source_id: second.id, pieces: 701 };
    assert.equal((await press('/releases', 'POST', secondRelease)).status, 409);
    assert.equal((await press('/releases', 'POST', { ...secondRelease, pieces: 700 })).status, 201);
    const stillResting = await findSource(second.entry_id);
    assert.equal(stillResting.general_pieces, 700);
    assert.equal(stillResting.ready, false);
    assert.equal(stillResting.ready_on, second.ready_on);
  });

  await t.test('undated opening stock can be confirmed once without changing the opening request', async () => {
    const { typeId } = await makeOrder('stock', 1500);
    const opening = { source_key: 'ready-later', type_id: typeId, as_of: '2024-02-29', pieces: 500, ready_confirmed: false };
    const created = await press('/opening', 'POST', opening);
    assert.equal(created.status, 201);
    const dated = await press('/opening', 'POST', { ...opening, source_key: 'wait-until-date', ready_on: '2099-02-02' });
    assert.equal(dated.status, 201);
    const issue = issueInput(typeId, [issueLine(created.body.id, 400)]);
    const readyPath = '/stock/' + created.body.id + '/ready';
    assert.equal((await press('/issues', 'POST', issue)).status, 409);
    assert.equal((await press('/stock/' + dated.body.id + '/ready', 'POST', { confirmed_ready: true })).status, 409);
    assert.equal((await press(readyPath, 'POST', { confirmed_ready: false })).status, 400);
    const confirmations = await Promise.all([1, 2].map(() => press(readyPath, 'POST', { confirmed_ready: true })));
    assert.deepEqual(confirmations.map(result => result.status), [200, 200]);
    assert.deepEqual(confirmations[0].body, confirmations[1].body);
    assert.deepEqual((await press('/opening', 'POST', opening)).body, created.body);
    assert.equal((await press('/opening', 'POST', { ...opening, ready_confirmed: true })).status, 409);
    assert.equal((await press('/issues', 'POST', issue)).status, 201);
    const audit = (await call('/audit', 'GET', undefined, admin)).body.items;
    assert.equal(audit.filter((row: { actor: string; target: string; action: string }) =>
      row.actor === 'admin' && row.target === String(created.body.id) && row.action === 'ยืนยันความพร้อมยอดตั้งต้น').length, 1);
  });

  await t.test('withdrawal and release validate payloads and require their own permissions', async () => {
    const { orderId, typeId } = await makeOrder('customer', 1000);
    const source = await receive(orderId);
    const release = { request_id: randomUUID(), source_id: source.id, pieces: 400 };
    const issue = { ...issueInput(typeId, [issueLine(source.id, 400, 'order')]), order_id: orderId };
    assert.equal((await press('/issues', 'POST', issue, reader)).status, 403);
    assert.equal((await press('/releases', 'POST', release, reader)).status, 403);
    assert.equal((await press('/stock/' + source.id + '/ready', 'POST', { confirmed_ready: true }, reader)).status, 403);
    for (const invalid of [
      { request_id: 'invalid\u0000' }, { lines: [] }, { lines: [null] },
      { lines: [issueLine(source.id, 0)] }, { lines: [issueLine(source.id, 1.5)] },
      { lines: [{ ...issue.lines[0], allocation: 'customer' }] }, { destination: 'paint' },
      { confirmed_ready: 'true' }, { pooled: null },
    ]) assert.equal((await press('/issues', 'POST', { ...issue, ...invalid })).status, 400);
    for (const invalid of [{ source_id: '1' }, { pieces: 0 }, { pieces: 2147483648 }, { request_id: 'bad\u0000' }])
      assert.equal((await press('/releases', 'POST', { ...release, ...invalid })).status, 400);
    assert.equal((await call('/roles/' + role.body.id, 'PUT', {
      name: 'ปล่อยยอดเกิน', permissions: ['pressing.read', 'pressing.release'],
    }, admin)).status, 200);
    assert.equal((await press('/releases', 'POST', release, reader)).status, 201);
    assert.equal((await press('/issues', 'POST', issue, reader)).status, 403);
    assert.equal((await call('/roles/' + role.body.id, 'PUT', {
      name: 'ยืนยันเบิก', permissions: ['pressing.read', 'pressing.issue'],
    }, admin)).status, 200);
    assert.equal((await press('/issues', 'POST', issue, reader)).status, 201);
    assert.equal((await press('/releases', 'POST', release, reader)).status, 403);
  });

  await t.test('an untouched receipt edit keeps the first POST replay and uses the saved conversion and rest period', async () => {
    const { orderId, typeId } = await makeOrder('stock', 1500);
    const receipt = { ...entryInput(orderId, 2), pressed_on: '2024-02-29', note: '  เดิม  ' };
    const created = await press('/entries', 'POST', receipt);
    assert.equal(created.status, 201);
    const path = '/entries/' + created.body.id;
    const newWorker = await call('/employees', 'POST', { code: 'EMP-5', name: 'คนปั๊มอีกคน' }, admin);
    assert.equal(newWorker.status, 201);
    assert.equal((await press('/types/' + typeId, 'PUT', {
      ...tile, pieces_per_rack: 1000, rest_days: 0, pieces_per_sqm: 100,
    })).status, 200);
    const edit = { pressed_on: '2024-03-01', employee_id: newWorker.body.id, full_racks: 1, loose_pieces: 25, note: ' แก้แล้ว ' };
    assert.equal((await press(path, 'PUT', edit, reader)).status, 403);
    assert.equal((await press(path, 'PUT', { ...edit, order_id: orderId + 1 })).status, 409);
    assert.equal((await press(path, 'PUT', { ...edit, employee_id: archived.body.id })).status, 400);
    assert.deepEqual((await press(path, 'PUT', edit)).body, created.body);
    assert.equal((await press(path, 'PUT', { ...edit, note: 'แก้ครั้งที่สอง' })).status, 200);
    assert.equal((await press(path, 'PUT', { ...edit, note: 'แก้ครั้งที่สอง' })).status, 200);

    const entry = (await press('/entries?order_id=' + orderId)).body.items[0];
    assert.equal(entry.pieces, 775);
    assert.equal(entry.square_meters, 15.5);
    assert.equal(entry.employee_id, newWorker.body.id);
    assert.equal(entry.ready_on, '2024-03-05');
    assert.equal(entry.note, 'แก้ครั้งที่สอง');
    assert.equal((await findSource(created.body.id)).general_pieces, 775);
    const history = await press(path + '/adjustments', 'GET', undefined, reader);
    assert.equal(history.status, 200);
    assert.equal(history.body.items.length, 2);
    const [first, second] = history.body.items;
    assert.equal(first.kind, 'edit');
    assert.equal(first.previous_pieces, 1500);
    assert.equal(first.corrected_pieces, 775);
    assert.deepEqual(first.previous_values, {
      pressed_on: '2024-02-29', employee_id: worker.body.id, full_racks: 2, loose_pieces: 0,
      note: 'เดิม', ready_on: '2024-03-04',
    });
    assert.equal(first.corrected_values.ready_on, '2024-03-05');
    assert.equal(first.corrected_by_username, 'admin');
    assert.ok(Number.isFinite(Date.parse(first.corrected_at)));
    assert.equal(second.previous_values.note, 'แก้แล้ว');
    assert.equal(second.corrected_values.note, 'แก้ครั้งที่สอง');
    const replay = await press('/entries', 'POST', { ...receipt, note: 'เดิม', loose_pieces: 0 });
    assert.equal(replay.status, 201);
    assert.deepEqual(replay.body, created.body);
    assert.equal((await press('/entries', 'POST', { ...receipt, ...edit })).status, 409);
    assert.equal((await press(path + '/adjustments', 'GET', undefined, '')).status, 401);
  });

  await t.test('a receipt correction counts releases once and supplies the effective totals and release cap', async () => {
    const { orderId, typeId } = await makeOrder('customer', 800);
    const source = await receive(orderId);
    const path = '/entries/' + source.entry_id + '/adjustments';
    const adjustment = { request_id: randomUUID(), corrected_pieces: 1100, reason: 'นับแผ่นซ้ำ' };
    assert.equal((await press(path, 'POST', adjustment)).status, 409);
    const release = { request_id: randomUUID(), source_id: source.id, pieces: 500 };
    assert.equal((await press('/releases', 'POST', release)).status, 201);
    const issue = { ...issueInput(typeId, [issueLine(source.id, 400), issueLine(source.id, 600, 'order')]), order_id: orderId };
    assert.equal((await press('/issues', 'POST', issue)).status, 201);
    assert.equal((await press('/entries/' + source.entry_id, 'PUT', entryInput(orderId, 1))).status, 409);
    assert.equal((await press(path, 'POST', adjustment, reader)).status, 403);
    assert.equal((await press(path, 'POST', { ...adjustment, reason: ' ' })).status, 400);
    assert.equal((await press(path, 'POST', { ...adjustment, corrected_pieces: 1099 })).status, 409);
    const corrected = await press(path, 'POST', adjustment);
    assert.equal(corrected.status, 201);
    const balance = await findSource(source.entry_id);
    assert.equal(balance.remaining_pieces, 100);
    assert.equal(balance.general_pieces, 100);
    assert.equal(balance.restricted_pieces, 0);
    const entry = (await press('/entries?order_id=' + orderId)).body.items[0];
    assert.equal(entry.pieces, 1100);
    assert.equal(entry.original_pieces, 1500);
    assert.equal(entry.full_racks, 2);
    assert.equal(entry.square_meters, 22);
    const order = (await press('/orders')).body.items.find((row: { id: number }) => row.id === orderId);
    assert.deepEqual([order.pressed_pieces, order.short_pieces, order.over_pieces], [1100, 0, 300]);

    const next = await press(path, 'POST', { ...adjustment, request_id: randomUUID(), corrected_pieces: 1200 });
    assert.equal(next.status, 201);
    assert.equal((await findSource(source.entry_id)).remaining_pieces, 200);
    assert.deepEqual((await press(path, 'POST', { ...adjustment, reason: ' นับแผ่นซ้ำ ' })).body, corrected.body);
    assert.equal((await press(path, 'POST', { ...adjustment, corrected_pieces: 1200 })).status, 409);
    assert.equal((await press('/releases', 'POST', { ...release, request_id: randomUUID(), pieces: 1 })).status, 409);
    assert.equal((await press('/orders/' + orderId, 'PUT', { target_pieces: 600 })).status, 200);
    assert.equal((await findSource(source.entry_id)).general_pieces, 100);
    assert.equal((await press('/releases', 'POST', { ...release, request_id: randomUUID(), pieces: 100 })).status, 201);
    assert.equal((await press(path, 'POST', adjustment)).status, 201);
    assert.equal((await findSource(source.entry_id)).general_pieces, 200);
    const history = await press(path);
    assert.equal(history.status, 200);
    assert.deepEqual(history.body.items.map((item: any) =>
      [item.id, item.kind, item.previous_pieces, item.corrected_pieces, item.reason, item.corrected_by_username]), [
      [corrected.body.id, 'adjustment', 1500, 1100, 'นับแผ่นซ้ำ', 'admin'],
      [next.body.id, 'adjustment', 1100, 1200, 'นับแผ่นซ้ำ', 'admin'],
    ]);
    assert.equal((await one(pool, 'SELECT pieces FROM pressing_entries WHERE id=$1', [source.entry_id])).pieces, 1500);
    await migrate(pool);
    assert.deepEqual((await press(path)).body, history.body);
  });

  await t.test('issue reversals restore only their original allocations and cap the unreversed amount atomically', async () => {
    const { orderId, typeId } = await makeOrder('customer', 1000);
    const source = await receive(orderId);
    assert.equal((await press('/releases', 'POST', { request_id: randomUUID(), source_id: source.id, pieces: 500 })).status, 201);
    const issue = { ...issueInput(typeId, [issueLine(source.id, 400), issueLine(source.id, 600, 'order')]), order_id: orderId };
    const created = await press('/issues', 'POST', issue);
    assert.equal(created.status, 201);
    const original = (await press('/issues')).body;
    const { lines } = original.items.find((item: { id: number }) => item.id === created.body.id);
    const general = lines.find((line: { allocation: string }) => line.allocation === 'general');
    const restricted = lines.find((line: { allocation: string }) => line.allocation === 'order');
    const reverseLine = (issue_line_id: number, pieces: number) => ({ issue_line_id, pieces });
    const reversal = {
      request_id: randomUUID(), reason: 'ลงเบิกเกิน',
      lines: [reverseLine(general.id, 400), reverseLine(restricted.id, 300)],
    };
    const path = '/issues/' + created.body.id + '/reversals';
    assert.equal((await press(path, 'POST', reversal, reader)).status, 403);
    assert.equal((await press(path, 'POST', { ...reversal, lines: [] })).status, 400);
    assert.equal((await press(path, 'POST', { ...reversal, lines: [...reversal.lines, reverseLine(2147483647, 1)] })).status, 409);
    assert.equal((await press(path, 'POST', { ...reversal, lines: [...reversal.lines, reverseLine(general.id, 1)] })).status, 409);
    assert.equal((await findSource(source.entry_id)).remaining_pieces, 500);
    assert.deepEqual((await press(path)).body, { items: [] });
    const reversed = await press(path, 'POST', reversal);
    assert.equal(reversed.status, 201);
    const replay = await press(path, 'POST', { ...reversal, lines: [...reversal.lines].reverse() });
    assert.equal(replay.status, 201);
    assert.deepEqual(replay.body, reversed.body);
    assert.equal((await press(path, 'POST', { ...reversal, reason: 'เหตุผลอื่น' })).status, 409);
    const later = { ...reversal, lines: [reverseLine(restricted.id, 300)] };
    const competing = await Promise.all([1, 2].map(() => press(path, 'POST', { ...later, request_id: randomUUID() })));
    assert.deepEqual(competing.map(result => result.status).sort(), [201, 409]);
    const balance = await findSource(source.entry_id);
    assert.equal(balance.general_pieces, 500);
    assert.equal(balance.restricted_pieces, 1000);
    assert.equal(balance.remaining_pieces, 1500);
    assert.deepEqual((await press('/issues')).body, original);
    const history = await press(path);
    assert.equal(history.status, 200);
    assert.equal(history.body.items.length, 2);
    assert.equal(history.body.items[0].reason, 'ลงเบิกเกิน');
    assert.equal(history.body.items[0].reversed_by_username, 'admin');
    assert.ok(Number.isFinite(Date.parse(history.body.items[0].reversed_at)));
    assert.deepEqual(history.body.items[0].lines, [
      { issue_line_id: general.id, source_id: source.id, allocation: 'general', pieces: 400, previous_pieces: 400 },
      { issue_line_id: restricted.id, source_id: source.id, allocation: 'order', pieces: 300, previous_pieces: 600 },
    ]);
    assert.equal(history.body.items[1].lines[0].previous_pieces, 300);
    assert.equal((await press('/entries/' + source.entry_id, 'PUT', entryInput(orderId, 1))).status, 409);
    const corrected = await press('/entries/' + source.entry_id + '/adjustments', 'POST', {
      request_id: randomUUID(), corrected_pieces: 500, reason: 'แก้ยอดปั๊ม',
    });
    assert.equal(corrected.status, 201);
    assert.equal((await findSource(source.entry_id)).restricted_pieces, 0);
  });

  await t.test('a general receipt correction uses net issues and can reach zero after a full reversal', async () => {
    const { orderId, typeId } = await makeOrder('stock', 1500);
    const source = await receive(orderId);
    const issued = await press('/issues', 'POST', issueInput(typeId, [issueLine(source.id, 250)]));
    assert.equal(issued.status, 201);
    const path = '/entries/' + source.entry_id + '/adjustments';
    const correction = { request_id: randomUUID(), corrected_pieces: 249, reason: 'แก้ยอดปั๊ม' };
    assert.equal((await press(path, 'POST', correction)).status, 409);
    assert.equal((await press(path, 'POST', { ...correction, corrected_pieces: 250 })).status, 201);
    const issue = (await press('/issues')).body.items.find((item: { id: number }) => item.id === issued.body.id);
    assert.equal((await press('/issues/' + issued.body.id + '/reversals', 'POST', {
      request_id: randomUUID(), lines: [{ issue_line_id: issue.lines[0].id, pieces: 250 }], reason: 'ลงเบิกผิด',
    })).status, 201);
    assert.equal((await press(path, 'POST', { ...correction, request_id: randomUUID(), corrected_pieces: 0 })).status, 201);
    assert.equal((await findSource(source.entry_id)).remaining_pieces, 0);
    const audit = (await call('/audit', 'GET', undefined, admin)).body.items;
    assert.equal(audit.filter((row: { target: string; action: string }) =>
      row.target === String(source.entry_id) && row.action === 'ปรับยอดปั๊ม').length, 2);
    assert.equal(audit.filter((row: { target: string; action: string }) =>
      row.target === String(issued.body.id) && row.action === 'ย้อนรายการเบิกงานปั๊ม').length, 1);
  });

  await t.test('pooled sorting preserves stock and reports only the latest revision of each tile type', async () => {
    const { orderId, typeId } = await makeOrder('stock', 1500);
    const firstSource = await receive(orderId);
    const secondWorker = await call('/employees', 'POST', { code: 'EMP-KILN', name: 'คนปั๊มอีกคน' }, admin);
    assert.equal(secondWorker.status, 201);
    const secondReceipt = await press('/entries', 'POST', {
      ...entryInput(orderId, 2), pressed_on: '2024-02-29', employee_id: secondWorker.body.id,
    });
    assert.equal(secondReceipt.status, 201);
    const secondSource = await findSource(secondReceipt.body.id);
    const pooled = await press('/issues', 'POST', {
      ...issueInput(typeId, [issueLine(firstSource.id, 800), issueLine(secondSource.id, 700)]), pooled: true,
    });
    assert.equal(pooled.status, 201);
    const remaining = async () => [
      (await findSource(firstSource.entry_id)).remaining_pieces,
      (await findSource(secondSource.entry_id)).remaining_pieces,
    ];
    assert.deepEqual(await remaining(), [700, 800]);

    const kilnPath = '/kiln-jobs';
    const jobInput = { request_id: randomUUID(), reference: ' เตา 🧱 A ', fired_on: '2024-03-08' };
    const job = await press(kilnPath, 'POST', jobInput);
    assert.equal(job.status, 201);
    assert.deepEqual((await press(kilnPath, 'POST', { ...jobInput, reference: 'เตา 🧱 A' })).body, job.body);
    assert.equal((await press(kilnPath, 'POST', { ...jobInput, fired_on: '2024-03-09' })).status, 409);
    const path = kilnPath + '/' + job.body.id + '/results';
    const input = {
      request_id: randomUUID(), type_id: typeId, sorted_on: '2024-03-09',
      good_pieces: 1480, waste_pieces: 20, issue_ids: [pooled.body.id],
    };
    const submissions = await Promise.all([press(path, 'POST', input), press(path, 'POST', input)]);
    assert.deepEqual(submissions.map(response => response.status), [201, 201]);
    const [first, retry] = submissions;
    assert.deepEqual(retry.body, first.body);
    assert.equal((await press(path, 'POST', { ...input, waste_pieces: 21 })).status, 409);
    const currentJob = async () => (await press(kilnPath)).body.items.find((item: any) => item.id === job.body.id);
    const counts = ({ good_pieces, waste_pieces }: typeof input) => ({ good_pieces, waste_pieces });
    const initial = await currentJob();
    assert.equal(initial.reference, 'เตา 🧱 A');
    assert.equal(initial.fired_on, '2024-03-08');
    assert.deepEqual(counts(initial), { good_pieces: 1480, waste_pieces: 20 });
    assert.equal(initial.results[0].employee_id, null);
    assert.deepEqual(initial.results[0].issue_ids, [pooled.body.id]);
    assert.deepEqual(await remaining(), [700, 800]);

    const revision = {
      ...input, request_id: randomUUID(), good_pieces: 1475, waste_pieces: 25, correction_reason: ' นับยอดเสียใหม่ ',
    };
    assert.equal((await press(path, 'POST', { ...revision, correction_reason: ' ' })).status, 400);
    const revised = await press(path, 'POST', revision);
    assert.equal(revised.status, 201);
    assert.deepEqual((await press(path, 'POST', input)).body, first.body);
    assert.deepEqual((await press(path, 'POST', revision)).body, revised.body);
    const anotherType = await press('/types', 'POST', tile);
    assert.equal(anotherType.status, 201);
    const anotherTypeId = anotherType.body.id;
    assert.equal((await press(path, 'POST', {
      ...input, request_id: randomUUID(), type_id: anotherTypeId,
    })).status, 409);
    const second = await press(path, 'POST', {
      ...input, request_id: randomUUID(), type_id: anotherTypeId,
      good_pieces: 8, waste_pieces: 2, issue_ids: [], employee_id: worker.body.id,
    });
    assert.equal(second.status, 201);
    const current = await currentJob();
    assert.deepEqual(counts(current), { good_pieces: 1483, waste_pieces: 27 });
    assert.deepEqual(current.results.map((result: any) => [result.id, result.type_id, result.employee_id]), [
      [revised.body.id, typeId, null], [second.body.id, anotherTypeId, worker.body.id],
    ]);
    assert.deepEqual(await remaining(), [700, 800]);
    const history = await press(path);
    assert.equal(history.status, 200);
    assert.deepEqual(history.body.items.map((result: any) => [
      result.id, result.revision, result.is_current, result.correction_reason, counts(result),
    ]), [
      [first.body.id, 1, false, null, { good_pieces: 1480, waste_pieces: 20 }],
      [revised.body.id, 2, true, 'นับยอดเสียใหม่', { good_pieces: 1475, waste_pieces: 25 }],
      [second.body.id, 1, true, null, { good_pieces: 8, waste_pieces: 2 }],
    ]);
    assert.equal(history.body.items[1].submitted_by_username, 'admin');
    assert.ok(Number.isFinite(Date.parse(history.body.items[1].submitted_at)));
    assert.equal((await press('/types/' + anotherTypeId, 'DELETE')).status, 200);
    const retiredType = (await press('/types')).body.items.find((item: any) => item.id === anotherTypeId);
    assert.equal(retiredType.active, false);
    await migrate(pool);
    assert.deepEqual((await press(path)).body, history.body);
  });

  await t.test('sorting validates dates and quantities and checks correction permissions separately', async () => {
    const { typeId } = await makeOrder('stock', 1500);
    const kilnPath = '/kiln-jobs';
    const jobInput = { request_id: randomUUID(), fired_on: '2024-02-29' };
    assert.equal((await press(kilnPath, 'GET', undefined, '')).status, 401);
    assert.equal((await press(kilnPath, 'POST', jobInput, reader)).status, 403);
    assert.equal((await call('/roles/' + role.body.id, 'PUT', {
      name: 'ส่งผลคัด', permissions: ['pressing.read', 'pressing.sort'],
    }, admin)).status, 200);
    assert.equal((await press(kilnPath, 'POST', { ...jobInput, fired_on: '2023-02-29' }, reader)).status, 400);
    const job = await press(kilnPath, 'POST', jobInput, reader);
    assert.equal(job.status, 201);
    const listed = (await press(kilnPath, 'GET', undefined, reader)).body.items.find((item: any) => item.id === job.body.id);
    assert.equal(listed.reference, 'KILN-' + job.body.id);
    assert.deepEqual([listed.good_pieces, listed.waste_pieces, listed.results], [0, 0, []]);
    assert.equal((await press(kilnPath + '/2147483647/results', 'GET', undefined, reader)).status, 404);

    const path = kilnPath + '/' + job.body.id + '/results';
    const result = { request_id: randomUUID(), type_id: typeId, sorted_on: '2024-02-29', good_pieces: 0, waste_pieces: 0 };
    for (const invalid of [
      { sorted_on: '2024-02-28' }, { sorted_on: '2024-02-30' }, { good_pieces: -1 },
      { waste_pieces: 0.5 }, { good_pieces: '0' }, { waste_pieces: 2147483648 }, { issue_ids: '1' },
      { employee_id: 2147483647 }, { type_id: 2147483647 }, { correction_reason: 'ยังไม่เคยส่ง' },
    ]) {
      assert.equal((await press(path, 'POST', { ...result, ...invalid }, reader)).status, 400);
    }
    assert.equal((await press(path, 'POST', { ...result, issue_ids: [2147483647] }, reader)).status, 409);
    assert.equal((await press(path, 'POST', result, reader)).status, 201);
    const revision = { ...result, request_id: randomUUID(), good_pieces: 1, correction_reason: 'ตกหล่นหนึ่งแผ่น' };
    assert.equal((await press(path, 'POST', revision, reader)).status, 403);
    const corrected = await press(path, 'POST', revision);
    assert.equal(corrected.status, 201);
    assert.equal((await press(path, 'POST', revision, reader)).status, 403);
    const history = (await press(path, 'GET', undefined, reader)).body.items;
    assert.equal(history.length, 2);
    assert.equal(history[0].submitted_by_username, 'reader');
    assert.equal(history[1].is_current, true);
  });
});
