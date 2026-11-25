import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readEntryForm,reportStatus,matchesQc,thaiDateRange,reportRevisionLabel,printedSymptoms} from '../src/components/qc-documents/helpers.ts';

test('per-load form sums real symptoms, leaves uncounted A+ blank and never crosses order quantities',()=>{
 const f=new FormData();f.set('load_10_A+','12');f.set('load_10_underfired','3');f.set('load_10_defect_0','2');f.set('load_20_defect_1','4');
 const result=readEntryForm(f,[10,20],['หัก','ฟอง']);assert.deepEqual(result,[{loadId:10,counts:{'A+':12,underfired:3,touchup:0},defects:[{name:'หัก',pieces:2}]},{loadId:20,counts:{'A+':0,underfired:0,touchup:0},defects:[{name:'ฟอง',pieces:4}]}]);
 assert.deepEqual(readEntryForm(new FormData(),[10],['หัก']),[]);
});
test('form rejects fractions, negative counts and custom symptom without its name',()=>{
 for(const value of ['-1','1.5','bad']){const f=new FormData();f.set('load_1_A+',value);assert.throws(()=>readEntryForm(f,[1],[]));}
 const f=new FormData();f.set('load_1_other_qty','2');assert.throws(()=>readEntryForm(f,[1],[]),/ชื่ออาการ/);
});
test('status distinguishes confirmed quantities from drafts and source search matches every order',()=>{
 const report={number:'QC-2569-000001',name:'สินค้า',clay:'ขาว',color:'ฟ้า',kiln:'เตา 2',orders:[{orderKey:'order:1',reference:'OD-001'},{orderKey:'order:2',reference:'OD-002'}],confirmed:60,pending:40,ready:false,officialCurrent:false} as any;
 assert.equal(reportStatus(report),'กำลังคัด');assert.equal(reportStatus({...report,confirmed:0}),'ร่าง');assert.equal(reportStatus({...report,pending:0,ready:true}),'คัดครบ รอออกฉบับทางการ');
 assert.equal(matchesQc(report,'od-002'),true);assert.equal(matchesQc(report,'order:2'),true);assert.equal(matchesQc(report,'not-found'),false);
});
test('date range uses Bangkok calendar date and compact single-day rendering',()=>{
 assert.equal(thaiDateRange(['2026-11-24T18:00:00Z']),new Date('2026-11-25T00:00:00+07:00').toLocaleDateString('th-TH',{timeZone:'Asia/Bangkok'}));
 assert.match(thaiDateRange(['2026-11-23T18:00:00Z','2026-11-24T18:00:00Z']),/–/);
 assert.equal(thaiDateRange([]),'—');
});
test('print labels distinguish draft, original, amended and preserve all actual defect rows',()=>{
 assert.equal(reportRevisionLabel(), 'ร่าง');assert.equal(reportRevisionLabel(0),'ฉบับทางการ');assert.equal(reportRevisionLabel(2),'ฉบับแก้ไขครั้งที่ 2');
 const rows=printedSymptoms([{name:'หัก',pieces:3},{name:'อาการเฉพาะงาน',pieces:2}]);assert.equal(rows.find(d=>d.name==='หัก')!.pieces,3);assert.equal(rows.find(d=>d.name==='อาการเฉพาะงาน')!.pieces,2);assert.equal(rows.find(d=>d.name==='ฟอง')!.pieces,0);
 assert.equal(rows.reduce((n,d)=>n+d.pieces,0),5);
});
