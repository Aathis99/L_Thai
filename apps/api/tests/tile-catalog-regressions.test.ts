import assert from 'node:assert/strict';
import {test,type TestContext} from 'node:test';
import {randomUUID} from 'node:crypto';
import {migrate} from '../src/database.js';
import {tileFixture,productInput,bodyInput,profileInput} from './tile-test-helpers.js';

async function prepared(t:TestContext,destination='color'){
 const f=await tileFixture(t);
 const body=(await f.call('/catalog/bodies','POST',bodyInput)).body.id;
 const profile=(await f.call('/catalog/profiles','POST',{...profileInput,body_id:body,destination})).body.id;
 const product=(await f.call('/catalog/products','POST',{...productInput,body_id:body})).body.id;
 const color=(await f.pool.query("INSERT INTO color_chart_entries(display_order,name,normalized_name) VALUES(1,'QA','qa') RETURNING id")).rows[0].id;
 const worker=(await f.pool.query("INSERT INTO employees(code,first_name) VALUES('QA-REGRESSION','ทดสอบ') RETURNING id")).rows[0].id;
 const day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Bangkok',dateStyle:'short'}).format(new Date());
 return {...f,body,profile,product,color,worker,day};
}

test('catalog stock orders retain their rate on subsequent pressing entries',async t=>{
 const f=await prepared(t);
 const order=await f.call('/pressing/orders','POST',{product_id:f.product,type_id:f.profile,purpose:'stock',target_pieces:100,color_id:f.color});assert.equal(order.status,201);
 assert.equal((await f.call('/catalog/profiles/'+f.profile,'PUT',{...profileInput,body_id:f.body,pieces_per_sqm:100})).status,200);
 const entry=await f.call('/pressing/entries','POST',{request_id:randomUUID(),order_id:order.body.id,employee_id:f.worker,pressed_on:f.day,full_racks:1,loose_pieces:0});assert.equal(entry.status,201);
 assert.equal((await f.pool.query('SELECT pieces_per_sqm FROM pressing_entries WHERE id=$1',[entry.body.id])).rows[0].pieces_per_sqm,90);
});

test('catalog customers cannot enter the legacy incomplete-order branch and bare stock snapshots remain complete',async t=>{
 const f=await prepared(t,'kiln');
 const incomplete=await f.call('/pressing/orders','POST',{product_id:f.product,type_id:f.profile,purpose:'customer',customer_reference:'QA-INCOMPLETE',target_pieces:100});
 assert.equal(incomplete.status,400);
 const colorProfile=(await f.call('/catalog/profiles','POST',{...profileInput,body_id:f.body,clay:'แดง',destination:'color'})).body.id;
 assert.equal((await f.call('/pressing/orders','POST',{product_id:f.product,type_id:colorProfile,purpose:'stock',target_pieces:100})).status,400);
 assert.equal((await f.call('/pressing/orders','POST',{type_id:colorProfile,purpose:'stock',target_pieces:100})).status,201);
 const bare=await f.call('/pressing/orders','POST',{type_id:f.profile,purpose:'stock',target_pieces:100});assert.equal(bare.status,201);
 const saved=(await f.pool.query('SELECT pieces_per_sqm,production_destination,production_clay FROM pressing_orders WHERE id=$1',[bare.body.id])).rows[0];
 assert.deepEqual(saved,{pieces_per_sqm:90,production_destination:'kiln',production_clay:'ขาว'});
});

test('migration fills each missing legacy setting without replacing an existing snapshot',async t=>{
 const f=await prepared(t);
 const id=(await f.pool.query("INSERT INTO pressing_orders(type_id,target_pieces,purpose,production_pieces_per_rack,production_clay_color) VALUES($1,100,'stock',12,'เก็บไว้') RETURNING id",[f.profile])).rows[0].id;
 await migrate(f.pool);
 const saved=(await f.pool.query('SELECT production_pieces_per_rack,production_rest_days,production_clay_color,pieces_per_sqm,production_destination,production_clay FROM pressing_orders WHERE id=$1',[id])).rows[0];
 assert.deepEqual(saved,{production_pieces_per_rack:12,production_rest_days:0,production_clay_color:'เก็บไว้',pieces_per_sqm:90,production_destination:'color',production_clay:'ขาว'});
});

test('physical bodies with opening stock cannot change shape and unused profile geometry stays in sync',async t=>{
 const f=await prepared(t);
 assert.equal((await f.call('/catalog/bodies/'+f.body,'PUT',{...bodyInput,size_1:4})).status,200);
 assert.equal((await f.state()).profiles.find((p:any)=>p.id===f.profile).width,4);
 const opening=await f.call('/pressing/opening','POST',{source_key:'QA-OPEN',type_id:f.profile,as_of:f.day,pieces:100,ready_on:f.day,ready_confirmed:true});assert.equal(opening.status,201);
 assert.equal((await f.call('/catalog/bodies/'+f.body,'PUT',{...bodyInput,size_1:5})).status,409);
});

