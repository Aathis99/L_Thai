import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';

test('employee access lifecycle with real HTTP, permissions and persistent SQLite', async t => {
  let createApp;
  try { ({ createApp } = await import('../server.mjs')); } catch {}
  assert.equal(typeof createApp, 'function', 'The persistent access API must exist');
  const dir = await mkdtemp(join(tmpdir(), 'lthai-test-'));
  const databasePath = join(dir, 'test.sqlite');
  let app = createApp({ databasePath });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  let base = `http://127.0.0.1:${app.server.address().port}`;
  async function call(path, method = 'GET', body, cookie = '', extra = {}) {
    const res = await fetch(base + '/api' + path, { method, headers: { 'Content-Type': 'application/json', cookie, ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json(), cookie: res.headers.get('set-cookie')?.split(';')[0] };
  }
  const password = 'a-strong-test-password';
  try {
    let admin;
    await t.test('one-time setup, authentication and safe password storage', async () => {
      assert.equal((await call('/me')).status, 401);
      assert.equal((await call('/setup')).body.required, true);
      assert.equal((await call('/setup', 'POST', { username: 'admin', name: 'ผู้ดูแล', password: 'short' })).status, 400);
      assert.equal((await call('/setup', 'POST', { username: 'admin', name: 'ผู้ดูแล', password })).status, 201);
      assert.equal((await call('/setup', 'POST', { username: 'other', name: 'อื่น', password })).status, 409);
      assert.equal((await call('/login', 'POST', { username: 'admin', password: 'wrong' })).status, 401);
      admin = (await call('/login', 'POST', { username: 'admin', password })).cookie;
      assert.ok(admin);
      const me = await call('/me', 'GET', undefined, admin);
      assert.equal(me.body.user.username, 'admin');
      assert.ok(!JSON.stringify(me.body).includes(password));
      assert.notEqual(app.db.prepare('SELECT password_hash FROM users').get().password_hash, password);
    });
    let employee, position, readerId, reader, role;
    await t.test('employee and position CRUD with validation and referential integrity', async () => {
      position = (await call('/positions', 'POST', { name: 'ธุรการ' }, admin)).body.id;
      assert.ok(position);
      const data = { code: 'EMP001', name: 'สมใจ ทดสอบ', department: 'สำนักงาน', position_id: position, phone: '', active: true };
      const added = await call('/employees', 'POST', data, admin);
      assert.equal(added.status, 201); employee = added.body.id;
      assert.equal((await call('/employees', 'POST', data, admin)).status, 409);
      assert.equal((await call('/employees', 'POST', { ...data, code: 'EMP002', position_id: 9999 }, admin)).status, 400);
      assert.equal((await call('/positions/' + position, 'DELETE', undefined, admin)).status, 409);
      assert.equal((await call('/employees/' + employee, 'PUT', { ...data, name: 'สมใจ แก้ไข' }, admin)).status, 200);
      assert.equal((await call('/employees', 'GET', undefined, admin)).body.items[0].name, 'สมใจ แก้ไข');
    });
    await t.test('API denies writes to readers and applies role edits to existing sessions', async () => {
      role = (await call('/roles', 'POST', { name: 'ดูพนักงาน', permissions: ['employees.read'] }, admin)).body.id;
      readerId = (await call('/users', 'POST', { username: 'reader', name: 'ผู้อ่าน', password, role_id: role, active: true, employee_id: employee }, admin)).body.id;
      reader = (await call('/login', 'POST', { username: 'reader', password })).cookie;
      assert.equal((await call('/employees', 'GET', undefined, reader)).status, 200);
      assert.equal((await call('/employees', 'POST', { code: 'BAD', name: 'ไม่ได้รับอนุญาต' }, reader)).status, 403);
      assert.equal((await call('/users', 'GET', undefined, reader)).status, 403);
      assert.equal((await call('/roles/' + role, 'PUT', { name: 'พักสิทธิ์', permissions: [] }, admin)).status, 200);
      assert.equal((await call('/employees', 'GET', undefined, reader)).status, 403);
      assert.equal((await call('/roles/' + role, 'DELETE', undefined, admin)).status, 409);
    });
    await t.test('last administrator is protected and role payloads are validated', async () => {
      const id = (await call('/me', 'GET', undefined, admin)).body.user.id;
      assert.equal((await call('/users/' + id, 'DELETE', undefined, admin)).status, 409);
      assert.equal((await call('/users/' + id, 'PUT', { name: 'ผู้ดูแล', username: 'admin', role_id: role, active: false }, admin)).status, 409);
      assert.equal((await call('/roles/1', 'DELETE', undefined, admin)).status, 409);
      assert.equal((await call('/roles', 'POST', { name: 'ปลอม', permissions: ['everything'] }, admin)).status, 400);
    });
    await t.test('archiving an employee cannot disable the last linked administrator', async () => {
      const ownEmployee = (await call('/employees', 'POST', { code: 'ADMIN-EMP', name: 'พนักงานผู้ดูแล' }, admin)).body.id;
      const me = (await call('/me', 'GET', undefined, admin)).body.user;
      assert.equal((await call('/users/' + me.id, 'PUT', { username: 'admin', name: 'ผู้ดูแล', role_id: 1, employee_id: ownEmployee, active: true }, admin)).status, 200);
      assert.equal((await call('/employees/' + ownEmployee, 'DELETE', undefined, admin)).status, 409);
      assert.equal((await call('/me', 'GET', undefined, admin)).status, 200);
      await call('/users/' + me.id, 'PUT', { username: 'admin', name: 'ผู้ดูแล', role_id: 1, active: true }, admin);
      await call('/employees/' + ownEmployee, 'DELETE', undefined, admin);
    });
    await t.test('Thai text survives UTF-8 characters split between HTTP chunks', async () => {
      const payload = Buffer.from(JSON.stringify({ name: 'ช่างทดสอบ' }));
      const split = payload.indexOf(Buffer.from('ช')) + 1;
      const result = await new Promise((resolve, reject) => {
        const req = request(base + '/api/positions', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: admin } }, res => {
          const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }));
        });
        req.on('error', reject); req.write(payload.subarray(0, split));
        setTimeout(() => req.end(payload.subarray(split)), 20);
      });
      assert.equal(result.status, 201);
      const positions = (await call('/positions', 'GET', undefined, admin)).body.items;
      assert.equal(positions.find(p => p.id === result.body.id).name, 'ช่างทดสอบ');
    });
    await t.test('CSRF, malformed bodies and overposting are rejected', async () => {
      assert.equal((await call('/employees', 'POST', { code: 'X', name: 'X' }, admin, { Origin: 'https://evil.example' })).status, 403);
      assert.equal((await call('/employees', 'POST', null, admin)).status, 400);
      assert.equal((await call('/users/' + readerId, 'PUT', { username: 'reader', name: 'อ่าน', role_id: 999, active: true }, admin)).status, 400);
    });
    await t.test('disabled users and changed passwords revoke existing sessions', async () => {
      assert.equal((await call('/users/' + readerId, 'PUT', { username: 'reader', name: 'อ่าน', role_id: role, active: false }, admin)).status, 200);
      assert.equal((await call('/me', 'GET', undefined, reader)).status, 401);
      assert.equal((await call('/password', 'POST', { current: password, password: 'updated-strong-password' }, admin)).status, 200);
      assert.equal((await call('/me', 'GET', undefined, admin)).status, 401);
      admin = (await call('/login', 'POST', { username: 'admin', password: 'updated-strong-password' })).cookie;
    });
    await t.test('a deleted account releases its employee link for a replacement account', async () => {
      assert.equal((await call('/users/' + readerId, 'PUT', { username: 'reader', name: 'อ่าน', role_id: role, employee_id: employee, active: false }, admin)).status, 200);
      assert.equal((await call('/users/' + readerId, 'DELETE', undefined, admin)).status, 200);
      assert.equal((await call('/users', 'POST', { username: 'reader-replacement', name: 'ผู้อ่านใหม่', password, role_id: role, employee_id: employee, active: true }, admin)).status, 201);
    });
    await t.test('concurrent account creation cannot leave an active user on an archived employee', async () => {
      const target = (await call('/employees', 'POST', { code: 'RACE', name: 'ทดสอบงานพร้อมกัน' }, admin)).body.id;
      const pending = call('/users', 'POST', { username: 'race-user', name: 'ทดสอบ', password, role_id: role, employee_id: target, active: true }, admin);
      await new Promise(r => setTimeout(r, 5));
      assert.equal((await call('/employees/' + target, 'DELETE', undefined, admin)).status, 200);
      await pending;
      const users = (await call('/users', 'GET', undefined, admin)).body.items;
      assert.ok(!users.some(u => u.employee_id === target && u.active));
    });
    await t.test('archive preserves records, audit excludes secrets, logout invalidates token', async () => {
      assert.equal((await call('/employees/' + employee, 'DELETE', undefined, admin)).status, 200);
      assert.equal((await call('/employees', 'GET', undefined, admin)).body.items[0].archived, 1);
      const audit = await call('/audit', 'GET', undefined, admin);
      assert.ok(audit.body.items.length > 0);
      assert.ok(!JSON.stringify(audit.body).includes(password));
      assert.equal((await call('/logout', 'POST', {}, admin)).status, 200);
      assert.equal((await call('/me', 'GET', undefined, admin)).status, 401);
    });
    await t.test('records survive application restart', async () => {
      await app.close();
      app = createApp({ databasePath });
      await new Promise(r => app.server.listen(0, '127.0.0.1', r));
      base = `http://127.0.0.1:${app.server.address().port}`;
      admin = (await call('/login', 'POST', { username: 'admin', password: 'updated-strong-password' })).cookie;
      assert.ok((await call('/employees', 'GET', undefined, admin)).body.items.some(e => e.code === 'EMP001'));
      assert.equal((await call('/setup')).body.required, false);
    });
  } finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
});
