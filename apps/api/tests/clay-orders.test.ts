import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tileFixture,bodyInput,profileInput,productInput} from './tile-test-helpers.js';
test('registry profile resolves identity and snapshots clay; deactivation blocks stale orders',async t=>{
 const f=await tileFixture(t),s=await f.state(),white=s.clay_types.find((x:any)=>x.code==='WHITE');
 const body=(await f.call('/catalog/bodies','POST',bodyInput)).body.id;
 const profile=await f.call('/catalog/profiles','POST',{...profileInput,clay:undefined,body_id:body,clay_type_id:white.id,clay_color_id:null});
 assert.equal(profile.status,201);
 const product=(await f.call('/catalog/products','POST',{...productInput,body_id:body})).body.id;
 const input={type_id:profile.body.id,product_id:product,purpose:'stock',target_pieces:40,color_id:null};
 // Use kiln route to keep glaze independent of pigment in this fixture.
 await f.pool.query("UPDATE pressing_types SET destination='kiln' WHERE id=$1",[input.type_id]);
 const order=await f.call('/pressing/orders','POST',input);assert.equal(order.status,201);
 const before=(await f.pool.query('SELECT * FROM pressing_orders WHERE id=$1',[order.body.id])).rows[0];
 assert.equal(before.clay_type_id,white.id);assert.equal(before.clay_name_snapshot,'ดินขาว');
 await f.call(`/catalog/clays/${white.id}`,'PUT',{name:'ขาวชื่อใหม่',active:false});
 assert.equal((await f.call('/pressing/orders','POST',input)).status,409);
 assert.equal((await f.pool.query('SELECT clay_name_snapshot FROM pressing_orders WHERE id=$1',[order.body.id])).rows[0].clay_name_snapshot,'ดินขาว');
});
