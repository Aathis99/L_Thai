import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { migrate, one, transaction } from '../src/database.js';
import { createOrder, saveType } from '../src/pressing/catalog.js';
import { recordEntry, recordIssue, reverseIssue } from '../src/pressing/stock.js';
import { createApplication } from '../src/app.js';

dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });

async function fixture(t: TestContext) {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, 'Set DATABASE_URL to the test database');
  const schema = 'finishing_test_' + randomUUID().replaceAll('-', '');
  const control = new pg.Pool({ connectionString: databaseUrl });
  const pool = new pg.Pool({ connectionString: databaseUrl, options: '-c search_path=' + schema });
  t.after(async () => {
    await pool.end();
    await control.query('DROP SCHEMA ' + schema + ' CASCADE');
    await control.end();
  });
  await control.query('CREATE SCHEMA ' + schema);
  await migrate(pool);
  return pool;
}

test('an order keeps its customer quantity, rounded allowance, color and area rate', async t => {
  const pool = await fixture(t);
  const type = await saveType(pool, {
    width: 2, length: 8, clay: 'ขาว', pieces_per_rack: 100, rest_days: 0,
    destination: 'color', pieces_per_sqm: 50,
  });
  const color = await one(pool, `INSERT INTO color_chart_entries(display_order,name,normalized_name)
    VALUES(1,'ฟ้า','ฟ้า') RETURNING id`);
  const order = {
    type_id: type, purpose: 'customer', customer_reference: 'A-101',
    customer_pieces: 101, allowance_percent: 10, color_id: color.id,
  };
  const id = await transaction(pool, db => createOrder(db, order));
  const saved = await one(pool, `SELECT target_pieces,customer_pieces,allowance_pieces,color_name,pieces_per_sqm
    FROM pressing_orders WHERE id=$1`, [id]);
  assert.deepEqual(saved, {
    target_pieces: 112, customer_pieces: 101, allowance_pieces: 11,
    color_name: 'ฟ้า', pieces_per_sqm: 50,
  });
  for (const invalid of [{ allowance_percent: 4 }, { allowance_percent: 21 }, { color_id: null }]) {
    await assert.rejects(transaction(pool, db => createOrder(db, { ...order, ...invalid })));
  }
});

