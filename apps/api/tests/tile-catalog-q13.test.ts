import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tileFixture,productInput} from './tile-test-helpers.js';

test('simple register edits source description and notes, preserving omitted fields and provenance',async t=>{
 const f=await tileFixture(t);
 const created=await f.call('/catalog/products','POST',{...productInput,description_raw:'ต้นฉบับ',notes:'ทบทวนความหนา'});
 assert.equal(created.status,201);
 const id=created.body.id;
 let row=(await f.state()).products.find((p:any)=>p.id===id);
 assert.equal(row.description_raw,'ต้นฉบับ');assert.equal(row.notes,'ทบทวนความหนา');
 await f.pool.query('UPDATE tile_products SET source_row=4,source_key=$1 WHERE id=$2',['q13:4',id]);
 assert.equal((await f.call('/catalog/products/'+id,'PUT',{...productInput,name:'แก้ชื่อ'})).status,200);
 row=(await f.state()).products.find((p:any)=>p.id===id);
 assert.equal(row.description_raw,'ต้นฉบับ');assert.equal(row.notes,'ทบทวนความหนา');assert.equal(row.source_row,4);
 assert.equal((await f.call('/catalog/products/'+id,'PUT',{...productInput,description_raw:'ใหม่',notes:''})).status,200);
 row=(await f.state()).products.find((p:any)=>p.id===id);
 assert.equal(row.description_raw,'ใหม่');assert.equal(row.notes,null);assert.equal(row.source_key,'q13:4');
});
