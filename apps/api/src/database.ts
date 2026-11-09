import pg from 'pg';
export type Db = pg.Pool | pg.PoolClient;
export const PERMISSIONS: Record<string,string> = {
  'employees.read':'ดูข้อมูลพนักงาน','employees.create':'เพิ่มพนักงาน','employees.update':'แก้ไขพนักงาน','employees.delete':'ลบพนักงาน',
  'positions.manage':'จัดการตำแหน่งงาน','users.manage':'จัดการบัญชีผู้ใช้','roles.manage':'จัดการบทบาทและสิทธิ์','audit.read':'ดูประวัติการเปลี่ยนแปลง'
};
export async function all(db:Db,sql:string,values:unknown[]=[]){return (await db.query(sql,values)).rows;}
export async function one(db:Db,sql:string,values:unknown[]=[]){return (await all(db,sql,values))[0];}
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
    const roles=[[1,'ผู้ดูแลระบบ',Object.keys(PERMISSIONS)],[2,'ผู้บันทึกข้อมูล',['employees.read','employees.create','employees.update']],[3,'ดูข้อมูล',['employees.read']]];
    for(const [id,name,permissions] of roles) await db.query('INSERT INTO roles(id,name,permissions) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING',[id,name,JSON.stringify(permissions)]);
    await db.query("SELECT setval(pg_get_serial_sequence('roles','id'),GREATEST((SELECT max(id) FROM roles),1))");
  });
}
