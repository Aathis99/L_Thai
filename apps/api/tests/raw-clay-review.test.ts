import assert from 'node:assert/strict';
import {test,type TestContext} from 'node:test';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {tileFixture} from './tile-test-helpers.js';
async function fixture(t:TestContext){
 const f=await tileFixture(t);let revision=(await f.call('/raw-clay/state')).body.revision;
 const call=async(action:string,payload:any,cookie?:string)=>{const r=await f.call('/raw-clay/action','POST',{requestId:randomUUID(),revision,action,payload},cookie);if(r.status===200)revision=r.body.revision;return r;};
 return {...f,callAction:call};
}
test('adjust-only actor cannot change receipt or issue drafts by lying about kind',async t=>{
 const f=await fixture(t);const drafts=[];for(const kind of ['receipt','issue'])drafts.push((await f.callAction('save',{kind,data:{notes:'original'}})).body.document);
 const role=(await f.pool.query(`INSERT INTO roles(name,permissions) VALUES('adjust-only','["raw_clay.read","raw_clay.adjust"]') RETURNING id`)).rows[0].id;
 await f.pool.query("INSERT INTO users(username,name,password_hash,role_id) SELECT 'adjust-only','adjust-only',password_hash,$1 FROM users WHERE username='tile-admin'",[role]);const cookie=(await f.call('/login','POST',{username:'adjust-only',password:'tile-test-password-only'})).cookie;
 for(const doc of drafts){const r=await f.callAction('save',{id:doc.id,kind:'adjustment',data:{notes:'unauthorized'}},cookie);assert.equal(r.status,403);assert.equal((await f.call('/raw-clay/documents/'+doc.id)).body.document.data.notes,'original');}
});
test('adjust-only actor may update its adjustment draft without resupplying kind',async t=>{
 const f=await fixture(t);const role=(await f.pool.query(`INSERT INTO roles(name,permissions) VALUES('adjust-only','["raw_clay.read","raw_clay.adjust"]') RETURNING id`)).rows[0].id;
 await f.pool.query("INSERT INTO users(username,name,password_hash,role_id) SELECT 'adjust-only','adjust-only',password_hash,$1 FROM users WHERE username='tile-admin'",[role]);const cookie=(await f.call('/login','POST',{username:'adjust-only',password:'tile-test-password-only'})).cookie;
 const doc=(await f.callAction('save',{kind:'adjustment',data:{notes:'old'}},cookie)).body.document;
 const r=await f.callAction('save',{id:doc.id,data:{notes:'new'}},cookie);assert.equal(r.status,200);assert.equal(r.body.document.data.notes,'new');
});
async function colored(t:TestContext){const f=await fixture(t);const clay=(await f.pool.query("SELECT id FROM clay_types WHERE code='COLORED'")).rows[0].id;const color=(await f.pool.query("INSERT INTO clay_colors(code,name) VALUES('TEST','Old color') RETURNING id")).rows[0].id;const employee=(await f.pool.query("INSERT INTO employees(code,first_name) VALUES('RC-REV','Old employee') RETURNING id")).rows[0].id;
 const bytes=(await sharp({create:{width:100,height:100,channels:3,background:'white'}}).png().toBuffer()).toString('base64');const data={clayTypeId:clay,clayColorId:color,employeeId:employee,occurredAt:'2026-01-01T12:00:00+07:00',supplier:'S',billNumber:'B',documentDate:'2026-01-01',tradeName:'C',netKg:'100',missingNote:'missing'};
 const draft=(await f.callAction('save',{kind:'receipt',data,images:[{data:bytes,contentType:'image/png'}]})).body.document;const confirmed=await f.callAction('confirm',{id:draft.id});assert.equal(confirmed.status,200);
 await f.pool.query("UPDATE clay_colors SET name='Renamed color' WHERE id=$1",[color]);await f.pool.query("UPDATE employees SET first_name='Renamed employee' WHERE id=$1",[employee]);await f.pool.query("UPDATE clay_types SET name='Renamed clay' WHERE id=$1",[clay]);return {...f,doc:confirmed.body.document};}
test('notes-only correction preserves same-color name snapshot after master rename',async t=>{const f=await colored(t);const r=await f.callAction('correct',{id:f.doc.id,data:{...f.doc.data,notes:'corrected note'},reason:'notes'});assert.equal(r.status,200);assert.equal(r.body.document.data.clayColorName,'Old color');assert.equal(r.body.document.data.employeeName,f.doc.data.employeeName);assert.equal(r.body.document.data.clayTypeName,f.doc.data.clayTypeName);});
test('cancellation preserves confirmed employee, clay and color snapshots',async t=>{const f=await colored(t);const r=await f.callAction('cancel',{id:f.doc.id,reason:'cancel'});assert.equal(r.status,200);for(const field of ['employeeName','clayTypeName','clayColorName'])assert.equal(r.body.document.data[field],f.doc.data[field]);const detail=await f.call('/raw-clay/documents/'+f.doc.id);assert.equal(detail.body.history.at(-1).document.data.clayColorName,'Old color');});
