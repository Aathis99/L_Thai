import assert from 'node:assert/strict';
import {test} from 'node:test';
import {demoState,transition,type Model} from '../src/kiln-prototype/model.js';
import {documentCandidates,documentReport,transitionDocument} from '../src/qc-documents/model.js';

const now='2026-11-25T14:00:00+07:00';
const ctx={now,actor:'clerk',workers:[{id:1,code:'W1',name:'คนคัด หนึ่ง',active:true},{id:2,code:'W2',name:'คนคัด สอง',active:true}]};
function fixture(){
 let s=demoState();
 s.items=s.items.slice(0,2).map((i,n)=>({...i,ready:100,target:80,productId:1,typeId:1,colorId:1,clayTypeId:1,clayColorId:null,name:'สินค้าเดียวกัน',color:'ฟ้า',clay:'ขาว',accepted:['A+']}));
 for(const item of s.items){s=transition(s,{op:'plan',sourceId:item.id,kilnId:2,rail:1,date:'2026-11-25',pieces:100,unit:'pieces',input:100,temperature:1150});s=transition(s,{op:'reserve',planId:s.plans.at(-1)!.id,pieces:100});}
 s=transition(s,{op:'rail-ready',kilnId:2,rail:1});s=transition(s,{op:'start',kilnId:2,rail:1,temperature:1150,at:'2026-11-25T09:00:00+07:00'});
 const roundId=s.rounds[0].id;
 for(const [op,at] of [['stop','10:00'],['withdraw','11:00'],['unload','12:00']])s=transition(s,{op,roundId,at:`2026-11-25T${at}:00+07:00`});
 return s;
}
function open(s=fixture()){return transitionDocument(s,{op:'qc-document-open',loadId:s.rounds[0].loads[0].id},ctx);}
function draft(s:Model,pieces=60,loadId=s.rounds[0].loads[0].id){return transitionDocument(s,{op:'qc-draft-save',documentId:s.qcDocuments![0].id,at:now,workerIds:[1],note:'จากกระดาษ',lines:[{loadId,counts:{'A+':pieces-10,underfired:3,touchup:2},defects:[{name:'หัก',pieces:5}]}]},ctx);}
function confirm(s:Model){return transitionDocument(s,{op:'qc-draft-confirm',documentId:s.qcDocuments![0].id,entryId:s.qcDocuments![0].entries.at(-1)!.id},ctx);}

