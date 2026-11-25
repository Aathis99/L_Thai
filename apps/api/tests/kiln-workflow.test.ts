import assert from 'node:assert/strict';
import {test,type TestContext} from 'node:test';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {migrate,one,transaction} from '../src/database.js';
import {saveType,createOrder} from '../src/pressing/catalog.js';
import {recordEntry,recordIssue,reverseIssue} from '../src/pressing/stock.js';
import {recordGlazing,correctGlazing} from '../src/finishing/glazing.js';
import {listSources,createRound,loadRound,finishRound,setRange} from '../src/finishing/firing.js';
import {listReceipts,recordQc,voidAllocation,receiveStock} from '../src/finishing/qc.js';
import {createApplication} from '../src/app.js';
import {hashPassword} from '../src/auth.js';
import {readWorkflow,saveWorkflow} from '../src/kiln-workflow/store.js';

const day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Bangkok',dateStyle:'short'}).format(new Date());
const at=(time:string)=>`${day}T${time}:00+07:00`;
async function fixture(t:TestContext,destination='color',purpose='customer'){
 const url=process.env.DATABASE_URL;assert.ok(url);
 const admin=new pg.Pool({connectionString:url});
 assert.match((await one(admin,'SELECT current_database() db')).db,/^lthai_.*_qa$/);
 const schema='kiln_live_test_'+randomUUID().replaceAll('-','');
 await admin.query('CREATE SCHEMA '+schema);
 const pool=new pg.Pool({connectionString:url,options:'-c search_path='+schema});
 t.after(async()=>{await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();});
 await migrate(pool);
 const actor=await one(pool,"INSERT INTO users(username,name,password_hash,role_id) VALUES('operator','Operator','unused',1) RETURNING id,username");
 const employee=await one(pool,"INSERT INTO employees(code,first_name) VALUES('A','Worker') RETURNING id");
 const type=await saveType(pool,{width:2,length:8,clay:'ขาว',pieces_per_rack:100,rest_days:0,destination,pieces_per_sqm:50});
 const color=await one(pool,"INSERT INTO color_chart_entries(display_order,name,normalized_name) VALUES(1,'ฟ้า','ฟ้า') RETURNING id");
 const order=await createOrder(pool,{type_id:type,purpose,customer_reference:purpose==='customer'?'LIVE-1':'STOCK-1',...(purpose==='customer'?{customer_pieces:100,allowance_percent:20}:{target_pieces:120}),color_id:destination==='color'?color.id:null});
 await recordEntry(pool,{request_id:'press',order_id:order,pressed_on:'2026-11-01',employee_id:employee.id,full_racks:2,loose_pieces:0},actor);
 const source=await one(pool,'SELECT id FROM pressing_stock_sources');
 const issue=await recordIssue(pool,{request_id:'issue',order_id:order,type_id:type,destination,confirmed_ready:true,lines:[{source_id:source.id,pieces:120,allocation:purpose==='stock'?'general':'order'}]},actor);
 const batch=destination==='color'?await recordGlazing(pool,{request_id:'glaze',issue_id:issue,worked_on:day,worker_ids:[employee.id],pieces:120,pressing_waste:0,glazing_waste:0,good_pieces:120},actor):null;
 let revision=0;
 const save=async(command:any):Promise<Awaited<ReturnType<typeof readWorkflow>>>=>{
  if(command.op==='qc'){
   let d=await save({op:'qc-document-open',loadId:command.loadId});const doc=d.state.qcDocuments!.find(x=>x.loads.some(l=>l.id===command.loadId))!;
   d=await save({op:'qc-draft-save',documentId:doc.id,at:command.at,workerIds:[employee.id],note:command.note??'',lines:[{loadId:command.loadId,counts:command.counts,defects:command.defects??[]}]});
   return save({op:'qc-draft-confirm',documentId:doc.id,entryId:d.state.qcDocuments!.find(x=>x.id===doc.id)!.entries.at(-1)!.id});
  }
  const current=await readWorkflow(pool);const result=await transaction(pool,db=>saveWorkflow(db,{request_id:randomUUID(),revision,catalog_version:current.catalogVersion,command:{...command,...(command.qcs?.length?{reason:'ทดสอบแก้ยอด'}:{})}},actor));revision=result.revision;return result;
 };
 const sourceId='order:'+order;
 const plan=(pieces:number)=>save({op:'plan',sourceId,kilnId:2,rail:1,date:day,unit:'pieces',input:pieces,pieces,temperature:1150});
 const settings=()=>save({op:'settings',sourceId,clayRange:[1050,1250],...(destination==='color'?{colorRange:[1100,1200]}:{}),shapeRange:[1100,1200]});
 const fire=async()=>{
  await save({op:'rail-ready',kilnId:2,rail:1});
  let d=await save({op:'start',kilnId:2,rail:1,temperature:1150,at:at('10:00')});const round=d.state.rounds.at(-1)!;
  await save({op:'stop',roundId:round.id,at:at('12:00')});await save({op:'withdraw',roundId:round.id,at:at('12:15')});
  d=await save({op:'unload',roundId:round.id,at:at('12:30')});return d.state.rounds.at(-1)!.loads[0].id;
 };
 return {pool,actor,employee,type,color,order,issue,batch,sourceId,save,plan,settings,fire};
}
test('production starts empty, preserves existing rows and rejects demo or source quantity overrides',async t=>{
 const f=await fixture(t);const before=await one(f.pool,'SELECT count(*) n FROM pressing_orders');await migrate(f.pool);
 const d=await readWorkflow(f.pool);assert.equal(d.revision,0);assert.equal(d.state.rounds.length,0);assert.equal(d.history.length,0);
 assert.equal(d.sources[0].available,120);assert.equal(d.sources[0].synthetic,false);assert.equal(d.state.stockGrades.length,0);
 assert.equal(d.sources[0].shapeRange,undefined);assert.deepEqual(await one(f.pool,'SELECT count(*) n FROM pressing_orders'),before);
 await assert.rejects(f.save({op:'demo',confirm:'RESET-QA'}),/ทดลอง|ไม่รองรับ/);
 await assert.rejects(f.save({op:'settings',sourceId:f.sourceId,ready:999}),/ต้นทาง|ไม่รองรับ/);
 assert.equal((await readWorkflow(f.pool)).revision,0);
});
test('real preparations are visible to legacy loading and glazing correction and release exactly once',async t=>{
 const f=await fixture(t);await f.settings();let d=await f.plan(100);
 d=await f.save({op:'reserve',planId:d.state.plans[0].id,pieces:100});
 assert.equal((await listSources(f.pool))[0].waiting_pieces,20);
 const round=await transaction(f.pool,db=>createRound(db,{request_id:'old-round',kiln:'1',temperature:1150,started_on:day},f.actor));
 await assert.rejects(transaction(f.pool,db=>loadRound(db,{request_id:'old-load',round_id:round,batch_id:f.batch,pieces:21},f.actor)),/ยอดรอเผา/);
 await assert.rejects(transaction(f.pool,db=>correctGlazing(db,{request_id:'shrink',batch_id:f.batch,pieces:120,good_pieces:99,pressing_waste:21,glazing_waste:0,reason:'recount'},f.actor)),/ต่ำกว่า/);
 await f.save({op:'plan-cancel',planId:d.state.plans[0].id});assert.equal((await listSources(f.pool))[0].waiting_pieces,120);
 assert.equal((await one(f.pool,'SELECT count(*) n FROM kiln_workflow_debits')).n,'0');
});
test('breeze holds prevent returning already reserved real pieces',async t=>{
 const f=await fixture(t,'kiln');await f.settings();let d=await f.plan(100);await f.save({op:'reserve',planId:d.state.plans[0].id,pieces:100});
 const line=await one(f.pool,'SELECT id FROM pressing_issue_lines');
 await assert.rejects(transaction(f.pool,db=>reverseIssue(db,f.issue,{request_id:'return',reason:'recount',lines:[{issue_line_id:line.id,pieces:21}]},f.actor)),/ต่ำกว่า/);
 assert.equal((await listSources(f.pool))[0].waiting_pieces,20);
});
test('graded allocations update real order balances and finished stock; correction and retry are atomic',async t=>{
 const f=await fixture(t);await f.settings();await f.save({op:'policy',sourceId:f.sourceId,accepted:['A+'],stockGrades:['A+']});
 let d=await f.plan(120);await f.save({op:'reserve',planId:d.state.plans[0].id,pieces:120});const load=await f.fire();
 d=await f.save({op:'qc',loadId:load,at:at('12:40'),counts:{'A+':115,waste:2,underfired:2,touchup:1},defects:[{name:'ร้าว',pieces:1},{name:'หัก',pieces:1}]});
 const qc=d.state.qcs[0].id;await f.save({op:'allocate',qcId:qc,grade:'A+',pieces:100,destination:'order',at:at('12:45')});
 assert.deepEqual(await one(f.pool,'SELECT ready_pieces,missing_pieces FROM finishing_order_balances WHERE id=$1',[f.order]),{ready_pieces:100,missing_pieces:0});
 d=await f.save({op:'allocate',qcId:qc,grade:'A+',pieces:15,destination:'stock',at:at('12:45')});
 const receipts=await listReceipts(f.pool);assert.deepEqual(receipts.map(r=>[r.grade,r.pieces]),[['A+',15]]);
 await f.save({op:'repair-ready',qcId:qc,kind:'underfired',pieces:1});
 d=await f.save({op:'plan',sourceId:`repair:${qc}:underfired`,kilnId:2,rail:2,date:day,unit:'pieces',input:1,pieces:1,temperature:1150});
 await f.save({op:'reserve',planId:d.state.plans.at(-1)!.id,pieces:1});await f.save({op:'rail-ready',kilnId:2,rail:2});
 d=await f.save({op:'start',kilnId:2,rail:2,temperature:1150,at:at('13:00')});
 assert.equal(d.summary.freshFired,120);assert.equal(d.summary.throughput,121);
 assert.equal((await one(f.pool,'SELECT sum(pieces) n FROM kiln_workflow_debits')).n,'120');
 const stockAllocation=d.state.allocations.find(a=>a.destination==='stock'&&a.grade==='A+')!;
 const snapshot=await readWorkflow(f.pool);const body={request_id:randomUUID(),revision:snapshot.revision,catalog_version:snapshot.catalogVersion,command:{op:'correct',allocations:[{id:stockAllocation.id,pieces:9}]}};
 await transaction(f.pool,db=>saveWorkflow(db,body,f.actor));await transaction(f.pool,db=>saveWorkflow(db,body,f.actor));
 assert.equal((await one(f.pool,"SELECT sum(pieces) n FROM kiln_workflow_allocations WHERE destination='stock'")).n,'9');
 await assert.rejects(f.save({op:'correct',loadId:load,pieces:100}),/มีผู้อื่น|ฉบับ|เกิน/);
});
test('stock production follows the real glazing path without invented customer demand',async t=>{
 const f=await fixture(t,'color','stock');const d=await readWorkflow(f.pool);
 assert.equal(d.sources[0].code,'OS');assert.equal(d.sources[0].available,120);
 assert.equal((await one(f.pool,'SELECT customer_pieces FROM pressing_orders')).customer_pieces,null);
});

