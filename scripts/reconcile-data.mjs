import {loadEnvFile} from 'node:process';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import pg from 'pg';
loadEnvFile(new URL('../.env',import.meta.url));
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
const source=new DatabaseSync(new URL('../data/factory.sqlite',import.meta.url),{readOnly:true});
try{
  const payload=JSON.parse(await readFile(new URL('../data/staging/employees-2569.json',import.meta.url),'utf8'));
  const raw=await readFile(new URL('../ประวัติพนักงานบจ.กระเบื้องปี2569.xls',import.meta.url));
  if(createHash('sha256').update(raw).digest('hex')!==payload.sourceSha256)throw new Error('Workbook hash changed');
  const employees=(await pool.query("SELECT * FROM employees WHERE code LIKE 'EMP69-%' OR code ~ '^emp[0-9]{3}$' ORDER BY code")).rows;
  if(employees.length!==36)throw new Error('Imported employee count mismatch');
  for(const original of payload.employees){
    const row=employees.find(e=>e.code===original.code||e.code===`emp${String(original.serial).padStart(3,'0')}`);
    if(!row||row.name!==original.name||row.phone!==original.phone||row.department!==''||row.position_id!==null)throw new Error('Employee source mapping mismatch (details withheld)');
  }
  const oldUsers=source.prepare('SELECT * FROM users ORDER BY id').all();
  const users=(await pool.query('SELECT * FROM users ORDER BY id')).rows;
  if(oldUsers.length!==users.length)throw new Error('Unexpected user accounts created');
  for(const original of oldUsers){
    const row=users.find(u=>u.id===original.id);
    for(const key of ['username','password_hash','role_id','employee_id','active','deleted'])if(row?.[key]!==original[key])throw new Error('Legacy account changed (details withheld)');
  }
  console.log(JSON.stringify({database:'PostgreSQL',employeeRows:employees.length,matchingNamesAndPhones:true,preservedLegacyAccounts:users.length,passwordHashesUnchanged:true,createdEmployeeAccounts:0,sourceWorkbookUnchanged:true}));
}finally{source.close();await pool.end();}
