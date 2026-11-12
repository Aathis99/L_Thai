import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
import sharp from 'sharp';
import { createApplication } from '../src/app.js';
import { migrate } from '../src/database.js';

dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl, 'DATABASE_URL is required for color chart image API tests');

async function fixture(t: TestContext) {
  const schema = `color_chart_image_test_${randomUUID().replaceAll('-', '')}`;
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
  const password = 'test-password-long-enough';
  const json = (path: string, data: object, cookie = '') => fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify(data),
  });
  assert.equal((await json('/setup', { username: 'admin', name: 'ผู้ดูแล', password })).status, 201);
  async function login(username: string) {
    const response = await json('/login', { username, password });
    assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie);
    return cookie;
  }
  const admin = await login('admin');
  async function user(username: string, permissions: string[]) {
    const role = await json('/roles', { name: username, permissions }, admin);
    assert.equal(role.status, 201);
    const { id: role_id } = await role.json();
    assert.equal((await json('/users', { username, name: username, role_id, password }, admin)).status, 201);
    return login(username);
  }
  const entry = { name: 'ดินแดง', note: 'ระวังการเผา' };
  const created = await json('/color-chart', entry, admin);
  assert.equal(created.status, 201);
  const { id } = await created.json();
  const chart = '/color-chart';
  const imagePath = `${chart}/${id}/image`;
  const request = (path: string, method = 'GET', cookie = admin, body?: string) =>
    fetch(base + path, {
      method, body, headers: body === undefined ? { cookie } : { cookie, 'Content-Type': 'application/json' },
    });
  const upload = (body: Buffer, type = 'image/png', cookie = admin, headers: Record<string, string> = {}) =>
    fetch(base + imagePath, { method: 'PUT', headers: { 'Content-Type': type, cookie, ...headers }, body });
  return { base, pool, chart, entry, id, imagePath, request, upload, user };
}

function solidImage(width: number, height: number, background = 'red') {
  return sharp({ create: { width, height, background, channels: 3 } });
}

async function imageBytes(response: Response) {
  assert.equal(response.status, 200);
  return Buffer.from(await response.arrayBuffer());
}

test('view permission reads the WebP photo while both permissions are required to change it', async t => {
  const { chart, id, imagePath, request, upload, user } = await fixture(t);
  const reader = await user('reader', ['color_chart.read']);
  const manager = await user('manager', ['color_chart.manage']);
  const source = await solidImage(1300, 650).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  assert.equal((await request(imagePath)).status, 404);
  const saved = await upload(source, 'image/jpeg');
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { id });

  const photo = await request(imagePath, 'GET', reader);
  assert.equal(photo.headers.get('content-type'), 'image/webp');
  assert.equal(photo.headers.get('cache-control'), 'no-store');
  assert.equal(photo.headers.get('x-content-type-options'), 'nosniff');
  const before = await imageBytes(photo);
  const metadata = await sharp(before).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width, 512);
  assert.equal(metadata.height, 1024);
  assert.equal(metadata.orientation, undefined);
  assert.ok(before.length <= 256 * 1024);
  assert.equal((await request(chart, 'GET', reader)).status, 200);
  assert.equal((await request(imagePath, 'GET', '')).status, 401);
  assert.equal((await request(imagePath, 'GET', manager)).status, 403);

  // Malformed bytes exercise permission checks before decoding.
  const invalid = Buffer.from('invalid');
  assert.equal((await upload(invalid, 'image/png', '')).status, 401);
  for (const cookie of [reader, manager]) {
    assert.equal((await upload(invalid, 'image/png', cookie)).status, 403);
    assert.equal((await request(imagePath, 'DELETE', cookie)).status, 403);
  }
  assert.deepEqual(await imageBytes(await request(imagePath)), before);
});

