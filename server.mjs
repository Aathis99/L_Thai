import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { openStore, PERMISSIONS, InputError, text, username, hashPassword, verifyPassword } from './lib/store.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const digest = value => createHash('sha256').update(value).digest('hex');
const fail = (message, status = 400) => { throw new InputError(message, status); };
export function createApp({ databasePath = join(root, 'data', 'factory.sqlite') } = {}) {
  const db = openStore(databasePath);
  const attempts = new Map();
  const dummyHash = '0'.repeat(32) + ':' + '0'.repeat(128);
  const log = (actor, action, target) => db.prepare('INSERT INTO audit(actor,action,target) VALUES(?,?,?)').run(actor, action, target);
  const transaction = fn => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; } catch (e) { db.exec('ROLLBACK'); throw e; }
  };
  function foreign(table, value, label, optional = false) {
    if (optional && (value === null || value === '' || value === undefined)) return null;
    if (!Number.isSafeInteger(value) || !db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(value)) fail(`ไม่พบ${label}ที่เลือก`);
    if (table === 'employees' && db.prepare('SELECT archived FROM employees WHERE id=?').get(value).archived) fail('ไม่สามารถเชื่อมบัญชีกับพนักงานที่ลบแล้ว');
    return value;
  }
  function flag(value) { if (typeof value !== 'boolean') fail('สถานะต้องเป็นเปิดหรือปิดใช้งาน'); return Number(value); }
  function roleData(body) {
    if (!Array.isArray(body.permissions) || body.permissions.some(p => !Object.hasOwn(PERMISSIONS, p))) fail('รายการสิทธิ์ไม่ถูกต้อง');
    return [text(body.name, 'ชื่อบทบาท', true, 80), JSON.stringify([...new Set(body.permissions)])];
  }
  function employeeData(body) {
    return [text(body.code, 'รหัสพนักงาน', true, 40), text(body.name, 'ชื่อพนักงาน'), text(body.department, 'แผนก', false, 80), foreign('positions', body.position_id, 'ตำแหน่ง', true), text(body.phone, 'เบอร์โทร', false, 30), flag(body.active ?? true)];
  }
  function protectLastAdmin(existing, nextRole, active) {
    if (existing.role_id === 1 && existing.active && (!active || nextRole !== 1)) {
      if (db.prepare('SELECT count(*) AS n FROM users WHERE role_id=1 AND active=1 AND deleted=0').get().n <= 1) fail('ต้องเหลือผู้ดูแลระบบที่ใช้งานได้อย่างน้อย 1 คน', 409);
    }
  }
  const server = createServer(async (req, res) => {
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const host = req.headers.host || '';
      if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) fail('Host ไม่ได้รับอนุญาต', 403);
      const url = new URL(req.url, `http://${host}`);
      const path = url.pathname;
      if (!path.startsWith('/api/')) {
        const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
        if (req.method !== 'GET' || !files[path]) { res.writeHead(404); return res.end('Not found'); }
        const [file, mime] = files[path];
        res.writeHead(200, { 'Content-Type': `${mime}; charset=utf-8` });
        return res.end(await readFile(join(root, 'public', file)));
      }
      const method = req.method;
      let body = {};
      if (!['GET', 'HEAD'].includes(method)) {
        if (req.headers.origin && req.headers.origin !== `http://${host}`) fail('ไม่อนุญาตคำขอจากเว็บไซต์อื่น', 403);
        if (!req.headers['content-type']?.startsWith('application/json')) fail('ต้องส่งข้อมูล JSON', 415);
        const chunks = []; let bytes = 0;
        for await (const chunk of req) { bytes += chunk.length; if (bytes > 32768) fail('ข้อมูลมีขนาดใหญ่เกินไป', 413); chunks.push(chunk); }
        const raw = Buffer.concat(chunks).toString('utf8');
        try { body = JSON.parse(raw || '{}'); } catch { fail('รูปแบบข้อมูลไม่ถูกต้อง'); }
        if (!body || Array.isArray(body) || typeof body !== 'object') fail('ข้อมูลต้องเป็น JSON object');
      }
      const setupRequired = () => !db.prepare('SELECT id FROM users LIMIT 1').get();
      if (path === '/api/setup' && method === 'GET') return json(200, { required: setupRequired() });
      if (path === '/api/setup' && method === 'POST') {
        if (!setupRequired()) fail('ตั้งผู้ดูแลระบบแล้ว', 409);
        const user = username(body.username), name = text(body.name, 'ชื่อผู้ดูแล'), hash = await hashPassword(body.password);
        const id = transaction(() => {
          if (!setupRequired()) fail('ตั้งผู้ดูแลระบบแล้ว', 409);
          const result = db.prepare('INSERT INTO users(username,name,password_hash,role_id) VALUES(?,?,?,1)').run(user, name, hash);
          log(user, 'ตั้งผู้ดูแลระบบ', user); return Number(result.lastInsertRowid);
        });
        return json(201, { id });
      }
      if (path === '/api/login' && method === 'POST') {
        const key = req.socket.remoteAddress;
        let bucket = attempts.get(key);
        if (!bucket || bucket.until < Date.now()) { bucket = { n: 0, until: Date.now() + 900000 }; attempts.set(key, bucket); }
        if (bucket.n >= 10) fail('ลองเข้าสู่ระบบมากเกินไป กรุณารอ 15 นาที', 429);
        const user = db.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE AND deleted=0').get(typeof body.username === 'string' ? body.username.trim() : '');
        bucket.n++;
        const valid = await verifyPassword(body.password, user?.password_hash || dummyHash);
        // Re-read after asynchronous hashing so an account disabled during login stays disabled.
        const current = user && db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
        if (!valid || !current?.active || current.deleted || current.password_hash !== user.password_hash) fail('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง', 401);
        attempts.delete(key);
        const token = randomBytes(32).toString('hex');
        transaction(() => {
          db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
          db.prepare('INSERT INTO sessions(token_hash,user_id,expires) VALUES(?,?,?)').run(digest(token), user.id, Date.now() + 28800000);
        });
        res.setHeader('Set-Cookie', `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`);
        return json(200, { ok: true });
      }
      const token = (req.headers.cookie || '').match(/(?:^|;\s*)session=([a-f0-9]{64})(?:;|$)/)?.[1];
      const user = token && db.prepare(`SELECT u.id,u.username,u.name,u.role_id,u.employee_id,r.name AS role_name,r.permissions FROM sessions s
        JOIN users u ON u.id=s.user_id JOIN roles r ON r.id=u.role_id
        WHERE s.token_hash=? AND s.expires>? AND u.active=1 AND u.deleted=0`).get(digest(token), Date.now());
      if (!user) fail('กรุณาเข้าสู่ระบบใหม่', 401);
      user.permissions = JSON.parse(user.permissions);
      const requirePermission = permission => { if (!user.permissions.includes(permission)) fail('คุณไม่มีสิทธิ์ทำรายการนี้', 403); };
      if (path === '/api/me' && method === 'GET') return json(200, { user, permissions: PERMISSIONS });
      if (path === '/api/logout' && method === 'POST') {
        db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token));
        res.setHeader('Set-Cookie', 'session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
        return json(200, { ok: true });
      }
      if (path === '/api/password' && method === 'POST') {
        const previous = db.prepare('SELECT password_hash FROM users WHERE id=?').get(user.id).password_hash;
        if (!await verifyPassword(body.current, previous)) fail('รหัสผ่านเดิมไม่ถูกต้อง');
        const hash = await hashPassword(body.password);
        transaction(() => {
          const current = db.prepare('SELECT password_hash,active,deleted FROM users WHERE id=?').get(user.id);
          if (!current.active || current.deleted || current.password_hash !== previous) fail('ข้อมูลบัญชีเปลี่ยนแล้ว กรุณาเข้าสู่ระบบใหม่', 409);
          db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, user.id);
          db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id); log(user.username, 'เปลี่ยนรหัสผ่าน', user.username);
        });
        return json(200, { ok: true });
      }
      const route = path.match(/^\/api\/(employees|positions|users|roles|audit)(?:\/([1-9]\d*))?$/);
      if (!route) fail('ไม่พบรายการ', 404);
      const [, resource, rawId] = route, id = rawId ? Number(rawId) : null;
      if (id && !Number.isSafeInteger(id)) fail('รหัสรายการไม่ถูกต้อง');
      if (resource === 'employees') requirePermission(`employees.${method === 'GET' ? 'read' : method === 'POST' ? 'create' : method === 'PUT' ? 'update' : 'delete'}`);
      else if (resource === 'positions' && method === 'GET' && user.permissions.includes('employees.read')) {} // Needed to display employee position names.
      else if (resource === 'roles' && method === 'GET' && user.permissions.includes('users.manage')) {}
      else requirePermission(resource === 'audit' ? 'audit.read' : `${resource}.manage`);
      if (method === 'GET' && !id) {
        let items;
        if (resource === 'employees') items = db.prepare('SELECT e.*,p.name AS position_name FROM employees e LEFT JOIN positions p ON p.id=e.position_id ORDER BY e.archived,e.id DESC').all();
        if (resource === 'positions') items = db.prepare('SELECT * FROM positions ORDER BY name').all();
        if (resource === 'roles') items = db.prepare('SELECT * FROM roles ORDER BY id').all().map(r => ({ ...r, permissions: JSON.parse(r.permissions) }));
        if (resource === 'users') items = db.prepare('SELECT u.id,u.username,u.name,u.role_id,u.employee_id,u.active,r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id WHERE deleted=0 ORDER BY u.id').all();
        if (resource === 'audit') items = db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 300').all();
        return json(200, { items });
      }
      if (resource === 'audit' || !['POST', 'PUT', 'DELETE'].includes(method) || (method === 'POST' && id) || (method !== 'POST' && !id)) fail('ไม่รองรับรายการนี้', 405);
      const existing = id ? db.prepare(`SELECT * FROM ${resource} WHERE id=?`).get(id) : null;
      if (id && (!existing || existing.deleted || existing.archived)) fail('ไม่พบรายการหรือรายการถูกลบแล้ว', 404);
      let values, newHash;
      if (method !== 'DELETE') {
        if (resource === 'employees') values = employeeData(body);
        if (resource === 'positions') values = [text(body.name, 'ชื่อตำแหน่ง', true, 80)];
        if (resource === 'roles') { if (id === 1) fail('บทบาทผู้ดูแลระบบเป็นบทบาทสงวน', 409); values = roleData(body); }
        if (resource === 'users') {
          values = [username(body.username), text(body.name, 'ชื่อผู้ใช้งาน'), foreign('roles', body.role_id, 'บทบาท'), foreign('employees', body.employee_id, 'พนักงาน', true), flag(body.active ?? true)];
          if (method === 'POST' || body.password) newHash = await hashPassword(body.password);
        }
      }
      // Recheck the actor after any asynchronous password hashing; rights may have been revoked meanwhile.
      const actorNow = db.prepare('SELECT u.active,u.deleted,r.permissions FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=?').get(user.id);
      if (!actorNow?.active || actorNow.deleted || !token || !db.prepare('SELECT token_hash FROM sessions WHERE token_hash=? AND expires>?').get(digest(token), Date.now())) fail('กรุณาเข้าสู่ระบบใหม่', 401);
      const needed = resource === 'employees' ? `employees.${method === 'POST' ? 'create' : method === 'PUT' ? 'update' : 'delete'}` : `${resource}.manage`;
      if (!JSON.parse(actorNow.permissions).includes(needed)) fail('คุณไม่มีสิทธิ์ทำรายการนี้', 403);
      const savedId = transaction(() => {
        if (resource === 'users' && method !== 'DELETE') {
          foreign('roles', values[2], 'บทบาท');
          foreign('employees', values[3], 'พนักงาน', true);
        }
        const fresh = id ? db.prepare(`SELECT * FROM ${resource} WHERE id=?`).get(id) : null;
        if (id && (!fresh || fresh.deleted || fresh.archived)) fail('รายการเปลี่ยนแปลงแล้ว กรุณาโหลดใหม่', 409);
        let result;
        if (method === 'DELETE') {
          if (resource === 'employees') {
            const linkedAdmin = db.prepare('SELECT * FROM users WHERE employee_id=? AND role_id=1 AND active=1 AND deleted=0').get(id);
            if (linkedAdmin) protectLastAdmin(linkedAdmin, 1, false);
            db.prepare('UPDATE employees SET active=0,archived=1,updated_at=datetime(\'now\') WHERE id=?').run(id);
            db.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE employee_id=?)').run(id);
            db.prepare('UPDATE users SET active=0 WHERE employee_id=?').run(id);
          }
          if (resource === 'users') { protectLastAdmin(fresh, fresh.role_id, false); db.prepare('UPDATE users SET active=0,deleted=1,employee_id=NULL WHERE id=?').run(id); db.prepare('DELETE FROM sessions WHERE user_id=?').run(id); }
          if (resource === 'positions') {
            if (db.prepare('SELECT id FROM employees WHERE position_id=? LIMIT 1').get(id)) fail('ตำแหน่งนี้มีพนักงานอ้างอิงอยู่ กรุณาเปลี่ยนตำแหน่งพนักงานก่อน', 409);
            db.prepare('DELETE FROM positions WHERE id=?').run(id);
          }
          if (resource === 'roles') {
            if (id === 1 || db.prepare('SELECT id FROM users WHERE role_id=? LIMIT 1').get(id)) fail('ไม่สามารถลบบทบาทสงวนหรือบทบาทที่มีบัญชีอ้างอิงอยู่', 409);
            db.prepare('DELETE FROM roles WHERE id=?').run(id);
          }
        } else if (resource === 'employees') {
          result = method === 'POST' ? db.prepare('INSERT INTO employees(code,name,department,position_id,phone,active) VALUES(?,?,?,?,?,?)').run(...values)
            : db.prepare('UPDATE employees SET code=?,name=?,department=?,position_id=?,phone=?,active=?,updated_at=datetime(\'now\') WHERE id=?').run(...values, id);
        } else if (resource === 'positions') {
          result = method === 'POST' ? db.prepare('INSERT INTO positions(name) VALUES(?)').run(...values) : db.prepare('UPDATE positions SET name=? WHERE id=?').run(...values, id);
        } else if (resource === 'roles') {
          result = method === 'POST' ? db.prepare('INSERT INTO roles(name,permissions) VALUES(?,?)').run(...values) : db.prepare('UPDATE roles SET name=?,permissions=? WHERE id=?').run(...values, id);
        } else if (resource === 'users') {
          if (fresh) protectLastAdmin(fresh, values[2], values[4]);
          if (method === 'POST') result = db.prepare('INSERT INTO users(username,name,role_id,employee_id,active,password_hash) VALUES(?,?,?,?,?,?)').run(...values, newHash);
          else {
            result = db.prepare('UPDATE users SET username=?,name=?,role_id=?,employee_id=?,active=? WHERE id=?').run(...values, id);
            if (newHash) db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(newHash, id);
            if (newHash || !values[4]) db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
          }
        }
        const saved = id || Number(result.lastInsertRowid);
        log(user.username, ({ POST: 'เพิ่ม', PUT: 'แก้ไข', DELETE: 'ลบ' })[method] + ' ' + ({ employees: 'พนักงาน', positions: 'ตำแหน่ง', users: 'บัญชี', roles: 'บทบาท' })[resource], String(saved));
        return saved;
      });
      return json(method === 'POST' ? 201 : 200, { id: savedId, ok: true });
    } catch (e) {
      if (res.headersSent) return res.end();
      if (e instanceof InputError) return json(e.status, { error: e.message });
      if (e.code?.startsWith('ERR_SQLITE') && /UNIQUE constraint/.test(e.message)) return json(409, { error: 'รหัส ชื่อ หรือข้อมูลเชื่อมโยงนี้มีอยู่แล้ว กรุณาตรวจสอบรายการซ้ำ' });
      if (e.code?.startsWith('ERR_SQLITE') && /FOREIGN KEY constraint/.test(e.message)) return json(409, { error: 'ข้อมูลถูกใช้งานอยู่หรือข้อมูลที่อ้างอิงเปลี่ยนแปลง กรุณาโหลดใหม่' });
      console.error('Request failed:', e.code || e.name);
      return json(500, { error: 'ระบบไม่สามารถบันทึกได้ กรุณาลองใหม่' });
    }
  });
  return { server, db, close: () => new Promise((resolve, reject) => { server.close(e => { db.close(); e ? reject(e) : resolve(); }); server.closeIdleConnections(); }) };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createApp({ databasePath: process.env.DATABASE_PATH || undefined });
  const port = Number(process.env.PORT || 3000);
  app.server.listen(port, '127.0.0.1', () => console.log(`LThai Factory: http://127.0.0.1:${port}`));
  app.server.on('error', e => { console.error(e.code === 'EADDRINUSE' ? `พอร์ต ${port} ถูกใช้งานแล้ว` : e.message); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.close().then(() => process.exit(0)));
}
