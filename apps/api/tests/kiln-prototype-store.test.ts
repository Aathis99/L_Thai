import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import {migrate,transaction,one} from '../src/database.js';
import {createApplication} from '../src/app.js';
import {assertQa,installPrototype,savePrototype,readPrototype} from '../src/kiln-prototype/store.js';
async function fixture(t:TestContext){
 const url=process.env.DATABASE_URL;assert.ok(url);
 const admin=new pg.Pool({connectionString:url});
 assert.equal((await admin.query('SELECT current_database() AS db')).rows[0].db,'lthai_kiln_workflow_qa');
 const schema='kiln_test_'+randomUUID().replaceAll('-','');
 await admin.query('CREATE SCHEMA '+schema);
 const pool=new pg.Pool({connectionString:url,options:'-c search_path='+schema});
 t.after(async()=>{await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();});
 await migrate(pool);await installPrototype(pool);return pool;
}
test('QA guard refuses feature-off and any main database before installation',async()=>{
 const old=process.env.KILN_QA_MODE;process.env.KILN_QA_MODE='false';
 try{await assert.rejects(assertQa({query:async()=>{throw Error('must not query');}} as any),/QA/);}finally{process.env.KILN_QA_MODE=old;}
 await assert.rejects(assertQa({query:async()=>({rows:[{name:'lthai'}]})} as any),/ไม่ใช่ QA/);
});
test('serialized store rejects stale writes, deduplicates retries and retains before/after',async t=>{
 const pool=await fixture(t);
 const body={request_id:randomUUID(),revision:0,command:{op:'demo',confirm:'RESET-QA'}};
 const first=await transaction(pool,db=>savePrototype(db,body,'qa'));
 assert.equal(first.revision,1);
 const replay=await transaction(pool,db=>savePrototype(db,body,'qa'));
 assert.equal(replay.revision,1);assert.equal(replay.replayed,true);
 await assert.rejects(transaction(pool,db=>savePrototype(db,{...body,command:{op:'demo',confirm:'OTHER'}},'qa')),/รหัสคำขอ/);
 const command={op:'plan',sourceId:'demo-od',kilnId:2,rail:1,date:'2026-11-19',unit:'pieces',input:700,pieces:700,temperature:1150};
 const saves=await Promise.allSettled([1,2].map(()=>transaction(pool,db=>savePrototype(db,{request_id:randomUUID(),revision:1,command},'qa'))));
 assert.equal(saves.filter(x=>x.status==='fulfilled').length,1);
 assert.equal((await readPrototype(pool)).state.plans.length,1);
 const events=await pool.query('SELECT before_state,after_state FROM kiln_prototype_events ORDER BY id');
 assert.equal(events.rowCount,2);assert.equal(events.rows[0].before_state.items.length,0);assert.equal(events.rows[0].after_state.items.length,4);
});
test('authenticated QA API enforces existing permissions and records trial actor',async t=>{
 const pool=await fixture(t);const {server}=createApplication(pool,{cookieName:"kiln_qa_session"});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));});
 const address=server.address() as {port:number};const url='http://127.0.0.1:'+address.port+'/api';
 async function post(path:string,body:any,cookie=''){const r=await fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json',cookie},body:JSON.stringify(body)});return {r,body:await r.json() as any};}
 assert.equal((await fetch(url+'/kiln-qa/state')).status,401);
 await post('/setup',{username:'kiln-admin',name:'QA admin',password:'qa-model-only-password'});
 const login=await post('/login',{username:'kiln-admin',password:'qa-model-only-password'});const cookie=login.r.headers.get('set-cookie')!.split(';')[0];assert.ok(cookie.startsWith('kiln_qa_session='));
 assert.equal((await fetch(url+'/kiln-qa/state',{headers:{cookie:cookie.replace('kiln_qa_session=','session=')}})).status,401);
 const saved=await post('/kiln-qa/action',{request_id:randomUUID(),revision:0,command:{op:'demo',confirm:'RESET-QA'}},cookie);
 assert.equal(saved.r.status,201);assert.equal(saved.body.history[0].actor,'kiln-admin');
 await pool.query('UPDATE roles SET permissions=$1 WHERE id=1',[JSON.stringify(['finishing.read'])]);
 const denied=await post('/kiln-qa/action',{request_id:randomUUID(),revision:1,command:{op:'demo',confirm:'RESET-QA'}},cookie);
 assert.equal(denied.r.status,403);assert.equal((await one(pool,'SELECT revision FROM kiln_prototype_state')).revision,1);
});

test('history shows quantity changes and renames for a second QC defect',async t=>{
 const pool=await fixture(t);let revision=0;
 async function save(command:any){
  const result=await transaction(pool,db=>savePrototype(db,{request_id:randomUUID(),revision,command},'qa'));
  revision=result.revision;return result;
 }
 await save({op:'demo',confirm:'RESET-QA'});
 let data=await save({op:'plan',sourceId:'demo-od',kilnId:2,rail:1,date:'2026-11-19',unit:'pieces',input:10,pieces:10,temperature:1150});
 await save({op:'reserve',planId:data.state.plans[0].id,pieces:10});
 await save({op:'rail-ready',kilnId:2,rail:1});
 data=await save({op:'start',kilnId:2,rail:1,at:'2026-11-19T08:00:00+07:00',temperature:1150});
 const roundId=data.state.rounds[0].id,loadId=data.state.rounds[0].loads[0].id;
 await save({op:'stop',roundId,at:'2026-11-19T10:00:00+07:00'});
 await save({op:'withdraw',roundId,at:'2026-11-19T10:15:00+07:00'});
 await save({op:'unload',roundId,at:'2026-11-19T10:30:00+07:00'});
 data=await save({op:'qc',loadId,at:'2026-11-19T10:40:00+07:00',counts:{'A+':6,waste:4},defects:[{name:'ร้าว',pieces:2},{name:'หัก',pieces:2}]});
 const qcId=data.state.qcs[0].id;
 data=await save({op:'correct',qcs:[{id:qcId,counts:{'A+':5,waste:5},defects:[{name:'ร้าว',pieces:2},{name:'หัก',pieces:3}]}]});
 const quantity=data.history[0].changes.find(c=>c.field.includes('อาการเสีย')&&c.field.includes('หัก')&&c.before==='2'&&c.after==='3');
 assert.ok(quantity,'history must include the changed quantity of the second defect');
 data=await save({op:'correct',qcs:[{id:qcId,counts:{'A+':5,waste:5},defects:[{name:'ร้าว',pieces:2},{name:'งอ',pieces:3}]}]});
 assert.ok(data.history[0].changes.some(c=>c.before.includes('หัก')&&c.after==='—'),'history must show the removed defect name');
 assert.ok(data.history[0].changes.some(c=>c.before==='—'&&c.after.includes('งอ')),'history must show the replacement defect name');
});
