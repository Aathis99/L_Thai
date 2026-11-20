import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {migrate,transaction} from '../src/database.js';
import {tileFixture,productInput,bodyInput,profileInput} from './tile-test-helpers.js';

test('tile catalog retains variants and enables only explicitly configured clay profiles',async t=>{
 const f=await tileFixture(t);
 const a=await f.call('/catalog/products','POST',productInput);
 assert.equal(a.status,201,'product catalog creation must be supported');
 const b=await f.call('/catalog/products','POST',{...productInput,mounting_type:'mesh'});
 assert.equal(b.status,201);
 assert.notEqual(a.body.id,b.body.id);
 let state=await f.state();
 assert.equal(state.products.length,2);
 assert.equal(state.products[0].size_2,null);
 assert.equal(state.profiles.length,0);
 assert.equal((await f.call('/catalog/state','GET',undefined,'')).status,401);
 assert.equal((await f.call('/pressing/orders','POST',{product_id:a.body.id,type_id:1,purpose:'stock',target_pieces:10})).status,400);
 const body=await f.call('/catalog/bodies','POST',bodyInput);assert.equal(body.status,201);
 assert.equal((await f.call('/catalog/products/'+a.body.id,'PUT',{...productInput,body_id:body.body.id})).status,200);
 assert.equal((await f.call('/catalog/products/'+b.body.id,'PUT',{...productInput,mounting_type:'mesh',body_id:body.body.id})).status,200);
 const profile=await f.call('/catalog/profiles','POST',{...profileInput,body_id:body.body.id});assert.equal(profile.status,201);
 assert.equal((await f.call('/catalog/profiles','POST',{...profileInput,body_id:body.body.id})).status,409);
 assert.equal((await f.call('/catalog/profiles','POST',{...profileInput,body_id:body.body.id,clay:'สี'})).status,400);
 for(const clay_color of ['ฟ้า','เขียว'])assert.equal((await f.call('/catalog/profiles','POST',{...profileInput,body_id:body.body.id,clay:'สี',clay_color})).status,201);
 const laterite=await f.call('/catalog/profiles','POST',{...profileInput,body_id:body.body.id,clay:'ศิลาแลง'});assert.equal(laterite.status,201);
 state=await f.state();assert.equal(state.profiles.length,4);assert.equal(state.profiles.find((p:any)=>p.id===profile.body.id).length,null);
 const color=(await f.pool.query("INSERT INTO color_chart_entries(display_order,name,normalized_name) VALUES(1,'QA','qa') RETURNING id")).rows[0].id;
 const order=await f.call('/pressing/orders','POST',{request_id:randomUUID(),product_id:a.body.id,type_id:profile.body.id,purpose:'customer',customer_reference:'QA-ORDER',customer_pieces:1000,allowance_percent:10,color_id:color});
 assert.equal(order.status,201);
 assert.equal((await f.call('/pressing/orders','POST',{product_id:b.body.id,type_id:profile.body.id,purpose:'stock',target_pieces:10,color_id:color})).status,400);
 const other=await f.call('/catalog/bodies','POST',{...bodyInput,name:'คนละแม่พิมพ์'});assert.equal(other.status,201);
 const wrong=await f.call('/catalog/profiles','POST',{...profileInput,body_id:other.body.id});assert.equal(wrong.status,201);
 assert.equal((await f.call('/pressing/orders','POST',{product_id:a.body.id,type_id:wrong.body.id,purpose:'customer',customer_reference:'ผิดแบบ',customer_pieces:10,allowance_percent:10,color_id:color})).status,409);
 await f.call('/catalog/profiles/'+profile.body.id,'PUT',{...profileInput,body_id:body.body.id,pieces_per_rack:60,rest_days:5,pieces_per_sqm:100});
 const saved=(await f.call('/pressing/orders')).body.items.find((o:any)=>o.id===order.body.id);
 assert.equal(saved.production_pieces_per_rack,40);assert.equal(saved.production_rest_days,0);assert.equal(saved.pieces_per_sqm,90);
 assert.equal(saved.product_name,'แผ่นทดสอบ');assert.equal(saved.requires_mesh,false);
 assert.equal((await f.call('/catalog/profiles/'+profile.body.id,'PUT',{...profileInput,body_id:body.body.id,clay:'แดง'})).status,409);
 await migrate(f.pool);
 assert.equal((await f.state()).products.length,2);
});

test('catalog migration preserves referenced legacy profile and normalizes operational laterite only',async t=>{
 const f=await tileFixture(t);
 // Simulate a database created by the previous version, including its old CHECK constraint.
 await f.pool.query("ALTER TABLE pressing_types DROP CONSTRAINT pressing_types_clay_check");
 await f.pool.query("INSERT INTO pressing_types(width,length,clay,name,pieces_per_rack,rest_days,destination,pieces_per_sqm) VALUES(2,8,'จ้อ','ชื่อเก่า',40,0,'color',90)");
 const before=(await f.pool.query('SELECT id FROM pressing_types')).rows[0].id;
 await f.pool.query("INSERT INTO pressing_orders(type_id,target_pieces,purpose) VALUES($1,10,'stock')",[before]);
 await migrate(f.pool);
 const row=(await f.pool.query('SELECT id,clay FROM pressing_types')).rows[0];
 assert.deepEqual(row,{id:before,clay:'ศิลาแลง'});
 assert.equal((await f.pool.query('SELECT type_id FROM pressing_orders')).rows[0].type_id,before);
 assert.equal((await f.state()).products.length,0);
});
