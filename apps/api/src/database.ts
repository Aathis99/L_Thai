import pg from 'pg';
import { migratePressing } from './pressing/schema.js';

export type Db = pg.Pool | pg.PoolClient;
const pressingPermissions = {
  'pressing.read': 'ดูข้อมูลงานปั๊ม',
  'pressing.manage': 'จัดการทะเบียนและใบสั่งผลิต',
  'pressing.record': 'บันทึกยอดปั๊ม',
  'pressing.issue': 'ยืนยันเบิกสต็อกงานปั๊ม',
  'pressing.release': 'ปล่อยยอดปั๊มส่วนเกิน',
  'pressing.sort': 'ส่งผลคัดหลังเผา',
  'pressing.correct': 'ปรับยอดงานปั๊ม',
};
export const PERMISSIONS: Record<string,string> = {
  'employees.read':'ดูข้อมูลพนักงาน','employees.create':'เพิ่มพนักงาน','employees.update':'แก้ไขพนักงาน','employees.delete':'ลบพนักงาน',
  'positions.manage':'จัดการตำแหน่งงาน','users.manage':'จัดการบัญชีผู้ใช้','roles.manage':'จัดการบทบาทและสิทธิ์','audit.read':'ดูประวัติการเปลี่ยนแปลง',
  ...pressingPermissions,
};
export const baselineRoles = [
  { id: 1, name: 'ผู้ดูแลระบบ', permissions: Object.keys(PERMISSIONS) },
  { id: 2, name: 'ผู้บันทึกข้อมูล', permissions: ['employees.read', 'employees.create', 'employees.update'] },
  { id: 3, name: 'ดูข้อมูล', permissions: ['employees.read'] },
];
export async function all(db:Db,sql:string,values:unknown[]=[]){return (await db.query(sql,values)).rows;}
export async function one(db:Db,sql:string,values:unknown[]=[]){return (await all(db,sql,values))[0];}
export function audit(db: Db, actor: string, action: string, target: string) {
  return db.query('INSERT INTO audit(actor,action,target) VALUES($1,$2,$3)', [actor, action, target]);
}
export async function grantAdminPressingPermissions(db: Db): Promise<void> {
  const admin = await one(db, 'SELECT permissions FROM roles WHERE id=1');
  if (!admin) return;
  const permissions: string[] = JSON.parse(admin.permissions);
  const missing = Object.keys(pressingPermissions).filter(permission => !permissions.includes(permission));
  if (missing.length)
    await db.query('UPDATE roles SET permissions=$1 WHERE id=1', [JSON.stringify([...permissions, ...missing])]);
}
export async function transaction<T>(pool:pg.Pool,work:(db:pg.PoolClient)=>Promise<T>):Promise<T>{
  const client=await pool.connect();
  try { await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock(20261109)'); const value=await work(client); await client.query('COMMIT'); return value; }
  catch(error){await client.query('ROLLBACK');throw error;} finally{client.release();}
}
export async function migrate(pool:pg.Pool){
  await transaction(pool,async db=>{
    await db.query(`
      CREATE TABLE IF NOT EXISTS roles(id SERIAL PRIMARY KEY,name TEXT NOT NULL UNIQUE,permissions TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS positions(id SERIAL PRIMARY KEY,name TEXT NOT NULL UNIQUE);
      CREATE TABLE IF NOT EXISTS employees(id SERIAL PRIMARY KEY,code TEXT NOT NULL,name TEXT NOT NULL,department TEXT NOT NULL DEFAULT '',
        position_id INTEGER REFERENCES positions(id),phone TEXT NOT NULL DEFAULT '',active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
        archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN(0,1)),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE UNIQUE INDEX IF NOT EXISTS employees_code_unique ON employees(lower(code));
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS social_security_number TEXT NOT NULL DEFAULT '';
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS taxpayer_id TEXT NOT NULL DEFAULT '';
      CREATE TABLE IF NOT EXISTS users(id SERIAL PRIMARY KEY,username TEXT NOT NULL,name TEXT NOT NULL,password_hash TEXT NOT NULL,
        role_id INTEGER NOT NULL REFERENCES roles(id),employee_id INTEGER UNIQUE REFERENCES employees(id),
        active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN(0,1)));
      CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique ON users(lower(username));
      CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),expires BIGINT NOT NULL);
      CREATE INDEX IF NOT EXISTS sessions_user_index ON sessions(user_id);
      CREATE TABLE IF NOT EXISTS audit(id SERIAL PRIMARY KEY,actor TEXT NOT NULL,action TEXT NOT NULL,target TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS data_migrations(key TEXT PRIMARY KEY,details JSONB NOT NULL DEFAULT '{}',created_at TIMESTAMPTZ NOT NULL DEFAULT now());
    `);
    await migratePressing(db);
    for (const { id, name, permissions } of baselineRoles)
      await db.query('INSERT INTO roles(id,name,permissions) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING',[id,name,JSON.stringify(permissions)]);
    await grantAdminPressingPermissions(db);
    await db.query("SELECT setval(pg_get_serial_sequence('roles','id'),GREATEST((SELECT max(id) FROM roles),1))");
  });
}
