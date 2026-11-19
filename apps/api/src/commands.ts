import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {databaseUrl,workspaceRoot} from './config.js';
import {migrate} from './database.js';
import {migrateLegacy,importEmployees,type EmployeeImportPayload,type LegacyNameMapping} from './import.js';
import {upgradeEmployeeNames,type NameUpgradePayload} from './employee-upgrade.js';
const pool=new pg.Pool({connectionString:databaseUrl()});
try{
  const command=process.argv[2];
  if(command==='employee-names'){
    const [mappingPath,expectedDatabase,sourcePath,markdownPath]=process.argv.slice(3,7);
    if(!mappingPath||!expectedDatabase||!sourcePath||!markdownPath)throw new Error('Use employee-names <mapping.json> <expected-database> <source.xls> <source.md> [--dry-run]');
    const payload:NameUpgradePayload=JSON.parse(await readFile(resolve(mappingPath),'utf8'));
    const sha=async(path:string)=>createHash('sha256').update(await readFile(resolve(path))).digest('hex');
    if(await sha(sourcePath)!==payload.sourceSha256||await sha(markdownPath)!==payload.markdownSha256)throw new Error('Source hash changed; review extraction again');
    console.log(JSON.stringify(await upgradeEmployeeNames(pool,payload,{expectedDatabase,dryRun:process.argv.includes('--dry-run')})));
  }else{
  await migrate(pool);
  if(command==='schema')console.log('PostgreSQL schema ready');
  else if(command==='legacy'){
    const names:LegacyNameMapping=process.argv[3]?JSON.parse(await readFile(resolve(process.argv[3]),'utf8')):{};
    const result=await migrateLegacy(pool,resolve(workspaceRoot,'data/factory.sqlite'),resolve(workspaceRoot,'data/backups'),names);
    console.log(JSON.stringify(result));
  }else if(command==='employees'){
    const path=process.argv[3]?resolve(process.argv[3]):resolve(workspaceRoot,'data/staging/employees-2569.json');
    const payload:EmployeeImportPayload=JSON.parse(await readFile(path,'utf8'));
    const source=process.argv[4]?resolve(process.argv[4]):resolve(workspaceRoot,'ประวัติพนักงานบจ.กระเบื้องปี2569.xls');
    const hash=createHash('sha256').update(await readFile(source)).digest('hex');
    if(hash!==payload.sourceSha256)throw new Error('Excel source changed after extraction; re-extract and review before importing');
    console.log(JSON.stringify(await importEmployees(pool,payload)));
  }else throw new Error('Use schema, legacy or employees');
  }
}catch(error){console.error(error instanceof Error?error.message:'Data operation failed');process.exitCode=1;}
finally{await pool.end();}