test('finishing tracks glazing, split firing, pooled QC and stock without spending pieces twice', async t => {
  const pool = await fixture(t);
  const { correctGlazing, recordGlazing } = await import('../src/finishing/glazing.js');
  const actor = await one(pool, `INSERT INTO users(username,name,password_hash,role_id)
    VALUES('operator','Operator','unused',1) RETURNING id,username`);
  const worker = await one(pool, "INSERT INTO employees(code,name) VALUES('A','Worker') RETURNING id");
  const other = await one(pool, "INSERT INTO employees(code,name) VALUES('B','Worker 2') RETURNING id");
  const type = await saveType(pool, {
    width: 2, length: 8, clay: 'ขาว', pieces_per_rack: 100, rest_days: 0, destination: 'color',
  });
  const color = await one(pool, `INSERT INTO color_chart_entries(display_order,name,normalized_name)
    VALUES(1,'ฟ้า','ฟ้า') RETURNING id`);
  const order = await createOrder(pool, {
    type_id: type, purpose: 'customer', customer_reference: 'A',
    customer_pieces: 600, allowance_percent: 10, color_id: color.id,
  });
  await recordEntry(pool, { request_id: 'press', order_id: order, pressed_on: '2026-01-01',
    employee_id: worker.id, full_racks: 7, loose_pieces: 0 }, actor);
  const source = await one(pool, 'SELECT id FROM pressing_stock_sources');
  const issue = await recordIssue(pool, {
    request_id: 'issue', order_id: order, type_id: type, destination: 'color', confirmed_ready: true,
    lines: [{ source_id: source.id, pieces: 650, allocation: 'order' }],
  }, actor);
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Bangkok', dateStyle: 'short' }).format(new Date());
  const batch = { issue_id: issue, worked_on: today, worker_ids: [worker.id, other.id],
    pieces: 600, pressing_waste: 10, glazing_waste: 10, good_pieces: 580, request_id: 'glaze' };
  const save = () => transaction(pool, db => recordGlazing(db, batch, actor));
  const results = await Promise.all([save(), save()]);
  assert.equal(results[0], results[1]);
  await assert.rejects(transaction(pool, db => recordGlazing(db, { ...batch, request_id: 'extra' }, actor)),
    /ยอดเบิก/);
  const line = await one(pool, 'SELECT id FROM pressing_issue_lines');
  const reversal = { request_id: 'return', reason: 'ทดสอบ', lines: [{ issue_line_id: line.id, pieces: 51 }] };
  await assert.rejects(transaction(pool, db => reverseIssue(db, issue, reversal, actor)), /งานชุบ/);

  const { correctLoad, createRound, finishRound, loadRound, setRange } = await import('../src/finishing/firing.js');
  const { allocateGood, correctQc, recordQc, receiveStock, voidAllocation, voidQc, voidReceipt } = await import('../src/finishing/qc.js');
  const inTx = (fn: (db: pg.PoolClient) => Promise<number>) => transaction(pool, fn);
  const round = await inTx(db => createRound(db, {
    kiln: '1', temperature: 1000, started_on: batch.worked_on, request_id: 'round',
  }, actor));
  const loading = { round_id: round, batch_id: results[0], pieces: 400, request_id: 'load' };
  await assert.rejects(inTx(db => loadRound(db, loading, actor)), /รอตั้งช่วงอุณหภูมิ/);
  await inTx(db => setRange(db, { clay: 'ขาว', minimum: 950, maximum: 1000 }, actor));
  await inTx(db => setRange(db, { color_id: color.id, minimum: 1001, maximum: 1050 }, actor));
  await assert.rejects(inTx(db => loadRound(db, loading, actor)), /นอกช่วง/);
  await inTx(db => setRange(db, { color_id: color.id, minimum: 1000, maximum: 1050 }, actor));
  const load = await inTx(db => loadRound(db, loading, actor));
  await assert.rejects(inTx(db => correctGlazing(db, { batch_id: results[0], pieces: 600, pressing_waste: 100,
    glazing_waste: 101, good_pieces: 399, request_id: 'glaze-correction', reason: 'ตรวจซ้ำ' }, actor)), /ต่ำกว่ายอดเข้าเตา/);
  await assert.rejects(inTx(db => loadRound(db, { ...loading, request_id: 'load-more' }, actor)), /ยอดรอเผา/);
  const qc = { round_id: round, sorted_on: batch.worked_on, good_pieces: 375, waste_pieces: 25,
    lines: [{ load_id: load, pieces: 400 }], request_id: 'qc' };
  await assert.rejects(inTx(db => recordQc(db, qc, actor)), /เผาเสร็จ/);
  await inTx(db => finishRound(db, { round_id: round, finished_on: batch.worked_on, request_id: 'done' }, actor));
  const qcId = await inTx(db => recordQc(db, qc, actor));
  assert.deepEqual(await one(pool, 'SELECT ready_pieces,missing_pieces FROM finishing_order_balances WHERE id=$1', [order]),
    { ready_pieces: 375, missing_pieces: 225 });
  await assert.rejects(inTx(db => receiveStock(db, { qc_id: qcId, pieces: 1, request_id: 'stock' }, actor)), /กันแผ่น/);

  const secondOrder = await createOrder(pool, {
    type_id: type, purpose: 'customer', customer_reference: 'A',
    customer_pieces: 30, allowance_percent: 10, color_id: color.id,
  });
  const transfer = { request_id: 'transfer', order_id: secondOrder, type_id: type,
    destination: 'color', confirmed_ready: true,
    lines: [{ source_id: source.id, pieces: 40, allocation: 'transfer' }] };
  await assert.rejects(inTx(db => recordIssue(db, transfer, actor)), /ไม่มีสิทธิ์/);
  const allocator = { ...actor, permissions: ['pressing.release'] };
  await assert.rejects(inTx(db => recordIssue(db, { ...transfer, lines: [{ ...transfer.lines[0], pieces: 41 }] }, allocator)), /ยอดเกิน/);
  const secondIssue = await inTx(db => recordIssue(db, transfer, allocator));
  assert.equal(await inTx(db => recordIssue(db, transfer, allocator)), secondIssue);
  assert.deepEqual(await one(pool, 'SELECT destination_issue_id,pieces FROM pressing_releases'), {
    destination_issue_id: secondIssue, pieces: 40,
  });
  const secondBatch = await inTx(db => recordGlazing(db, { ...batch, issue_id: secondIssue, pieces: 40,
    pressing_waste: 0, glazing_waste: 0, good_pieces: 40, request_id: 'glaze-B' }, actor));

  const entry = await inTx(db => recordEntry(db, { request_id: 'press-more', order_id: order, pressed_on: '2026-01-01',
    employee_id: worker.id, full_racks: 1, loose_pieces: 0 }, actor));
  const extraSource = await one(pool, 'SELECT id FROM pressing_stock_sources WHERE entry_id=$1', [entry]);
  const extraIssue = await inTx(db => recordIssue(db, { ...transfer, request_id: 'issue-more', order_id: order,
    lines: [{ source_id: extraSource.id, pieces: 100, allocation: 'order' }] }, actor));
  const extraBatch = await inTx(db => recordGlazing(db, { ...batch, issue_id: extraIssue, pieces: 100,
    pressing_waste: 0, glazing_waste: 0, good_pieces: 100, request_id: 'glaze-more' }, actor));
  const secondRound = await inTx(db => createRound(db, {
    kiln: '1', temperature: 1000, started_on: today, request_id: 'round-B',
  }, actor));
  const lines: { load_id: number; pieces: number }[] = [];
  for (const [batch_id, pieces] of [[results[0], 180], [secondBatch, 40], [extraBatch, 100]]) {
    const load_id = await inTx(db => loadRound(db, { round_id: secondRound, batch_id, pieces, request_id: 'round-B-' + batch_id }, actor));
    lines.push({ load_id, pieces });
  }
  await inTx(db => finishRound(db, { round_id: secondRound, finished_on: today, request_id: 'done-B' }, actor));
  const pooled = await inTx(db => recordQc(db, { round_id: secondRound, sorted_on: today,
    good_pieces: 310, waste_pieces: 10, lines, request_id: 'pooled' }, actor));
  await assert.rejects(inTx(db => receiveStock(db, { qc_id: pooled, pieces: 1, request_id: 'stock-before' }, actor)), /กันแผ่น/);
  await inTx(db => allocateGood(db, { qc_id: pooled, order_id: order, pieces: 225, request_id: 'allocate-A' }, actor));
  await inTx(db => allocateGood(db, { qc_id: pooled, order_id: secondOrder, pieces: 30, request_id: 'allocate-B' }, actor));
  await assert.rejects(inTx(db => allocateGood(db, { qc_id: pooled, order_id: secondOrder, pieces: 1, request_id: 'allocate-more' }, actor)), /ยอดขาด/);
  const receipt = { qc_id: pooled, pieces: 55, request_id: 'stock-after' };
  const receipts = await Promise.all([inTx(db => receiveStock(db, receipt, actor)), inTx(db => receiveStock(db, receipt, actor))]);
  assert.equal(receipts[0], receipts[1]);
  await assert.rejects(inTx(db => correctQc(db, { qc_id: pooled, good_pieces: 309, waste_pieces: 11,
    reason: 'ตรวจซ้ำ', request_id: 'correction' }, actor)), /ต่ำกว่ายอด/);
  assert.deepEqual(await one(pool, 'SELECT allocated_pieces,stocked_pieces,unallocated_pieces FROM firing_qc_balances WHERE id=$1', [pooled]),
    { allocated_pieces: 255, stocked_pieces: 55, unallocated_pieces: 0 });
  const allocation = await one(pool, 'SELECT id FROM firing_qc_allocations WHERE qc_id=$1 AND order_id=$2', [pooled, secondOrder]);
  const undo = { allocation_id: allocation.id, reason: 'ตรวจซ้ำ', request_id: 'undo-allocation' };
  await assert.rejects(inTx(db => voidAllocation(db, undo, actor)), /ย้อนรายการรับเข้าสต็อก/);
  await inTx(db => voidReceipt(db, { receipt_id: receipts[0], reason: 'ตรวจซ้ำ', request_id: 'undo-stock' }, actor));
  await inTx(db => voidAllocation(db, undo, actor));
  assert.equal((await one(pool, 'SELECT missing_pieces FROM finishing_order_balances WHERE id=$1', [secondOrder])).missing_pieces, 30);
  await assert.rejects(inTx(db => correctLoad(db, { load_id: lines[0].load_id, pieces: 179, reason: 'ตรวจซ้ำ',
    request_id: 'load-correction' }, actor)), /ต่ำกว่ายอดที่คัด/);
  await assert.rejects(inTx(db => voidQc(db, { qc_id: pooled, reason: 'ตรวจซ้ำ', request_id: 'undo-qc' }, actor)), /ย้อนยอดจัดสรร/);
  await pool.query("UPDATE pressing_types SET clay='แดง' WHERE id=$1", [type]);
  const changedClay = await createOrder(pool, {
    type_id: type, purpose: 'customer', customer_reference: 'C',
    customer_pieces: 25, allowance_percent: 10, color_id: color.id,
  });
  await assert.rejects(inTx(db => recordIssue(db, { ...transfer, request_id: 'wrong-clay', order_id: changedClay,
    lines: [{ ...transfer.lines[0], pieces: 1 }] }, allocator)), /ประเภทดิน/);
  assert.equal((await one(pool, 'SELECT count(*)::integer AS count FROM pressing_releases')).count, 1);
});