test('legacy stock and historical sorting lock material identity while production settings may change',async t=>{
 const f=await prepared(t);
 const pigment=(await f.call('/catalog/clay-colors','POST',{code:'QA-BLUE',name:'ฟ้า'})).body.id;
 const tile={width:2,length:8,clay:'สี',clay_color:'ฟ้า',clay_color_id:pigment,pieces_per_rack:40,rest_days:0,destination:'kiln',pieces_per_sqm:90};
 const legacy=(await f.call('/pressing/types','POST',tile)).body.id;
 assert.equal((await f.call('/pressing/opening','POST',{source_key:'QA-LEGACY',type_id:legacy,as_of:f.day,pieces:100,ready_on:f.day,ready_confirmed:true})).status,201);
 assert.equal((await f.call('/pressing/types/'+legacy,'PUT',{...tile,clay_color:'เขียว'})).status,409);
 assert.equal((await f.call('/pressing/types/'+legacy,'PUT',{...tile,pieces_per_rack:50})).status,200);
 const sorted=(await f.call('/pressing/types','POST',{...tile,clay:'ขาว',clay_color:null})).body.id;
 const job=(await f.pool.query("INSERT INTO pressing_kiln_jobs(request_id,fired_on,created_by) VALUES($1,$2,1) RETURNING id",[randomUUID(),f.day])).rows[0].id;
 await f.pool.query("INSERT INTO pressing_sort_results(request_id,request_payload,kiln_job_id,type_id,revision,sorted_on,good_pieces,waste_pieces,submitted_by) VALUES($1,'{}',$2,$3,1,$4,10,0,1)",[randomUUID(),job,sorted,f.day]);
 assert.equal((await f.call('/pressing/types/'+sorted,'PUT',{...tile,clay:'ขาว',clay_color:null,width:3})).status,409);
});

test('glazing and legacy QC show the immutable SKU identity of shared preforms',async t=>{
 const f=await prepared(t);
 const second=(await f.call('/catalog/products','POST',{...productInput,product_code:'QA-TWO',name:'ลายสอง',body_id:f.body})).body.id;
 const ids=[];
 for(const product_id of [f.product,second]){
  const order=await f.call('/pressing/orders','POST',{product_id,type_id:f.profile,purpose:'customer',customer_reference:'QA-'+product_id,customer_pieces:100,allowance_percent:10,color_id:f.color});assert.equal(order.status,201);
  const entry=await f.call('/pressing/entries','POST',{request_id:randomUUID(),order_id:order.body.id,employee_id:f.worker,pressed_on:f.day,full_racks:3,loose_pieces:0});assert.equal(entry.status,201);
  const source=(await f.pool.query('SELECT id FROM pressing_stock_sources WHERE entry_id=$1',[entry.body.id])).rows[0].id;
  const issue=await f.call('/pressing/issues','POST',{request_id:randomUUID(),order_id:order.body.id,type_id:f.profile,destination:'color',confirmed_ready:true,lines:[{source_id:source,pieces:100,allocation:'order'}]});assert.equal(issue.status,201);
  const batch=await f.call('/finishing/glazing','POST',{request_id:randomUUID(),issue_id:issue.body.id,worked_on:f.day,worker_ids:[f.worker],pieces:100,good_pieces:100,pressing_waste:0,glazing_waste:0});assert.equal(batch.status,201);
  const round=(await f.pool.query("INSERT INTO firing_rounds(kiln,started_on,temperature,recorded_by,finished_on) VALUES('QA',$1,800,1,$1) RETURNING id",[f.day])).rows[0].id;
  const load=(await f.pool.query("INSERT INTO firing_loads(round_id,issue_id,batch_id,type_id,order_id,color_id,color_name,clay,pieces_per_sqm,pieces) VALUES($1,$2,$3,$4,$5,$6,'QA','ขาว',90,100) RETURNING id",[round,issue.body.id,batch.body.id,f.profile,order.body.id,f.color])).rows[0].id;
  const qc=await f.call('/finishing/qc','POST',{request_id:randomUUID(),round_id:round,sorted_on:f.day,good_pieces:100,waste_pieces:0,lines:[{load_id:load,pieces:100}]});assert.equal(qc.status,201);
  ids.push({product:product_id,order:order.body.id,issue:issue.body.id,batch:batch.body.id,qc:qc.body.id});
 }
 await f.call('/catalog/products/'+second,'PUT',{...productInput,product_code:'QA-TWO',name:'ชื่อใหม่ในทะเบียน',body_id:f.body});
 const issues=(await f.call('/finishing/issues')).body.items,batches=(await f.call('/finishing/glazing')).body.items,qcs=(await f.call('/finishing/qc')).body.items;
 for(const id of ids){assert.equal(issues.find((x:any)=>x.id===id.issue).product_id,id.product);assert.equal(batches.find((x:any)=>x.id===id.batch).product_id,id.product);assert.equal(qcs.find((x:any)=>x.id===id.qc).product_id,id.product);}
 assert.equal(batches.find((x:any)=>x.id===ids[1].batch).product_name,'ลายสอง');
});


test('profile retirement preserves identity and status-only updates support legacy profiles',async t=>{
 const f=await prepared(t);
 assert.equal((await f.call('/catalog/profiles/'+f.profile,'DELETE')).status,200);
 assert.equal((await f.state()).profiles.find((p:any)=>p.id===f.profile).active,false);
 assert.equal((await f.call('/catalog/profiles/'+f.profile,'PUT',{active:true})).status,200);
 const legacy=(await f.call('/pressing/types','POST',{width:2,length:8,...profileInput})).body.id;
 assert.equal((await f.call('/catalog/profiles/'+legacy,'PUT',{active:false})).status,200);
 assert.equal((await f.state()).profiles.find((p:any)=>p.id===legacy).active,false);
});
