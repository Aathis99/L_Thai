import {loadEnvFile} from 'node:process';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import pg from 'pg';
loadEnvFile(new URL('../.env',import.meta.url));
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
const client=await pool.connect();
try{
  const payload=JSON.parse(await readFile(new URL('../data/staging/employee-identifiers.json',import.meta.url),'utf8'));
  const raw=await readFile(new URL('../ประวัติพนักงานบจ.กระเบื้องปี2569.xls',import.meta.url));
  if(createHash('sha256').update(raw).digest('hex')!==payload.sourceSha256||payload.rows.length!==36)throw new Error('Source mismatch');
  await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(20261109)');
  const key='employee-codes-identifiers-v1';
  if((await client.query('SELECT 1 FROM data_migrations WHERE key=$1',[key])).rowCount){console.log('Already applied');await client.query('COMMIT');}
  else{
    for(const row of payload.rows){
      if(!Number.isInteger(row.serial)||row.serial<1||row.serial>36||!/^([0-9]{13})?$/.test(row.taxpayer_id))throw new Error('Invalid source record');
      const oldCode=`EMP69-${String(row.serial).padStart(3,'0')}`,newCode=`emp${String(row.serial).padStart(3,'0')}`;
      const existing=(await client.query('SELECT id,name,taxpayer_id FROM employees WHERE code=$1',[oldCode])).rows[0];
      if(!existing||existing.name!==row.name)throw new Error('Employee mapping changed; no changes applied');
      if(existing.taxpayer_id&&existing.taxpayer_id!==row.taxpayer_id)throw new Error('Existing identifier conflict');
      await client.query('UPDATE employees SET code=$1,taxpayer_id=$2,updated_at=now() WHERE id=$3',[newCode,row.taxpayer_id,existing.id]);
    }
    await client.query('INSERT INTO audit(actor,action,target) VALUES($1,$2,$3)',['data-migration','ปรับรหัสพนักงานและเพิ่มเลขผู้เสียภาษี','36 records']);
    await client.query('INSERT INTO data_migrations(key,details) VALUES($1,$2)',[key,JSON.stringify({rows:36,sourceSha256:payload.sourceSha256})]);
    await client.query('COMMIT');console.log(JSON.stringify({renamed:36,taxpayerIds:payload.rows.filter(r=>r.taxpayer_id).length,socialSecurityIds:0}));
  }
}catch(error){await client.query('ROLLBACK');console.error(error.code?'Database conflict; transaction rolled back':error.message);process.exitCode=1;}
finally{client.release();await pool.end();}
