import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readKg, receiptWeightError, readClayTime, canRawClay, validatePhotos, createClayRequestId,readClayForm,receiptDuplicates,type ClayDocument} from '../src/lib/raw-clay.ts';

test('kilograms preserve up to three decimals and reject rounded or exponent inputs',()=>{
 assert.equal(readKg('100.125'),'100.125'); assert.equal(readKg('0',true),'0');
 for(const value of ['','-1','0','1e3','1.1234','NaN'])assert.throws(()=>readKg(value));
});
test('weigh pairs compare exact net, allow a documented missing side, and reject reversed times',()=>{
 assert.equal(receiptWeightError({netKg:'0.2',tareKg:'0.1',grossKg:'0.3',missingNote:'',weighInAt:'2026-11-25T23:00:00+07:00',weighOutAt:'2026-11-26T01:00:00+07:00'}),'');
 assert.match(receiptWeightError({netKg:'20',tareKg:'10',grossKg:'40',missingNote:'',weighInAt:null,weighOutAt:null}),/สุทธิ/);
 assert.equal(receiptWeightError({netKg:'20',tareKg:null,grossKg:'40',missingNote:'ใบชั่งไม่ระบุน้ำหนักรถ',weighInAt:null,weighOutAt:null}),'');
 assert.match(receiptWeightError({netKg:'20',tareKg:null,grossKg:'40',missingNote:'',weighInAt:null,weighOutAt:null}),/หมายเหตุ/);
 assert.match(receiptWeightError({netKg:'20',tareKg:'10',grossKg:'30',missingNote:'',weighInAt:'2026-11-26T01:00:00+07:00',weighOutAt:'2026-11-25T23:00:00+07:00'}),/ชั่งออก/);
});
test('Thai local clock supports overnight dates and rejects impossible dates and 24 hours',()=>{
 assert.equal(readClayTime('2026-11-26','0','5'),'2026-11-26T00:05:00+07:00');
 for(const input of [['2026-02-30','12','00'],['2026-11-26','24','00'],['2026-11-26','','00']])assert.throws(()=>readClayTime(...input as [string,string,string]));
 assert.equal(readClayTime('','','',true),null);
});
test('module writes require read plus the specific operation permission',()=>{
 assert.equal(canRawClay(['raw_clay.record'],'record'),false);
 assert.equal(canRawClay(['raw_clay.read','raw_clay.record'],'record'),true);
 assert.equal(canRawClay(['raw_clay.read','raw_clay.record'],'correct'),false);
});
test('draft and confirmation enforce photo limits and supported input sizes',()=>{
 assert.doesNotThrow(()=>validatePhotos([],false));assert.throws(()=>validatePhotos([],true));
 assert.throws(()=>validatePhotos([{type:'image/gif',size:100}],false));
 assert.throws(()=>validatePhotos([{type:'image/png',size:8*1024*1024+1}],false));
 assert.throws(()=>validatePhotos(Array.from({length:4},()=>({id:1})),false));
 assert.doesNotThrow(()=>validatePhotos([{id:12}],true));
});
test('request ids remain UUIDs on an HTTP LAN where randomUUID is unavailable',()=>{
 const id=createClayRequestId({getRandomValues:bytes=>{bytes.fill(255);return bytes;}});
 assert.equal(id,'ffffffff-ffff-4fff-bfff-ffffffffffff');
});
test('a partial receipt draft preserves entered bill fields without inventing missing weight or worker',()=>{
 const form=new FormData();form.set('supplier',' ผู้ขายหนึ่ง ');form.set('tradeName','DKL');
 const data=readClayForm(form,'receipt',false,false);
 assert.equal(data.supplier,'ผู้ขายหนึ่ง');assert.equal(data.tradeName,'DKL');
 assert.equal(data.netKg,undefined);assert.equal(data.employeeId,0);assert.equal(data.weighInAt,null);
 assert.throws(()=>readClayForm(form,'receipt',true,false));
});
test('confirmed receipts keep type/color identities and reject a factory time before weighing out',()=>{
 const form=new FormData();for(const [key,value]of Object.entries({clayTypeId:'4',clayColorId:'8',employeeId:'7',supplier:'ผู้ขาย',billNumber:'B1',documentDate:'2026-11-26',tradeName:'DKL',netKg:'20.125',tareKg:'10',grossKg:'30.125',plateIn:'ก1',plateOut:'ก1',weighInAt_date:'2026-11-25',weighInAt_hour:'23',weighInAt_minute:'00',weighOutAt_date:'2026-11-26',weighOutAt_hour:'01',weighOutAt_minute:'00',occurredAt_date:'2026-11-26',occurredAt_hour:'02',occurredAt_minute:'00'}))form.set(key,value);
 const data=readClayForm(form,'receipt',true,true);assert.equal(data.clayTypeId,4);assert.equal(data.clayColorId,8);assert.equal(data.netKg,'20.125');assert.equal(data.occurredAt,'2026-11-26T02:00:00+07:00');
 assert.equal(readClayForm(form,'receipt',true,false).clayColorId,null);
 form.set('occurredAt_hour','00');assert.throws(()=>readClayForm(form,'receipt',true,true),/รับ.*ชั่งออก/);
});
test('duplicate receipt warnings distinguish separate truck trips and ignore cancelled or own documents',()=>{
 const data={clayTypeId:1,clayColorId:null,employeeId:1,occurredAt:'2026-11-26T02:00:00+07:00',notes:'',supplier:' ผู้ขาย ',billNumber:' BILL-1 ',documentDate:'2026-11-26',plateIn:'กก 123',plateOut:'กก 123'};
 const base:ClayDocument={id:1,number:'RC-1',kind:'receipt',status:'confirmed',version:1,data:{...data,supplier:'ผู้ขาย',billNumber:'bill-1'},imageIds:[],actor:'admin',createdAt:'2026-11-26T02:00:00+07:00',updatedAt:'2026-11-26T02:00:00+07:00'};
 assert.deepEqual(receiptDuplicates(data,[base,{...base,id:2,data:{...base.data,plateIn:'กก999',plateOut:'กก999'}},{...base,id:3,status:'cancelled'},{...base,id:4,data:{...base.data,documentDate:'2026-11-25'}}]).map(d=>d.id),[1]);
 assert.deepEqual(receiptDuplicates(data,[base],1),[]);
 assert.deepEqual(receiptDuplicates({...data,billNumber:''},[base]),[]);
});