test('legacy allocation cannot be reversed beneath stock already accepted by the new workflow',async t=>{
 const f=await fixture(t);await f.settings();
 const oldRound=await transaction(f.pool,db=>createRound(db,{request_id:'old-round',kiln:'1',temperature:1150,started_on:day},f.actor));
 const oldLoad=await transaction(f.pool,db=>loadRound(db,{request_id:'old-load',round_id:oldRound,batch_id:f.batch,pieces:20},f.actor));
 await transaction(f.pool,db=>finishRound(db,{request_id:'old-done',round_id:oldRound,finished_on:day},f.actor));
 await transaction(f.pool,db=>recordQc(db,{request_id:'old-qc',round_id:oldRound,sorted_on:day,good_pieces:20,waste_pieces:0,lines:[{load_id:oldLoad,pieces:20}]},f.actor));
 const oldAllocation=await one(f.pool,'SELECT id FROM firing_qc_allocations');
 await f.save({op:'policy',sourceId:f.sourceId,accepted:['A+'],stockGrades:['A+']});
 let d=await f.plan(100);await f.save({op:'reserve',planId:d.state.plans[0].id,pieces:100});const load=await f.fire();
 d=await f.save({op:'qc',loadId:load,at:at('12:40'),counts:{'A+':100},defects:[]});const qc=d.state.qcs[0].id;
 await f.save({op:'allocate',qcId:qc,grade:'A+',pieces:80,destination:'order',at:at('12:45')});
 await f.save({op:'allocate',qcId:qc,grade:'A+',pieces:20,destination:'stock',at:at('12:45')});
 await assert.rejects(transaction(f.pool,db=>voidAllocation(db,{request_id:'old-void',allocation_id:oldAllocation.id,reason:'recount'},f.actor)),/สต็อก/);
 assert.equal((await one(f.pool,'SELECT ready_pieces FROM finishing_order_balances WHERE id=$1',[f.order])).ready_pieces,100);
});

