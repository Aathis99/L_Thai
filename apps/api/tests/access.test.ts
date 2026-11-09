import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import dotenv from 'dotenv';
import { resolve } from 'node:path';
dotenv.config({path:resolve('../../.env'),quiet:true});

test('Express/PostgreSQL access lifecycle preserves authorization and transactional safeguards', async t => {
  let createApplication: any;
  try { ({ createApplication } = await import('../src/app.js')); } catch {}
  assert.equal(typeof createApplication, 'function', 'Express PostgreSQL implementation must exist');
  const { migrate } = await import('../src/database.js');
  const schema = 'test_' + randomUUID().replaceAll('-', '');
  const adminPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  await adminPool.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}` });
  await migrate(pool);
  const { server } = createApplication(pool, { origins:['http://127.0.0.1:3000'] });
  await new Promise<void>(r => server.listen(0,'127.0.0.1',r));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api`;
  async function call(path:string, method='GET', data?:unknown, cookie='', origin?:string) {
    const response = await fetch(base+path,{method,headers:{'Content-Type':'application/json',cookie,...(origin?{Origin:origin}:{})},body:data===undefined?undefined:JSON.stringify(data)});
    return {status:response.status,body:await response.json() as any,cookie:response.headers.get('set-cookie')?.split(';')[0]||''};
  }
  let admin='', reader=''; const password='test-password-long-enough';
  let employee=0, userId=0, role=0;
  try {
    await t.test('setup once, no credentials by default, login and hashed storage',async()=>{
      assert.equal((await call('/setup')).body.required,true);
      assert.equal((await call('/me')).status,401);
      assert.equal((await call('/setup','POST',{username:'admin',name:'ผู้ดูแล',password:'short'})).status,400);
      assert.equal((await call('/setup','POST',{username:'admin',name:'ผู้ดูแล',password})).status,201);
      assert.equal((await call('/setup','POST',{username:'other',name:'อื่น',password})).status,409);
      assert.equal((await call('/login','POST',{username:'admin',password:'wrong'})).status,401);
      admin=(await call('/login','POST',{username:'ADMIN',password})).cookie; assert.ok(admin);
      assert.equal((await call('/me','GET',undefined,admin)).body.user.username,'admin');
      assert.notEqual((await pool.query('SELECT password_hash FROM users')).rows[0].password_hash,password);
    });
    await t.test('employee and position CRUD, Thai text, duplicate and foreign key validation',async()=>{
      const position=(await call('/positions','POST',{name:'ธุรการ'},admin)).body.id;
      employee=(await call('/employees','POST',{code:'EMP001',name:'สมใจ ทดสอบ',position_id:position,phone:'081-0000000',social_security_number:'0000000000001',taxpayer_id:'0000000000002'},admin)).body.id;
      assert.ok(employee);
      const profile=(await call('/employees','GET',undefined,admin)).body.items[0];
      assert.equal(profile.social_security_number,'0000000000001');
      assert.equal(profile.taxpayer_id,'0000000000002');
      assert.equal((await call('/employees','POST',{code:'BAD-ID',name:'ทดสอบ',taxpayer_id:'invalid'},admin)).status,400);
      assert.equal((await call('/employees','POST',{code:'emp001',name:'ชื่อซ้ำ'},admin)).status,409);
      assert.equal((await call('/positions/'+position,'DELETE',undefined,admin)).status,409);
      assert.equal((await call('/employees/'+employee,'PUT',{code:'EMP001',name:'สมใจ แก้ไข',position_id:99999},admin)).status,400);
      assert.equal((await call('/employees/'+employee,'PUT',{code:'EMP001',name:'สมใจ แก้ไข',position_id:position,active:true},admin)).status,200);
      assert.equal((await call('/employees','GET',undefined,admin)).body.items[0].name,'สมใจ แก้ไข');
      assert.equal((await call('/employees','GET',undefined,admin)).body.items[0].taxpayer_id,'0000000000002');
    });
    await t.test('reader denied writes, role edits apply immediately, role references cannot be deleted',async()=>{
      role=(await call('/roles','POST',{name:'อ่านพนักงาน',permissions:['employees.read']},admin)).body.id;
      userId=(await call('/users','POST',{username:'reader',name:'ผู้อ่าน',role_id:role,employee_id:employee,password,active:true},admin)).body.id;
      reader=(await call('/login','POST',{username:'reader',password})).cookie;
      assert.equal((await call('/employees','GET',undefined,reader)).status,200);
      assert.equal((await call('/employees','POST',{code:'BAD',name:'ไม่มีสิทธิ์'},reader)).status,403);
      assert.equal((await call('/users','GET',undefined,reader)).status,403);
      assert.equal((await call('/roles/'+role,'PUT',{name:'พักสิทธิ์',permissions:[]},admin)).status,200);
      assert.equal((await call('/employees','GET',undefined,reader)).status,403);
      assert.equal((await call('/roles/'+role,'DELETE',undefined,admin)).status,409);
    });
    await t.test('last admin protected via user and employee paths',async()=>{
      const own=(await call('/employees','POST',{code:'ADMIN',name:'ผู้ดูแล'},admin)).body.id;
      const id=(await call('/me','GET',undefined,admin)).body.user.id;
      assert.equal((await call('/users/'+id,'DELETE',undefined,admin)).status,409);
      assert.equal((await call('/users/'+id,'PUT',{username:'admin',name:'ผู้ดูแล',role_id:role,active:true},admin)).status,409);
      assert.equal((await call('/users/'+id,'PUT',{username:'admin',name:'ผู้ดูแล',role_id:1,employee_id:own,active:true},admin)).status,200);
      assert.equal((await call('/employees/'+own,'DELETE',undefined,admin)).status,409);
      assert.equal((await call('/roles/1','PUT',{name:'ไม่อนุญาต',permissions:[]},admin)).status,409);
    });
    await t.test('cross-origin and malformed JSON denied with useful errors',async()=>{
      assert.equal((await call('/employees','POST',{code:'X',name:'X'},admin,'https://evil.example')).status,403);
      assert.equal((await call('/employees','POST',null,admin)).status,400);
      assert.equal((await call('/roles','POST',{name:'X',permissions:['everything']},admin)).status,400);
    });
    await t.test('deleting an account releases employee link and invalidates sessions',async()=>{
      assert.equal((await call('/users/'+userId,'DELETE',undefined,admin)).status,200);
      assert.equal((await call('/me','GET',undefined,reader)).status,401);
      assert.equal((await call('/users','POST',{username:'replacement',name:'ใหม่',role_id:role,employee_id:employee,password},admin)).status,201);
    });
    await t.test('concurrent creation and archival cannot leave active linked user',async()=>{
      const target=(await call('/employees','POST',{code:'RACE',name:'ทดสอบพร้อมกัน'},admin)).body.id;
      const pending=call('/users','POST',{username:'race',name:'ทดสอบ',role_id:role,employee_id:target,password},admin);
      await new Promise(r=>setTimeout(r,5));
      assert.equal((await call('/employees/'+target,'DELETE',undefined,admin)).status,200);
      await pending;
      assert.equal(Number((await pool.query('SELECT count(*) FROM users WHERE employee_id=$1 AND active=1',[target])).rows[0].count),0);
    });
    await t.test('password changes revoke sessions, audit excludes secrets, logout and expiration work',async()=>{
      assert.equal((await call('/password','POST',{current:password,password:'new-test-password-long'},admin)).status,200);
      assert.equal((await call('/me','GET',undefined,admin)).status,401);
      admin=(await call('/login','POST',{username:'admin',password:'new-test-password-long'})).cookie;
      const audit=await call('/audit','GET',undefined,admin);
      assert.ok(audit.body.items.length>0); assert.ok(!JSON.stringify(audit.body).includes(password));
      assert.equal((await call('/logout','POST',{},admin)).status,200);
      assert.equal((await call('/me','GET',undefined,admin)).status,401);
      admin=(await call('/login','POST',{username:'admin',password:'new-test-password-long'})).cookie;
      await pool.query('UPDATE sessions SET expires=0');
      assert.equal((await call('/me','GET',undefined,admin)).status,401);
    });
  } finally {
    await new Promise<void>(r=>{server.close(()=>r());server.closeIdleConnections();});
    await pool.end(); await adminPool.query(`DROP SCHEMA ${schema} CASCADE`); await adminPool.end();
  }
});
