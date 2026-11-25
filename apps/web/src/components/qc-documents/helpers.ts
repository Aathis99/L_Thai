import type {QcReport,QcDocumentEntry,QcDocumentLoad} from '../../../../api/src/qc-documents/types.ts';
import {symptomNames} from '../../../../api/src/qc-documents/types.ts';

export const outcomeLabels={'A+':'A+',waste:'เสีย',underfired:'ไม่สุก',touchup:'แต้ม'};
export const reportRevisionLabel=(revision?:number)=>revision===undefined?'ร่าง':revision===0?'ฉบับทางการ':`ฉบับแก้ไขครั้งที่ ${revision}`;
export const reportReferences=(report:QcReport)=>report.orders.map(o=>o.reference).join(' / ');
export function sourceLabel(source:QcDocumentLoad){return source.parentQcId?`${source.code} · จาก${source.parentDocumentNumber?'ใบ '+source.parentDocumentNumber:'ผลคัดเดิม'} · ผลคัด #${source.parentQcId} (${source.repairKind==='underfired'?'ไม่สุก':'แต้ม'})`:source.code;}
export function refreshedEditor(original:QcDocumentEntry|undefined,latest:QcDocumentEntry|undefined){
 if(!original)return {kind:'keep' as const};
 if(!latest||latest.status!==original.status)return {kind:'close' as const};
 return JSON.stringify(original)===JSON.stringify(latest)?{kind:'keep' as const}:{kind:'replace' as const,entry:latest};
}
export function printedSymptoms(actual:{name:string;pieces:number}[]){return [...symptomNames,...actual.filter(d=>!symptomNames.includes(d.name)).map(d=>d.name)].map(name=>({name,pieces:actual.find(d=>d.name===name)?.pieces??0}));}
export const localQcTime=(value?:string)=>new Date((value?Date.parse(value):Date.now())+7*3600000).toISOString().slice(0,16);
export const qcDate=(value:string)=>value?new Date(value).toLocaleDateString('th-TH',{timeZone:'Asia/Bangkok'}):'—';
export const qcDateTime=(value:string)=>value?new Date(value).toLocaleString('th-TH',{timeZone:'Asia/Bangkok',dateStyle:'short',timeStyle:'short'}):'—';
export function thaiDateRange(values:string[]){const dates=[...new Set(values.filter(Boolean).map(v=>new Date(Date.parse(v)+7*3600000).toISOString().slice(0,10)))].sort();return dates.length===0?'—':dates.length===1?qcDate(dates[0]+'T00:00:00+07:00'):qcDate(dates[0]+'T00:00:00+07:00')+' – '+qcDate(dates.at(-1)!+'T00:00:00+07:00');}
export function reportStatus(r:QcReport){return r.officialCurrent?'ฉบับทางการ':r.ready?'คัดครบ รอออกฉบับทางการ':r.confirmed===0?'ร่าง':r.pending>0?'กำลังคัด':'คัดครบ รอข้อมูล/ร่างค้าง';}
export function matchesQc(r:QcReport,query:string){const haystack=[r.number,r.name,r.clay,r.clayColor,r.color,r.kiln,...r.orders.flatMap(o=>[o.orderKey,o.reference])].join(' ').toLocaleLowerCase();return haystack.includes(query.trim().toLocaleLowerCase());}
function number(form:FormData,key:string){const raw=String(form.get(key)??'').trim();const value=raw===''?0:Number(raw);if(!Number.isSafeInteger(value)||value<0)throw Error('กรุณาระบุจำนวนแผ่นเต็มตั้งแต่ 0 ขึ้นไป');return value;}
export function readEntryForm(form:FormData,loadIds:number[],symptoms:string[],includeZero=false){
 return loadIds.map(loadId=>{
  const prefix=`load_${loadId}_`,counts={'A+':number(form,prefix+'A+'),underfired:number(form,prefix+'underfired'),touchup:number(form,prefix+'touchup')};
  const defects=symptoms.map((name,i)=>({name,pieces:number(form,prefix+'defect_'+i)})).filter(d=>d.pieces>0);
  const other=number(form,prefix+'other_qty'),name=String(form.get(prefix+'other_name')??'').trim();
  if(other>0){if(!name)throw Error('กรุณาระบุชื่ออาการเพิ่มเติม');if(defects.some(d=>d.name===name))throw Error('ชื่ออาการซ้ำ');defects.push({name,pieces:other});}
  return {loadId,counts,defects};
 }).filter(line=>includeZero||Object.values(line.counts).reduce((a,b)=>a+b,0)+line.defects.reduce((a,b)=>a+b.pieces,0)>0);
}