test('concurrent preparations reject stale writes and a failed projection rolls back state and audit',async t=>{
 const f=await fixture(t);await f.settings();let d=await f.plan(100);const planId=d.state.plans[0].id;
 const body={request_id:randomUUID(),revision:d.revision,catalog_version:d.catalogVersion,command:{op:'reserve',planId,pieces:100}};
 const results=await Promise.allSettled([body,{...body,request_id:randomUUID()}].map(b=>transaction(f.pool,db=>saveWorkflow(db,b,f.actor))));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal((await listSources(f.pool))[0].waiting_pieces,20);
 const snapshot=await readWorkflow(f.pool);
 await f.pool.query("CREATE FUNCTION reject_debit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected debit failure'; END $$; CREATE TRIGGER reject_debit BEFORE INSERT ON kiln_workflow_debits FOR EACH ROW EXECUTE FUNCTION reject_debit()");
 await assert.rejects(transaction(f.pool,db=>saveWorkflow(db,{request_id:randomUUID(),revision:snapshot.revision,catalog_version:snapshot.catalogVersion,command:{op:'rail-ready',kilnId:2,rail:1}},f.actor)),/injected debit failure/);
 const after=await readWorkflow(f.pool);assert.equal(after.revision,snapshot.revision);assert.deepEqual(after.state.railsReady,snapshot.state.railsReady);
 assert.equal(after.history.length,snapshot.history.length);assert.equal((await listSources(f.pool))[0].waiting_pieces,20);
});

