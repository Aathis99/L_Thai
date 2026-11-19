import type pg from 'pg';

const order = ['id','code','prefix','first_name','last_name','department','position_id','phone','active','archived','created_at','updated_at','social_security_number','taxpayer_id'];
const quote = (name: string) => `"${name.replaceAll('"','""')}"`;

/** One-off, manually invoked rebuild. Never called by application startup. */
export async function reorderEmployeeColumns(pool: pg.Pool, options: { expectedDatabase: string; dryRun?: boolean }): Promise<{ status: 'reordered' | 'dry-run' | 'skipped'; employees: number }> {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const actual = (await db.query('SELECT current_database() AS name')).rows[0].name;
    if (!options.expectedDatabase || actual !== options.expectedDatabase)
      throw new Error(`Database guard rejected target ${actual}`);
    await db.query(`SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s'`);
    await db.query('SELECT pg_advisory_xact_lock(20261109)');
    const relation = (await db.query(`SELECT c.*,n.nspname,pg_get_userbyid(c.relowner) AS owner,a.amname
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_am a ON a.oid=c.relam
      WHERE c.oid=to_regclass('employees')`)).rows[0];
    const refuse = (condition: boolean, detail: string) => { if (condition) throw new Error(`Unsupported employees metadata/dependency: ${detail}`); };
    refuse(!relation, 'missing table');
    const table = `${quote(relation.nspname)}.${quote('employees')}`;
    await db.query(`LOCK TABLE ${table} IN ACCESS EXCLUSIVE MODE`);
    const oid = relation.oid;
    refuse(relation.relkind !== 'r' || relation.relpersistence !== 'p' || relation.amname !== 'heap'
      || relation.relispartition || relation.relrowsecurity || relation.relforcerowsecurity || relation.relreplident !== 'd'
      || relation.relacl !== null || relation.reloptions !== null || relation.reltablespace !== 0 || relation.reloftype !== 0,
    'table storage, security, grants or partition settings');
    const columns = (await db.query(`SELECT a.*,format_type(a.atttypid,a.atttypmod) AS sql_type,
      pg_get_expr(d.adbin,d.adrelid) AS default_expr,t.typcollation,t.typstorage
      FROM pg_attribute a JOIN pg_type t ON t.oid=a.atttypid
      LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid=$1 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`, [oid])).rows;
    refuse(columns.length !== order.length || order.some(name => !columns.some(c => c.attname === name)), 'column names');
    for (const c of columns) {
      const type = ['id','position_id','active','archived'].includes(c.attname) ? 'integer'
        : ['created_at','updated_at'].includes(c.attname) ? 'timestamp with time zone' : 'text';
      refuse(c.sql_type !== type || c.attidentity !== '' || c.attgenerated !== '' || c.attcollation !== c.typcollation
        || c.attstorage !== c.typstorage || c.attcompression !== '' || c.attstattarget !== null && c.attstattarget !== -1
        || c.attoptions !== null || c.attfdwoptions !== null || c.attacl !== null || c.attinhcount !== 0,
      `column ${c.attname}`);
    }
    const constraints = (await db.query(`SELECT c.*,pg_get_constraintdef(c.oid) AS definition,
      n.nspname AS source_schema,r.relname AS source_table FROM pg_constraint c
      JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace
      WHERE c.conrelid=$1 OR c.confrelid=$1 ORDER BY c.oid`, [oid])).rows;
    const own = constraints.filter(c => c.conrelid === oid);
    const incoming = constraints.filter(c => c.confrelid === oid && c.conrelid !== oid);
    refuse(own.filter(c => c.contype === 'p').length !== 1 || own.filter(c => c.contype === 'f').length !== 1
      || own.some(c => !['p','f','c','n'].includes(c.contype)) || incoming.length !== 4
      || constraints.some(c => !c.convalidated || c.conparentid !== 0 || !c.conislocal || c.coninhcount !== 0 || c.condeferrable || c.condeferred), 'constraints');
    for (const fk of incoming)
      await db.query(`LOCK TABLE ${quote(fk.source_schema)}.${quote(fk.source_table)} IN ACCESS EXCLUSIVE MODE`);
    const indexes = (await db.query(`SELECT i.indexrelid,pg_get_indexdef(i.indexrelid) AS definition,
      i.indisvalid,i.indisready,i.indisreplident,i.indisclustered,c.relacl,c.reloptions,c.reltablespace
      FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid=$1`, [oid])).rows;
    refuse(indexes.length !== 2 || indexes.some(i => !i.indisvalid || !i.indisready || i.indisreplident || i.indisclustered
      || i.relacl !== null || i.reloptions !== null || i.reltablespace !== 0), 'indexes');
    const sequence = (await db.query(`SELECT pg_get_serial_sequence($1,'id') AS name`, [table])).rows[0].name;
    refuse(!sequence, 'missing owned serial sequence');
    const sequenceOid = (await db.query('SELECT $1::regclass::oid AS oid', [sequence])).rows[0].oid;
    const relatedOids = [oid,sequenceOid,...indexes.map(i => i.indexrelid)];
    const special = (await db.query(`SELECT
      EXISTS(SELECT FROM pg_trigger WHERE tgrelid=$1 AND NOT tgisinternal) OR
      EXISTS(SELECT FROM pg_rewrite WHERE ev_class=$1) OR
      EXISTS(SELECT FROM pg_policy WHERE polrelid=$1) OR
      EXISTS(SELECT FROM pg_inherits WHERE inhrelid=$1 OR inhparent=$1) OR
      EXISTS(SELECT FROM pg_publication_rel WHERE prrelid=$1) OR
      EXISTS(SELECT FROM pg_publication_namespace WHERE pnnspid=$3) OR
      EXISTS(SELECT FROM pg_publication WHERE puballtables) OR
      EXISTS(SELECT FROM pg_default_acl WHERE defaclrole=(SELECT oid FROM pg_roles WHERE rolname=current_user)
        AND defaclobjtype='r' AND defaclnamespace IN(0,$3)) OR
      EXISTS(SELECT FROM pg_statistic_ext WHERE stxrelid=$1) OR
      EXISTS(SELECT FROM pg_description WHERE (classoid='pg_class'::regclass AND objoid=ANY($2::oid[]))
        OR (classoid='pg_constraint'::regclass AND objoid=ANY($4::oid[]))) OR
      EXISTS(SELECT FROM pg_seclabel WHERE (classoid='pg_class'::regclass AND objoid=ANY($2::oid[]))
        OR (classoid='pg_constraint'::regclass AND objoid=ANY($4::oid[]))) OR
      EXISTS(SELECT FROM pg_depend WHERE classid='pg_class'::regclass AND objid=$1 AND deptype='e')
      AS present`, [oid,relatedOids,relation.relnamespace,constraints.map(c => c.oid)])).rows[0].present;
    refuse(special, 'triggers, rules, security, publication, inheritance, statistics, extension or comments');
    const dependencies = (await db.query(`SELECT d.classid::regclass::text AS catalog,d.objid,d.deptype
      FROM pg_depend d WHERE d.refclassid='pg_class'::regclass AND d.refobjid=$1`, [oid])).rows;
    const constraintIds = new Set(constraints.map(c => c.oid));
    const indexIds = new Set(indexes.map(i => i.indexrelid));
    const attrdefs = new Set((await db.query('SELECT oid FROM pg_attrdef WHERE adrelid=$1', [oid])).rows.map(r => r.oid));
    for (const dep of dependencies) {
      const supported = dep.catalog === 'pg_constraint' && constraintIds.has(dep.objid)
        || dep.catalog === 'pg_attrdef' && attrdefs.has(dep.objid)
        || dep.catalog === 'pg_class' && (indexIds.has(dep.objid) || dep.objid === sequenceOid && dep.deptype === 'a'
          || dep.objid === relation.reltoastrelid && dep.deptype === 'i')
        || dep.catalog === 'pg_type' && dep.objid === relation.reltype && dep.deptype === 'i';
      refuse(!supported, `${dep.catalog} object ${dep.objid}`);
    }
    const employees = Number((await db.query(`SELECT count(*) AS count FROM ${table}`)).rows[0].count);
    const finish = async (status: 'reordered' | 'dry-run' | 'skipped') => {
      await db.query('COMMIT');
      return { status, employees };
    };
    if (columns.every((c,i) => c.attname === order[i])) return await finish('skipped');
    if (options.dryRun) return await finish('dry-run');

    const replacement = `${quote(relation.nspname)}.${quote('employees_column_order_new')}`;
    refuse((await db.query('SELECT to_regclass($1) AS existing', [replacement])).rows[0].existing !== null, 'replacement name already exists');
    const definitions = order.map(name => {
      const c = columns.find(c => c.attname === name)!;
      return `${quote(name)} ${c.sql_type}${c.default_expr === null ? '' : ` DEFAULT ${c.default_expr}`}`;
    });
    await db.query(`CREATE TABLE ${replacement} (${definitions.join(',')})`);
    const names = order.map(quote).join(',');
    await db.query(`INSERT INTO ${replacement} (${names}) SELECT ${names} FROM ${table}`);
    for (const fk of incoming)
      await db.query(`ALTER TABLE ${quote(fk.source_schema)}.${quote(fk.source_table)} DROP CONSTRAINT ${quote(fk.conname)}`);
    // Detaching ownership is transactional and prevents DROP TABLE deleting the existing sequence.
    // Never call nextval/setval: even a previously uncalled sequence retains its precise state.
    await db.query(`ALTER SEQUENCE ${sequence} OWNED BY NONE`);
    await db.query(`DROP TABLE ${table}`);
    await db.query(`ALTER TABLE ${replacement} RENAME TO employees`);
    // Recreate NOT NULL before PRIMARY KEY to retain the original PG18 constraint names.
    for (const c of [...own.filter(c => c.contype === 'n'), ...own.filter(c => c.contype !== 'n')])
      await db.query(`ALTER TABLE ${table} ADD CONSTRAINT ${quote(c.conname)} ${c.definition}`);
    const constraintIndexes = new Set(own.filter(c => c.contype === 'p').map(c => c.conindid));
    for (const index of indexes.filter(i => !constraintIndexes.has(i.indexrelid))) await db.query(index.definition);
    await db.query(`ALTER TABLE ${table} OWNER TO ${quote(relation.owner)}`);
    await db.query(`ALTER SEQUENCE ${sequence} OWNED BY ${table}.${quote('id')}`);
    for (const fk of incoming)
      await db.query(`ALTER TABLE ${quote(fk.source_schema)}.${quote(fk.source_table)} ADD CONSTRAINT ${quote(fk.conname)} ${fk.definition}`);
    return await finish('reordered');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
