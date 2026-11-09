import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {databaseUrl,workspaceRoot} from './config.js';
import {migrate} from './database.js';
import {migrateLegacy,importEmployees,type EmployeeImportPayload} from './import.js';
const pool=new pg.Pool({connectionString:databaseUrl()});
try{
  await migrate(pool);
  const command=process.argv[2];
  if(command==='schema')console.log('PostgreSQL schema ready');
  else if(command==='legacy'){
    const result=await migrateLegacy(pool,resolve(workspaceRoot,'data/factory.sqlite'),resolve(workspaceRoot,'data/backups'));
    console.log(JSON.stringify(result));
  }else if(command==='employees'){
    const path=process.argv[3]?resolve(process.argv[3]):resolve(workspaceRoot,'data/staging/employees-2569.json');
    const payload:EmployeeImportPayload=JSON.parse(await readFile(path,'utf8'));
    const source=resolve(workspaceRoot,'ประวัติพนักงานบจ.กระเบื้องปี2569.xls');
    const hash=createHash('sha256').update(await readFile(source)).digest('hex');
    if(hash!==payload.sourceSha256)throw new Error('Excel source changed after extraction; re-extract and review before importing');
    console.log(JSON.stringify(await importEmployees(pool,payload)));
  }else throw new Error('Use schema, legacy or employees');
}catch(error){console.error(error instanceof Error?error.message:'Data operation failed');process.exitCode=1;}
finally{await pool.end();}