test('live correction cannot leave legacy accepted stock ahead of an unfilled order',async t=>{
 const f=await fixture(t);await f.settings();await f.save({op:'policy',sourceId:f.sourceId,accepted:['A+'],stockGrades:['A+']});
 let d=await f.plan(80);await f.save({op:'reserve',planId:d.state.plans[0].id,pieces:80});const load=await f.fire();
 d=await f.save({op:'qc',loadId:load,at:at('12:40'),counts:{'A+':80},defects:[]});
 d=await f.save({op:'allocate',qcId:d.state.qcs[0].id,grade:'A+',pieces:80,destination:'order',at:at('12:45')});const allocation=d.state.allocations[0].id;
 const oldRound=await transaction(f.pool,db=>createRound(db,{request_id:'old-round',kiln:'1',temperature:1150,started_on:day},f.actor));
 const oldLoad=await transaction(f.pool,db=>loadRound(db,{request_id:'old-load',round_id:oldRound,batch_id:f.batch,pieces:40},f.actor));
 await transaction(f.pool,db=>finishRound(db,{request_id:'old-done',round_id:oldRound,finished_on:day},f.actor));
 const qc=await transaction(f.pool,db=>recordQc(db,{request_id:'old-qc',round_id:oldRound,sorted_on:day,good_pieces:40,waste_pieces:0,lines:[{load_id:oldLoad,pieces:40}]},f.actor));
 await transaction(f.pool,db=>receiveStock(db,{request_id:'old-stock',qc_id:qc,pieces:20},f.actor));
 await assert.rejects(f.save({op:'correct',allocations:[{id:allocation,pieces:79}]}),/สต็อก/);
 assert.equal((await one(f.pool,'SELECT ready_pieces FROM finishing_order_balances WHERE id=$1',[f.order])).ready_pieces,100);
});

