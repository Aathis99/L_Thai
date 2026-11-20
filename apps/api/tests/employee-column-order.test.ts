import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { reorderEmployeeColumns } from '../src/employee-column-order.js';

const expectedDatabase = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).pathname.slice(1) : '';
const order = ['id','code','prefix','first_name','last_name','department','position_id','phone','active','archived','created_at','updated_at','social_security_number','taxpayer_id'];
let serial = 0;
async function fixture(work: (pool: pg.Pool) => Promise<void>) {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must target the restored QA database');
  const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const schema = `column_order_${process.pid}_${++serial}`;
  let pool: pg.Pool | undefined;
  try {
    assert.match(expectedDatabase,/^lthai_.*_qa$/);
    assert.equal((await admin.query('SELECT current_database() AS db')).rows[0].db, expectedDatabase);
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema},pg_catalog` });
    await pool.query(`CREATE TABLE positions(id integer PRIMARY KEY); INSERT INTO positions VALUES(1);
      CREATE TABLE employees(id SERIAL PRIMARY KEY,code text NOT NULL,department text NOT NULL DEFAULT '',
        position_id integer REFERENCES positions(id),phone text NOT NULL DEFAULT '',active integer NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
        archived integer NOT NULL DEFAULT 0 CHECK(archived IN(0,1)),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
        social_security_number text NOT NULL DEFAULT '',taxpayer_id text NOT NULL DEFAULT '',
        prefix text NOT NULL DEFAULT '' CONSTRAINT employee_prefix_length CHECK(char_length(prefix)<=40),
        first_name text NOT NULL CONSTRAINT employee_first_name_length CHECK(btrim(first_name)<>'' AND char_length(first_name)<=120),
        last_name text NOT NULL DEFAULT '' CONSTRAINT employee_last_name_length CHECK(char_length(last_name)<=120));
      CREATE UNIQUE INDEX employees_code_unique ON employees(lower(code));
      INSERT INTO employees(code,first_name,last_name,prefix,position_id,social_security_number,taxpayer_id,phone)
        VALUES('emp001','สมชาย','ใจดี','นาย',1,'0012345678901','0098765432109','0123456789');
      CREATE TABLE users(employee_id integer CONSTRAINT users_employee_id_fkey REFERENCES employees(id));
      CREATE TABLE pressing_entries(employee_id integer CONSTRAINT pressing_entries_employee_id_fkey REFERENCES employees(id));
      CREATE TABLE pressing_sort_results(employee_id integer CONSTRAINT pressing_sort_results_employee_id_fkey REFERENCES employees(id));
      CREATE TABLE glazing_batch_workers(employee_id integer CONSTRAINT glazing_batch_workers_employee_id_fkey REFERENCES employees(id));
      INSERT INTO users VALUES(1); INSERT INTO pressing_entries VALUES(1); INSERT INTO pressing_sort_results VALUES(1); INSERT INTO glazing_batch_workers VALUES(1);
      SELECT setval('employees_id_seq',401,false);`);
    await work(pool);
  } finally {
    await pool?.end();
    // This schema was created only after the database guard above.
    if ((await admin.query('SELECT current_database() AS db')).rows[0].db === expectedDatabase)
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
}
async function snapshot(pool: pg.Pool) {
  return {
    rows: (await pool.query('SELECT * FROM employees ORDER BY id')).rows,
    columns: (await pool.query(`SELECT a.attname,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull,pg_get_expr(d.adbin,d.adrelid) AS def
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid='employees'::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attname`)).rows,
    constraints: (await pool.query(`SELECT conname,contype,pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid='employees'::regclass OR confrelid='employees'::regclass ORDER BY conname`)).rows,
    indexes: (await pool.query(`SELECT indexname,indexdef FROM pg_indexes WHERE schemaname=current_schema() AND tablename='employees' ORDER BY indexname`)).rows,
    sequence: (await pool.query('SELECT last_value,is_called FROM employees_id_seq')).rows,
    owned: (await pool.query(`SELECT pg_get_serial_sequence('employees','id') AS sequence`)).rows,
    sequenceOid: (await pool.query(`SELECT 'employees_id_seq'::regclass::oid AS oid`)).rows,
  };
}
test('wrong database guard rejects before any change', async () => fixture(async pool => {
  const before = await snapshot(pool);
  await assert.rejects(reorderEmployeeColumns(pool, { expectedDatabase: 'not_this_database' }), /database/i);
  assert.deepEqual(await snapshot(pool), before);
}));
test('dry run leaves table OID, data, metadata and sequence untouched', async () => fixture(async pool => {
  const before = await snapshot(pool);
  const oid = (await pool.query(`SELECT 'employees'::regclass::oid AS oid`)).rows;
  assert.deepEqual(await reorderEmployeeColumns(pool, { expectedDatabase, dryRun: true }), { status: 'dry-run', employees: 1 });
  assert.deepEqual(await snapshot(pool), before);
  assert.deepEqual((await pool.query(`SELECT 'employees'::regclass::oid AS oid`)).rows, oid);
}));
test('rebuild preserves every row, five foreign keys, constraints, indexes, defaults and exact sequence state', async () => fixture(async pool => {
  const before = await snapshot(pool);
  assert.equal(before.constraints.filter(c => c.contype === 'f').length, 5);
  const oldOid = (await pool.query(`SELECT 'employees'::regclass::oid AS oid`)).rows[0].oid;
  assert.deepEqual(await reorderEmployeeColumns(pool, { expectedDatabase }), { status: 'reordered', employees: 1 });
  assert.deepEqual((await pool.query(`SELECT attname FROM pg_attribute WHERE attrelid='employees'::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum`)).rows.map(r => r.attname), order);
  assert.deepEqual(await snapshot(pool), before);
  const newOid = (await pool.query(`SELECT 'employees'::regclass::oid AS oid`)).rows[0].oid;
  assert.notEqual(newOid, oldOid);
  const fkTargets = (await pool.query(`SELECT confrelid FROM pg_constraint WHERE contype='f' AND confrelid=$1`, [newOid])).rows;
  assert.equal(fkTargets.length, 4);
  assert.equal((await pool.query('SELECT count(*) AS count FROM pg_constraint WHERE confrelid=$1', [oldOid])).rows[0].count,'0');
  for (const table of ['users','pressing_entries','pressing_sort_results','glazing_batch_workers'])
    await assert.rejects(pool.query(`INSERT INTO ${table} VALUES(9999)`), /foreign key/);
  await assert.rejects(pool.query(`INSERT INTO employees(code,first_name,position_id) VALUES('invalid','Test',9999)`), /foreign key/);
  const inserted = (await pool.query(`INSERT INTO employees(code,first_name) VALUES('emp002','เพิ่ม') RETURNING id,prefix,last_name,department,phone,active,archived,social_security_number,taxpayer_id`)).rows[0];
  // The failed outbound-FK INSERT consumed 401; the next successful INSERT must use 402.
  assert.equal(inserted.id, 402);
  assert.deepEqual({ ...inserted, id: 0 }, { id:0,prefix:'',last_name:'',department:'',phone:'',active:1,archived:0,social_security_number:'',taxpayer_id:'' });
}));
test('repeat skips without replacing table or losing subsequent edits', async () => fixture(async pool => {
  await reorderEmployeeColumns(pool, { expectedDatabase });
  await pool.query(`UPDATE employees SET phone='0999999999' WHERE id=1`);
  const before = await snapshot(pool);
  const oid = (await pool.query(`SELECT 'employees'::regclass::oid AS oid`)).rows;
  assert.deepEqual(await reorderEmployeeColumns(pool, { expectedDatabase }), { status: 'skipped', employees: 1 });
  assert.deepEqual(await snapshot(pool), before);
  assert.deepEqual((await pool.query(`SELECT 'employees'::regclass::oid AS oid`)).rows, oid);
}));
test('dependent view refuses rebuild and transaction leaves original schema intact', async () => fixture(async pool => {
  await pool.query('CREATE VIEW employee_names AS SELECT id,first_name FROM employees');
  const before = await snapshot(pool);
  await assert.rejects(reorderEmployeeColumns(pool, { expectedDatabase }), /unsupported|depend/i);
  assert.deepEqual(await snapshot(pool), before);
  assert.equal((await pool.query('SELECT * FROM employee_names')).rowCount,1);
}));
test('late DROP dependency error rolls back copied table, dropped foreign keys and detached sequence', async () => fixture(async pool => {
  // The function depends on the row type, rather than directly on the table. DROP RESTRICT must catch it.
  await pool.query(`CREATE FUNCTION employee_rows() RETURNS SETOF employees LANGUAGE sql AS 'SELECT * FROM employees'`);
  const before = await snapshot(pool);
  const oid = (await pool.query(`SELECT 'employees'::regclass::oid AS oid`)).rows;
  await assert.rejects(reorderEmployeeColumns(pool, { expectedDatabase }), /depend/);
  assert.deepEqual(await snapshot(pool), before);
  assert.deepEqual((await pool.query(`SELECT 'employees'::regclass::oid AS oid`)).rows, oid);
  assert.equal((await pool.query('SELECT * FROM employee_rows()')).rowCount, 1);
  assert.equal((await pool.query(`SELECT to_regclass(current_schema() || '.employees_column_order_new') AS replacement`)).rows[0].replacement,null);
}));
test('incoming foreign key comments are refused instead of silently discarded', async () => fixture(async pool => {
  await pool.query(`COMMENT ON CONSTRAINT users_employee_id_fkey ON users IS 'Preserve this FK annotation'`);
  const before = await snapshot(pool);
  await assert.rejects(reorderEmployeeColumns(pool, { expectedDatabase }), /unsupported/i);
  assert.deepEqual(await snapshot(pool), before);
  assert.equal((await pool.query(`SELECT obj_description(oid,'pg_constraint') AS comment FROM pg_constraint WHERE conname='users_employee_id_fkey' AND conrelid='users'::regclass`)).rows[0].comment,'Preserve this FK annotation');
}));
test('default privilege grants cannot change table permissions during replacement', async () => fixture(async pool => {
  const schema = (await pool.query('SELECT current_schema() AS name')).rows[0].name;
  await pool.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT SELECT ON TABLES TO PUBLIC`);
  const before = await snapshot(pool);
  await assert.rejects(reorderEmployeeColumns(pool, { expectedDatabase }), /unsupported/i);
  assert.deepEqual(await snapshot(pool), before);
  assert.equal((await pool.query(`SELECT relacl FROM pg_class WHERE oid='employees'::regclass`)).rows[0].relacl,null);
}));
