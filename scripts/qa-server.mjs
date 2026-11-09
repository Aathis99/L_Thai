// Disposable synthetic UI environment. No production rows or credentials are used.
import {loadEnvFile} from 'node:process';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {migrate} from '../apps/api/dist/database.js';
import {createApplication} from '../apps/api/dist/app.js';
import {hashPassword} from '../apps/api/dist/auth.js';
loadEnvFile(new URL('../.env',import.meta.url));
const schema='qa_'+randomUUID().replaceAll('-','');
const master=new pg.Pool({connectionString:process.env.DATABASE_URL});
await master.query(`CREATE SCHEMA ${schema}`);
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
await migrate(pool);
await pool.query('INSERT INTO users(username,name,password_hash,role_id) VALUES($1,$2,$3,1)',['qa-admin','ผู้ดูแลทดสอบ',await hashPassword('ui-test-password-only')]);
await pool.query('INSERT INTO positions(name) VALUES($1)',['ธุรการทดสอบ']);
await pool.query('INSERT INTO employees(code,name,phone,position_id) VALUES($1,$2,$3,1)',['QA-001','พนักงาน ทดสอบ','080-0000000']);
const {server}=createApplication(pool);
server.listen(4000,'127.0.0.1',()=>console.log('Synthetic QA API ready on 4000 (isolated schema)'));
let closing=false;
async function stop(){if(closing)return;closing=true;server.close(async()=>{await pool.end();await master.query(`DROP SCHEMA ${schema} CASCADE`);await master.end();process.exit(0);});server.closeIdleConnections();}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,stop);