test('groups identical production identities across orders, preserving loads and stable number',()=>{
 let s=open();assert.equal(s.qcDocuments!.length,1);assert.equal(s.qcDocuments![0].loads.length,2);assert.equal(s.qcDocuments![0].number,'QC-2569-000001');
 s=transitionDocument(s,{op:'qc-document-open',loadId:s.rounds[0].loads[1].id},ctx);assert.equal(s.qcDocuments!.length,1);
 const distinct=fixture();distinct.items[1].colorId=2;assert.equal(documentCandidates(distinct).length,2);
 distinct.items[1].colorId=1;distinct.items[1].productId=2;assert.equal(documentCandidates(distinct).length,2);
});
test('draft has no inventory effect, confirmed partial quantities retain order and rework source',()=>{
 let s=draft(open());assert.equal(s.qcs.length,0);let r=documentReport(s,s.qcDocuments![0]);assert.equal(r.confirmed,0);assert.equal(r.pending,200);assert.equal(r.draftPieces,60);
 s=confirm(s);r=documentReport(s,s.qcDocuments![0]);assert.equal(s.qcs.length,1);assert.equal(r.confirmed,60);assert.equal(r.pending,140);assert.equal(r.output,r.input);assert.equal(s.allocations.length,0);assert.equal(r.orders[0].counts['A+'],50);assert.equal(r.orders[1].counts['A+'],0);
 assert.throws(()=>confirm(s),/ยืนยัน|แล้ว/);assert.throws(()=>confirm(draft(s,50)),/เกิน/);
});
test('rejects retired grades and double counted/invalid defects without changing input',()=>{
 const s=open();const base={op:'qc-draft-save',documentId:s.qcDocuments![0].id,at:now,workerIds:[1],lines:[{loadId:s.rounds[0].loads[0].id,counts:{'A+':10,'A-':1},defects:[]}]};
 assert.throws(()=>transitionDocument(s,base,ctx),/A-|เกรด|ยกเลิก/);
 assert.throws(()=>transitionDocument(s,{...base,lines:[{...base.lines[0],counts:{'A+':10},defects:[{name:'หัก',pieces:-1}]}]},ctx));
 assert.equal(s.qcs.length,0);assert.equal(s.qcDocuments![0].entries.length,0);
});
test('official requires complete quantities and no draft, then reprints immutable snapshot and revisions',()=>{
 let s=open();const id=s.qcDocuments![0].id;
 assert.throws(()=>transitionDocument(s,{op:'qc-document-issue',documentId:id},ctx),/ครบ|ร่าง/);
 for(const load of s.rounds[0].loads)s=confirm(draft(s,100,load.id));
 s=transitionDocument(s,{op:'qc-document-issue',documentId:id},ctx);const first=structuredClone(s.qcDocuments![0].reports[0]);assert.equal(first.revision,0);
 s=transitionDocument(s,{op:'qc-document-issue',documentId:id},ctx);assert.equal(s.qcDocuments![0].reports.length,1);
 const entry=s.qcDocuments![0].entries[0];s=transitionDocument(s,{op:'qc-document-correct',documentId:id,entryId:entry.id,reason:'แก้คนคัด',at:entry.at,workerIds:[2],note:'แก้ชื่อ',lines:entry.lines},ctx);
 assert.deepEqual(s.qcDocuments![0].reports[0],first);assert.equal(documentReport(s,s.qcDocuments![0]).officialCurrent,false);
 s=transitionDocument(s,{op:'qc-document-issue',documentId:id},ctx);assert.equal(s.qcDocuments![0].reports[1].revision,1);assert.deepEqual(s.qcDocuments![0].reports[0],first);
});
test('old persisted grades are preserved and historical group cannot be re-counted into new document',()=>{
 let s=fixture();s=transition(s,{op:'qc',loadId:s.rounds[0].loads[0].id,at:now,counts:{'A-':5,B:2},defects:[]});
 assert.equal(documentCandidates(s).length,0);assert.throws(()=>open(s),/เดิม|ประวัติ/);assert.equal(s.qcs[0].counts['A-'],5);assert.equal(s.qcs[0].counts.B,2);
});
test('zero-quantity sibling stays in document membership when corrected back to positive',()=>{
 let s=fixture();const second=s.rounds[0].loads[1].id;s=transition(s,{op:'correct',loadId:second,pieces:0});s=open(s);
 assert.equal(s.qcDocuments![0].loads.length,2);s=confirm(draft(s,100));assert.equal(documentReport(s,s.qcDocuments![0]).ready,true);
 s=transition(s,{op:'correct',loadId:second,pieces:100});const report=documentReport(s,s.qcDocuments![0]);assert.equal(report.input,200);assert.equal(report.pending,100);assert.equal(report.ready,false);
});
test('correction cannot move parent sort time after an already consumed refiring',()=>{
 let s=confirm(draft(open(),100));const doc=s.qcDocuments![0],entry=doc.entries[0],qc=s.qcs[0];
 s=transition(s,{op:'repair-ready',qcId:qc.id,kind:'underfired',pieces:1});
 s=transition(s,{op:'plan',sourceId:`repair:${qc.id}:underfired`,kilnId:2,rail:2,date:'2026-11-25',unit:'pieces',input:1,pieces:1,temperature:1150});
 s=transition(s,{op:'reserve',planId:s.plans.at(-1)!.id,pieces:1});s=transition(s,{op:'rail-ready',kilnId:2,rail:2});s=transition(s,{op:'start',kilnId:2,rail:2,temperature:1150,at:now});
 assert.throws(()=>transitionDocument(s,{op:'qc-document-correct',documentId:doc.id,entryId:entry.id,reason:'แก้เวลา',at:'2026-11-25T15:00:00+07:00',workerIds:[1],note:entry.note,lines:entry.lines},ctx),/เผาซ้ำ|เข้าเตา/);
});
test('metadata correction preserves captured sorter names and identical correction does not issue new revision',()=>{
 let s=open();for(const load of s.rounds[0].loads)s=confirm(draft(s,100,load.id));const id=s.qcDocuments![0].id;
 s=transitionDocument(s,{op:'qc-document-issue',documentId:id},ctx);const entry=s.qcDocuments![0].entries[0];
 const command={op:'qc-document-correct',documentId:id,entryId:entry.id,reason:'ตรวจซ้ำ',at:entry.at,workerIds:[1],note:entry.note,lines:entry.lines};
 s=transitionDocument(s,command,{...ctx,workers:[{...ctx.workers[0],name:'ชื่อทะเบียนแก้ใหม่'}]});
 assert.equal(s.qcDocuments![0].entries[0].workers[0].name,entry.workers[0].name);
 s=transitionDocument(s,{op:'qc-document-issue',documentId:id},ctx);assert.equal(s.qcDocuments![0].reports.length,1);
 s=transitionDocument(s,{...command,note:'เพิ่มหมายเหตุ'},{...ctx,workers:[{...ctx.workers[0],active:false}]});assert.equal(s.qcDocuments![0].entries[0].workers[0].name,entry.workers[0].name);
});
test('draft and confirmation share the existing note limit, and issued report freezes template rows and source identities',()=>{
 const opened=open(),loadId=opened.rounds[0].loads[0].id;
 assert.throws(()=>transitionDocument(opened,{op:'qc-draft-save',documentId:opened.qcDocuments![0].id,at:now,workerIds:[1],note:'x'.repeat(251),lines:[{loadId,counts:{'A+':1},defects:[]}]},ctx),/250/);
 let s=opened;for(const load of s.rounds[0].loads)s=confirm(draft(s,100,load.id));s=transitionDocument(s,{op:'qc-document-issue',documentId:s.qcDocuments![0].id},ctx);
 const snapshot=s.qcDocuments![0].reports[0].content;assert.equal(snapshot.formVersion,1);assert.equal(snapshot.sources.length,2);assert.equal(snapshot.printSymptoms.length,23);assert.equal(snapshot.sources[0].code,'OD');
});
test('re-fired document retains repair parent document and source kind in immutable report projection',()=>{
 let s=confirm(draft(open(),100));const firstDoc=s.qcDocuments![0],qc=s.qcs[0];s=transition(s,{op:'repair-ready',qcId:qc.id,kind:'underfired',pieces:1});
 s=transition(s,{op:'plan',sourceId:`repair:${qc.id}:underfired`,kilnId:2,rail:2,date:'2026-11-25',unit:'pieces',input:1,pieces:1,temperature:1150});s=transition(s,{op:'reserve',planId:s.plans.at(-1)!.id,pieces:1});s=transition(s,{op:'rail-ready',kilnId:2,rail:2});s=transition(s,{op:'start',kilnId:2,rail:2,temperature:1150,at:now});
 const round=s.rounds.at(-1)!;for(const [op,time] of [['stop','15:00'],['withdraw','16:00'],['unload','17:00']])s=transition(s,{op,roundId:round.id,at:`2026-11-25T${time}:00+07:00`});
 s=transitionDocument(s,{op:'qc-document-open',loadId:round.loads[0].id},ctx);const report=documentReport(s,s.qcDocuments!.at(-1)!);
 assert.equal(report.sources[0].code,'ODP');assert.equal(report.sources[0].parentQcId,qc.id);assert.equal(report.sources[0].parentDocumentNumber,firstDoc.number);
});
