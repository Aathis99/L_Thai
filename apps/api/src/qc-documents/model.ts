import {fail,text} from '../auth.js';
import {calendarDate,integer} from '../pressing/catalog.js';
import {loadById,rootItem,transition,type Model,type Command} from '../kiln-prototype/model.js';
import type {DocumentCounts,QcDocument,QcDocumentContext,QcDocumentEntry,QcDocumentLine,QcCandidate,QcReport} from './types.js';

export const symptomNames=['เศษ','มุมเข้า','มุมออก','ฉีกข้าง','อลูมิน่า','งอ','เปิด','แอ่น','หัก','ฉีก','แร่','เศษไม้','รู','กระจก','ดิน','เหล็ก','ร้าวหลัง','ฟอง','เศษชุบ','หยด','ซิลิกอน','หด','ไม่สุก'];
const empty=():DocumentCounts=>({'A+':0,waste:0,underfired:0,touchup:0});
const sum=(values:number[])=>values.reduce((a,b)=>a+b,0);
const total=(counts:DocumentCounts)=>sum(Object.values(counts));
const add=(a:DocumentCounts,b:DocumentCounts)=>{for(const k of Object.keys(a) as (keyof DocumentCounts)[])a[k]+=b[k]??0;};
function date(value:unknown){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))fail('วันเวลาคัดไม่ถูกต้อง');
 calendarDate(value.slice(0,10),'วันที่คัด');
 if(Number(value.slice(11,13))>23||Number(value.slice(14,16))>59||(value[16]===':'&&Number(value.slice(17,19))>59))fail('เวลาคัดไม่ถูกต้อง');
 return value;
}
function grouped(s:Model):QcCandidate[]{
 const groups=new Map<string,QcCandidate>();
 for(const round of s.rounds.filter(r=>r.unloadedAt))for(const load of round.loads.filter(l=>l.pieces>0)){
  const item=rootItem(s,load.sourceId);
  const identity=item.productId??(item.typeId?`type:${item.typeId}`:`source:${item.id}`);
  const groupKey=JSON.stringify([round.id,identity,item.typeId??item.id,item.clayTypeId??item.clay,item.clayColorId??item.clayColor??null,item.colorId??(item.color?item.id:null)]);
  const group=groups.get(groupKey)??{groupKey,roundId:round.id,loads:[]};
  group.loads.push({id:load.id,sourceId:load.sourceId,orderKey:item.orderKey,reference:item.reference,name:item.name,clay:item.clay,clayColor:item.clayColor,color:item.color,code:item.purpose==='stock'?(load.sourceId.startsWith('repair:')?'OSP':'OS'):(load.sourceId.startsWith('repair:')?'ODP':'OD')});
  groups.set(groupKey,group);
 }
 return [...groups.values()];
}
export function documentCandidates(s:Model):QcCandidate[]{
 return grouped(s).filter(g=>!s.qcDocuments?.some(d=>d.groupKey===g.groupKey)&&!s.qcs.some(q=>g.loads.some(l=>l.id===q.loadId)));
}
export function historicalQcGroup(s:Model,loadId:number){
 const group=grouped(s).find(g=>g.loads.some(l=>l.id===loadId));
 return !!group&&!s.qcDocuments?.some(d=>d.groupKey===group.groupKey)&&s.qcs.some(q=>group.loads.some(l=>l.id===q.loadId));
}
function parseLines(value:unknown,doc:QcDocument):QcDocumentLine[]{
 if(!Array.isArray(value))fail('รายการผลคัดไม่ถูกต้อง');
 const ids=new Set<number>();
 return value.map(raw=>{
  if(!raw||typeof raw!=='object')fail('รายการผลคัดไม่ถูกต้อง');
  const loadId=integer(raw.loadId,'รายการเข้าเตา',1);
  if(!doc.loads.some(l=>l.id===loadId)||ids.has(loadId))fail('รายการเข้าเตาซ้ำหรือไม่อยู่ในใบนี้');ids.add(loadId);
  const values=raw.counts??{};
  if((values['A-']??0)!==0||(values.B??0)!==0)fail('ยกเลิกเกรด A- และ B สำหรับผลคัดใหม่แล้ว');
  if(Object.keys(values).some(k=>!['A+','A-','B','waste','underfired','touchup'].includes(k)))fail('กลุ่มผลคัดไม่ถูกต้อง');
  if(!Array.isArray(raw.defects??[]))fail('อาการเสียไม่ถูกต้อง');
  const defects=(raw.defects??[]).map((d:any)=>({name:text(d?.name,'ชื่ออาการ',true,120),pieces:integer(d?.pieces,'จำนวนอาการเสีย',1)}));
  if(new Set(defects.map((d:{name:string})=>d.name)).size!==defects.length)fail('ชื่ออาการเสียซ้ำ');
  const waste=sum(defects.map((d:{pieces:number})=>d.pieces));
  if(values.waste!==undefined&&values.waste!==waste)fail('ยอดเสียต้องตรงกับอาการเสียรวม');
  return {loadId,counts:{'A+':integer(values['A+']??0,'A+'),waste,underfired:integer(values.underfired??0,'ไม่สุก'),touchup:integer(values.touchup??0,'แต้ม')},defects};
 });
}
function parseEntry(c:Command,doc:QcDocument,ctx:QcDocumentContext,previous?:QcDocumentEntry):QcDocumentEntry{
 if(!Array.isArray(c.workerIds)||new Set(c.workerIds).size!==c.workerIds.length)fail('รายชื่อผู้คัดไม่ถูกต้อง');
 const workers=c.workerIds.map((id:unknown)=>{
  const old=previous?.workers.find(w=>w.id===id),worker=ctx.workers.find(w=>w.id===id);
  if(!worker?.active&&!old)fail('ไม่พบพนักงานผู้คัดที่ใช้งานอยู่');
  return structuredClone(worker?.active?worker:old!);
 });
 return {id:previous?.id??0,status:'draft',at:c.at?date(c.at):'',workers,note:text(c.note??'','หมายเหตุ',false,2000),lines:parseLines(c.lines,doc),recordedBy:previous?.recordedBy??ctx.actor};
}
function confirmedEntry(s:Model,entry:QcDocumentEntry){
 return {...entry,lines:entry.lines.map(line=>{const q=s.qcs.find(q=>q.id===line.qcId);if(!q)fail('ไม่พบผลคัดต้นทางของใบ QC',409);return {...line,counts:{'A+':q.counts['A+'],waste:q.counts.waste,underfired:q.counts.underfired,touchup:q.counts.touchup},defects:q.defects};})};
}
export function documentReport(s:Model,doc:QcDocument):QcReport{
 const round=s.rounds.find(r=>r.id===doc.roundId)??fail('ไม่พบรอบเผาของใบ QC',409);
 const entries=doc.entries.filter(e=>e.status==='confirmed').map(e=>confirmedEntry(s,e));
 const counts=empty(),symptoms=new Map<string,number>(),orders=new Map<string,QcReport['orders'][number]>();
 for(const l of doc.loads){const order=orders.get(l.orderKey)??{orderKey:l.orderKey,reference:l.reference,loadIds:[],input:0,counts:empty()};order.loadIds.push(l.id);order.input+=loadById(s,l.id).pieces;orders.set(l.orderKey,order);}
 for(const entry of entries)for(const line of entry.lines){add(counts,line.counts);add(orders.get(doc.loads.find(l=>l.id===line.loadId)!.orderKey)!.counts,line.counts);for(const d of line.defects)symptoms.set(d.name,(symptoms.get(d.name)??0)+d.pieces);}
 const input=sum([...orders.values()].map(o=>o.input)),confirmed=total(counts),draftPieces=sum(doc.entries.filter(e=>e.status==='draft').flatMap(e=>e.lines.map(l=>total(l.counts))));
 const missing:string[]=[];
 if(!input||doc.loads.some(l=>sum(entries.flatMap(e=>e.lines.filter(x=>x.loadId===l.id).map(x=>total(x.counts))))!==loadById(s,l.id).pieces))missing.push('ยังคัดไม่ครบทุกงานต้นทาง');
 if(doc.entries.some(e=>e.status==='draft'))missing.push('มีผลคัดร่างค้าง');
 if(!round.startedAt||!round.withdrawnAt||!round.unloadedAt)missing.push('ข้อมูลวันเวลาในงานเตายังไม่ครบ');
 if(entries.some(e=>!e.at||!e.workers.length))missing.push('วันที่หรือผู้คัดยังไม่ครบ');
 const first=doc.loads[0];if(!first?.name||!first.clay||doc.loads.some(l=>!l.reference))missing.push('ข้อมูลสินค้า/ดิน/ออเดอร์ยังไม่ครบ');
 return {number:doc.number,roundId:doc.roundId,kiln:s.kilns.find(k=>k.id===round.kilnId)?.name??String(round.kilnId),rail:round.rail,name:first.name,clay:first.clay,clayColor:first.clayColor??'',color:first.color,
  startedAt:round.startedAt,withdrawnAt:round.withdrawnAt??'',unloadedAt:round.unloadedAt??'',input,output:input,confirmed,pending:input-confirmed,draftPieces,counts,
  defects:[...symptoms].map(([name,pieces])=>({name,pieces})),orders:[...orders.values()],entries,ready:missing.length===0,missing,
  officialCurrent:missing.length===0&&doc.reports.at(-1)?.dataVersion===doc.version};
}
function checkConfirmation(s:Model,doc:QcDocument,entry:QcDocumentEntry){
 const round=s.rounds.find(r=>r.id===doc.roundId)!;
 if(!entry.workers.length)fail('กรุณาระบุผู้คัดจริง');
 if(!entry.at||Date.parse(date(entry.at))<Date.parse(round.unloadedAt??''))fail('วันเวลาคัดต้องไม่ก่อนเอาของลง');
 if(!entry.lines.length||!sum(entry.lines.map(l=>total(l.counts))))fail('กรุณาระบุจำนวนที่คัด');
}
export function transitionDocument(input:Model,c:Command,ctx:QcDocumentContext):Model{
 let s=structuredClone(input);s.qcDocuments??=[];
 if(c.op==='qc-document-open'){
  if(s.qcDocuments.some(d=>d.loads.some(l=>l.id===c.loadId)))return s;
  const group=documentCandidates(s).find(g=>g.loads.some(l=>l.id===c.loadId))??fail('งานนี้เป็นข้อมูลเดิม มีประวัติคัดแล้ว หรือยังเอาของลงไม่เสร็จ',409);
  const year=new Date(Date.parse(date(ctx.now))+7*3600000).getUTCFullYear()+543;
  const prefix=`QC-${year}-`,sequence=Math.max(0,...s.qcDocuments.filter(d=>d.number.startsWith(prefix)).map(d=>Number(d.number.slice(prefix.length))))+1;
  s.qcDocuments.push({id:s.nextId++,number:prefix+String(sequence).padStart(6,'0'),groupKey:group.groupKey,roundId:group.roundId,createdAt:ctx.now,createdBy:ctx.actor,version:0,loads:group.loads,entries:[],reports:[],corrections:[]});return s;
 }
 const doc=s.qcDocuments.find(d=>d.id===c.documentId)??fail('ไม่พบใบ QC',404);
 const previous=doc.entries.find(e=>e.id===c.entryId);
 switch(c.op){
  case 'qc-draft-save':{
   if(c.entryId!==undefined&&(!previous||previous.status!=='draft'))fail('แก้ร่างที่ยืนยันหรือยกเลิกแล้วไม่ได้',409);
   const entry=parseEntry(c,doc,ctx,previous);entry.id=previous?.id??s.nextId++;
   if(previous)doc.entries[doc.entries.indexOf(previous)]=entry;else doc.entries.push(entry);break;
  }
  case 'qc-draft-delete':
   if(!previous||previous.status!=='draft')fail('ไม่พบผลคัดร่าง',409);previous.status='cancelled';break;
  case 'qc-draft-confirm':{
   if(!previous||previous.status!=='draft')fail('ผลคัดนี้ยืนยันหรือยกเลิกแล้ว',409);
   // Re-resolve workers so an archived employee cannot be newly confirmed from an old draft.
   const checked=parseEntry({op:c.op,at:previous.at,workerIds:previous.workers.map(w=>w.id),note:previous.note,lines:previous.lines},doc,ctx);
   checkConfirmation(s,doc,checked);
   for(const line of previous.lines){s=transition(s,{op:'qc',loadId:line.loadId,at:previous.at,counts:line.counts,defects:line.defects,note:previous.note});line.qcId=s.qcs.at(-1)!.id;}
   const target=s.qcDocuments!.find(d=>d.id===doc.id)!,entry=target.entries.find(e=>e.id===previous.id)!;
   entry.lines=previous.lines;entry.status='confirmed';entry.workers=checked.workers;entry.confirmedBy=ctx.actor;entry.confirmedAt=ctx.now;target.version++;break;
  }
  case 'qc-document-correct':{
   if(!previous||previous.status!=='confirmed')fail('ไม่พบผลคัดที่ยืนยันแล้ว',409);
   const reason=text(c.reason,'เหตุผลแก้ไข',true,1000),entry=parseEntry(c,doc,ctx,previous);checkConfirmation(s,doc,entry);
   if(entry.lines.length!==previous.lines.length||entry.lines.some(l=>!previous.lines.some(old=>old.loadId===l.loadId)))fail('ห้ามเปลี่ยนต้นทางของผลคัดที่ยืนยันแล้ว');
   for(const line of entry.lines)line.qcId=previous.lines.find(old=>old.loadId===line.loadId)!.qcId;
   s=transition(s,{op:'correct',qcs:entry.lines.map(l=>({id:l.qcId,counts:l.counts,defects:l.defects})),allocations:c.allocations??[],repairReady:c.repairReady??[]});
   for(const line of entry.lines){const q=s.qcs.find(q=>q.id===line.qcId)!;q.at=entry.at;q.note=entry.note;if(s.allocations.some(a=>a.qcId===q.id&&Date.parse(a.at)<Date.parse(q.at)))fail('เวลาคัดที่แก้หลังเวลาจัดสรรเดิม');}
   const target=s.qcDocuments!.find(d=>d.id===doc.id)!;target.entries[target.entries.findIndex(e=>e.id===entry.id)]={...entry,status:'confirmed',confirmedBy:previous.confirmedBy,confirmedAt:previous.confirmedAt};target.version++;target.corrections.push({at:ctx.now,actor:ctx.actor,reason});break;
  }
  case 'qc-document-issue':{
   const report=documentReport(s,doc);if(!report.ready)fail('ยังออกฉบับทางการไม่ได้: '+report.missing.join(', '),409);
   if(!report.officialCurrent)doc.reports.push({revision:doc.reports.length,dataVersion:doc.version,createdAt:ctx.now,createdBy:ctx.actor,content:{...report,officialCurrent:true}});break;
  }
  default:fail('ไม่รองรับคำสั่งใบ QC');
 }
 return s;
}
function reportSignature(s:Model,doc:QcDocument){const {officialCurrent,ready,missing,draftPieces,...content}=documentReport(s,doc);return JSON.stringify(content);}
export function synchronizeDocuments(before:Model,after:Model):Model{
 for(const doc of after.qcDocuments??[]){const old=before.qcDocuments?.find(d=>d.id===doc.id);if(old&&old.version===doc.version&&reportSignature(before,old)!==reportSignature(after,doc))doc.version++;}
 return after;
}