test('rejected image uploads preserve the previously stored bytes', async t => {
  const { imagePath, request, upload } = await fixture(t);
  const source = await solidImage(50, 50).png().toBuffer();
  assert.equal((await upload(source)).status, 200);
  const before = await imageBytes(await request(imagePath));
  const animation = await sharp(Buffer.from([255, 0, 0, 0, 255, 0]), {
    raw: { width: 1, height: 2, channels: 3, pageHeight: 1 },
  }).webp().toBuffer();
  // A 1-by-1 APNG with two frames. Sharp's PNG decoder exposes only the first frame.
  const animatedPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACGFjVEwAAAACAAAAAPONk3AAAAAaZmNUTAAAAAAAAAABAAAAAQAAAAAAAAAAAAEACgAAWn8w0AAAAAxJREFUeJxj+M/AAAADAQEAyf6S7wAAABpmY1RMAAAAAQAAAAEAAAABAAAAAAAAAAAAAQAKAADBDNoEAAAAEGZkQVQAAAACeJxjYPjPAAACAgEAGz+uYAAAAABJRU5ErkJggg==',
    'base64',
  );
  const highPixelCount = await solidImage(7000, 7000).png().toBuffer();
  const cases = [
    { label: 'fake bytes', type: 'image/png', bytes: Buffer.from('invalid'), status: 400 },
    { label: 'truncated PNG', type: 'image/png', bytes: source.subarray(0, 50), status: 400 },
    { label: 'JPEG label on PNG data', type: 'image/jpeg', bytes: source, status: 400 },
    { label: 'unsupported MIME', type: 'application/json', bytes: source, status: 415 },
    { label: 'more than 8 MiB', type: 'image/png', bytes: Buffer.alloc(8 * 1024 * 1024 + 1), status: 413 },
    { label: 'too many pixels', type: 'image/png', bytes: highPixelCount, status: 400 },
    { label: 'animated WebP', type: 'image/webp', bytes: animation, status: 400 },
    { label: 'animated PNG', type: 'image/png', bytes: animatedPng, status: 400 },
  ];
  for (const { label, type, bytes, status } of cases) {
    assert.equal((await upload(bytes, type)).status, status, label);
    const after = await imageBytes(await request(imagePath));
    assert.deepEqual(after, before, label);
  }
});

test('cross-origin and invalid Host image writes remain forbidden, with ordinary JSON limits unchanged', async t => {
  const { base, chart, id, imagePath, request, upload } = await fixture(t);
  const source = await solidImage(5, 5).png().toBuffer();
  assert.equal((await upload(source, 'image/png', undefined, { origin: 'https://example.com' })).status, 403);
  const invalidHostStatus = await new Promise((resolve, reject) => {
    const req = httpRequest(base + imagePath, { method: 'PUT', headers: { host: 'example.com' } }, res => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(invalidHostStatus, 403);
  assert.equal((await request(imagePath)).status, 404);
  assert.equal((await upload(source, 'image/png', undefined, { origin: 'http://localhost:3000' })).status, 200);
  assert.equal((await fetch(`${base}${chart}/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: source,
  })).status, 415);
  const largeJson = JSON.stringify({ name: 'x'.repeat(32 * 1024) });
  assert.equal((await request(`${chart}/${id}`, 'PUT', undefined, largeJson)).status, 413);
});

test('a highly textured image is stored within the WebP size limit', async t => {
  const { imagePath, request, upload } = await fixture(t);
  const source = await sharp({
    create: { width: 1024, height: 1024, channels: 3, noise: { type: 'gaussian', mean: 127, sigma: 90 } },
  }).png().toBuffer();
  assert.equal((await upload(source)).status, 200);
  const encoded = await imageBytes(await request(imagePath));
  assert.ok(encoded.length <= 256 * 1024);
  const { format } = await sharp(encoded).metadata();
  assert.equal(format, 'webp');
});

test('replacing or removing a photo leaves the entry intact and deleting the entry cascades', async t => {
  const { pool, chart, entry, id, imagePath, request, upload } = await fixture(t);
  const list = async (hasImage: boolean) => {
    const response = await request(chart);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      items: [{ id, display_order: 1, ...entry, has_image: hasImage }],
    });
  };
  await list(false);
  const first = await solidImage(50, 50).png().toBuffer();
  const second = await solidImage(60, 60, 'blue').webp().toBuffer();
  assert.equal((await upload(first)).status, 200);
  const before = await imageBytes(await request(imagePath));
  assert.equal((await upload(second, 'image/webp')).status, 200);
  const after = await imageBytes(await request(imagePath));
  assert.notDeepEqual(after, before);
  await list(true);

  const deleted = await request(imagePath, 'DELETE');
  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), { id });
  assert.equal((await request(imagePath)).status, 404);
  assert.equal((await request(imagePath, 'DELETE')).status, 200);
  await list(false);

  assert.equal((await upload(first)).status, 200);
  assert.equal((await request(`${chart}/${id}`, 'DELETE')).status, 200);
  assert.equal((await request(imagePath)).status, 404);
  assert.equal((await pool.query('SELECT entry_id FROM color_chart_images WHERE entry_id=$1', [id])).rowCount, 0);
  assert.deepEqual((await pool.query("SELECT actor,action,target FROM audit WHERE action LIKE '%ภาพชาร์ตสี' ORDER BY id")).rows, [
    { actor: 'admin', action: 'บันทึกภาพชาร์ตสี', target: String(id) },
    { actor: 'admin', action: 'บันทึกภาพชาร์ตสี', target: String(id) },
    { actor: 'admin', action: 'ลบภาพชาร์ตสี', target: String(id) },
    { actor: 'admin', action: 'บันทึกภาพชาร์ตสี', target: String(id) },
  ]);
});