test('new firing cannot occupy an oven still held by a legacy round',async t=>{
 const f=await fixture(t);await f.settings();
 const round=await transaction(f.pool,db=>createRound(db,{request_id:'old-round',kiln:'2',temperature:1150,started_on:day},f.actor));
 await transaction(f.pool,db=>loadRound(db,{request_id:'old-load',round_id:round,batch_id:f.batch,pieces:20},f.actor));
 let d=await f.plan(100);await f.save({op:'reserve',planId:d.state.plans[0].id,pieces:100});await f.save({op:'rail-ready',kilnId:2,rail:1});
 await assert.rejects(f.save({op:'start',kilnId:2,rail:1,temperature:1150,at:at('10:00')}),/เดิม|เตา/);
});

test('production HTTP uses ordinary sessions, permission checks and blocks fresh legacy or demo writes',async t=>{
 const f=await fixture(t);await f.pool.query('UPDATE users SET password_hash=$1 WHERE id=$2',[await hashPassword('test-workflow-password'),f.actor.id]);
 const {server}=createApplication(f.pool);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));});
 const base='http://127.0.0.1:'+(server.address() as {port:number}).port+'/api';
 const login=await fetch(base+'/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:f.actor.username,password:'test-workflow-password'})});
 assert.equal(login.status,200);const cookie=login.headers.get('set-cookie')!.split(';')[0];assert.ok(cookie.startsWith('session='));
 const post=(path:string,body:any)=>fetch(base+path,{method:'POST',headers:{cookie,'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await fetch(base+'/kiln/state')).status,401);
 assert.equal((await post('/finishing/rounds',{request_id:'blocked',kiln:'2',temperature:1150,started_on:day})).status,410);
 assert.equal((await post('/kiln/action',{request_id:randomUUID(),revision:0,command:{op:'demo',confirm:'RESET-QA'}})).status,400);
 const command={op:'plan',sourceId:f.sourceId,kilnId:2,rail:1,date:day,pieces:10,input:10,unit:'pieces',temperature:1150};
 const catalog=(await readWorkflow(f.pool)).catalogVersion;
 assert.equal((await post('/kiln/action',{request_id:randomUUID(),revision:0,catalog_version:catalog,command})).status,201);
 await f.pool.query('UPDATE roles SET permissions=$1 WHERE id=1',[JSON.stringify(['finishing.read'])]);
 assert.equal((await post('/kiln/action',{request_id:randomUUID(),revision:1,command})).status,403);
 assert.equal((await readWorkflow(f.pool)).revision,1);
});

test('a form cannot overwrite factory ranges edited through the existing category screen',async t=>{
 const f=await fixture(t);const snapshot=await readWorkflow(f.pool);
 await transaction(f.pool,db=>setRange(db,{clay:'ขาว',minimum:1050,maximum:1200},f.actor));
 await assert.rejects(transaction(f.pool,db=>saveWorkflow(db,{request_id:randomUUID(),revision:snapshot.revision,catalog_version:(snapshot as any).catalogVersion,
  command:{op:'settings',sourceId:f.sourceId,clayRange:[1100,1250],colorRange:[1100,1200],shapeRange:[1100,1200]}},f.actor)),/ต้นทาง|ทะเบียน/);
 assert.equal((await one(f.pool,"SELECT maximum FROM firing_clay_ranges WHERE clay='ขาว'")).maximum,1200);
});
