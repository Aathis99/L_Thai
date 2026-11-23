import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {tileFixture,bodyInput,profileInput} from './tile-test-helpers.js';
import {legacyClay} from '../src/clay-registry/identity.js';
test('renamed registry preserves canonical firing keys and stock never pools different pigments',async t=>{
 const f=await tileFixture(t),s=await f.state(),colored=s.clay_types.find((c:any)=>c.code==='COLORED');
 const body=(await f.call('/catalog/bodies','POST',bodyInput)).body.id;
 const profiles:number[]=[];
 for(const code of ['QA-BLUE','QA-GREEN']){
  const color=(await f.call('/catalog/clay-colors','POST',{code,name:code})).body.id;
  const p=await f.call('/catalog/profiles','POST',{...profileInput,body_id:body,destination:'kiln',clay_type_id:colored.id,clay_color_id:color});assert.equal(p.status,201);profiles.push(p.body.id);
 }
 const day=new Date().toISOString().slice(0,10);
 const opening=await f.call('/pressing/opening','POST',{source_key:'QA-COLOR-OPEN',type_id:profiles[0],as_of:day,pieces:100,ready_on:day,ready_confirmed:true});assert.equal(opening.status,201);
 const source=(await f.pool.query('SELECT id FROM pressing_stock_sources WHERE type_id=$1',[profiles[0]])).rows[0].id;
 const before=await f.pool.query('SELECT count(*)::integer count FROM pressing_issues');
 const bad=await f.call('/pressing/issues','POST',{request_id:randomUUID(),type_id:profiles[1],order_id:null,destination:'kiln',confirmed_ready:true,lines:[{source_id:source,allocation:'general',pieces:10}]});
 assert.equal(bad.status,409);assert.deepEqual((await f.pool.query('SELECT count(*)::integer count FROM pressing_issues')).rows,before.rows);
 await f.call(`/catalog/clays/${colored.id}`,'PUT',{name:'สีชื่อใหม่'});
 const order=await f.call('/pressing/orders','POST',{type_id:profiles[0],purpose:'stock',target_pieces:20});assert.equal(order.status,201);
 const saved=(await f.pool.query('SELECT production_clay,clay_name_snapshot FROM pressing_orders WHERE id=$1',[order.body.id])).rows[0];
 assert.equal(saved.production_clay,legacyClay('COLORED'));assert.equal(saved.clay_name_snapshot,'สีชื่อใหม่');
 assert.equal((await f.pool.query('SELECT * FROM firing_clay_ranges')).rowCount,0,'registry must not invent temperature settings');
});