test('finished production routes require read and operation permissions independently', async t => {
  const pool = await fixture(t);
  const { server } = createApplication(pool);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = 'http://127.0.0.1:' + address.port + '/api';
  const call = (path: string, payload?: object, cookie = '') => fetch(base + path, {
    method: payload ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', cookie },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const password = 'synthetic-test-password';
  const setup = await call('/setup', { username: 'admin', name: 'Admin', password });
  assert.equal(setup.status, 201);
  const login = async (username: string) => {
    const response = await call('/login', { username, password });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie')!.split(';')[0];
  };
  const admin = await login('admin');
  const round = { kiln: '1', temperature: 1000, started_on: '2026-01-01', request_id: 'open-round' };
  assert.equal((await call('/finishing/rounds')).status, 401);
  for (const [username, permissions, expectedRead] of [
    ['reader', ['finishing.read'], 200],
    ['writer', ['finishing.fire'], 403],
  ] as const) {
    const role = await call('/roles', { name: username, permissions }, admin);
    assert.equal(role.status, 201);
    const { id: role_id } = await role.json() as { id: number };
    assert.equal((await call('/users', { username, name: username, role_id, password }, admin)).status, 201);
    const cookie = await login(username);
    assert.equal((await call('/finishing/rounds', undefined, cookie)).status, expectedRead);
    assert.equal((await call('/finishing/rounds', round, cookie)).status, 403);
  }
  const saved = await call('/finishing/rounds', round, admin);
  assert.equal(saved.status, 201);
  assert.deepEqual(await (await call('/finishing/rounds', round, admin)).json(), await saved.json());

  const tile = await call('/pressing/types', { width: 1, length: 1, clay: 'แดง',
    name: 'บรีส', rest_days: 0, pieces_per_rack: 50, destination: 'kiln' }, admin);
  assert.equal(tile.status, 201);
  const { id: type_id } = await tile.json() as { id: number };
  const legacy = await call('/pressing/orders', { type_id, target_pieces: 50, purpose: 'customer', customer_reference: 'LEGACY' }, admin);
  assert.equal(legacy.status, 201);
  const { id: order_id } = await legacy.json() as { id: number };
  const worker = await call('/employees', { code: 'BR', name: 'Worker' }, admin);
  const { id: employee_id } = await worker.json() as { id: number };
  assert.equal((await call('/pressing/entries', { order_id, employee_id, pressed_on: '2026-01-01',
    full_racks: 1, loose_pieces: 0, request_id: 'legacy-entry' }, admin)).status, 201);
  const { id: source_id } = await one(pool, 'SELECT id FROM pressing_stock_sources');
  const issue = await call('/pressing/issues', { order_id, type_id, destination: 'kiln', confirmed_ready: true,
    request_id: 'legacy-issue', lines: [{ source_id, pieces: 50, allocation: 'order' }] }, admin);
  assert.equal(issue.status, 201);
  const { id: issue_id } = await issue.json() as { id: number };
  const confirmation = { issue_id, pieces: 45, request_id: 'legacy-confirm' };
  assert.equal((await call('/finishing/confirm-issue', confirmation, admin)).status, 409);
  assert.equal((await call('/finishing/prepare-order', { order_id, customer_pieces: 45,
    allowance_percent: 10, request_id: 'legacy-order' }, admin)).status, 201);
  assert.equal((await call('/finishing/confirm-issue', confirmation, admin)).status, 201);
  assert.equal((await call('/finishing/ranges', { clay: 'แดง', minimum: 1000, maximum: 1000 }, admin)).status, 201);
  const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Bangkok', dateStyle: 'short' }).format(new Date());
  const roundResponse = await call('/finishing/rounds', { ...round, started_on: day, request_id: 'legacy-round' }, admin);
  assert.equal(roundResponse.status, 201);
  const { id: round_id } = await roundResponse.json() as { id: number };
  const directLoad = { issue_id, round_id, pieces: 46, request_id: 'legacy-load' };
  assert.equal((await call('/finishing/loads', directLoad, admin)).status, 409);
  assert.equal((await call('/finishing/loads', { ...directLoad, pieces: 45 }, admin)).status, 201);
});
