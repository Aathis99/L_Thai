import {fail,text} from '../auth.js';
export type Kind='receipt'|'issue'|'adjustment';
export type Data=Record<string,any>;
export interface Document {id:number;number:string;kind:Kind;status:'draft'|'confirmed'|'cancelled';version:number;sequence:number|null;data:Data;imageIds:number[];createdAt:string;updatedAt:string;actor:string;createdBy?:string;confirmedBy?:string;}
export function kg(value:unknown):number {if(typeof value!=='string'||!/^\d{1,10}(\.\d{1,3})?$/.test(value))fail('น้ำหนักต้องเป็นกิโลกรัม ทศนิยมไม่เกิน 3 ตำแหน่ง');const [a,b='']=value.split('.');return Number(a)*1000+Number(b.padEnd(3,'0'));}
export function formatKg(value:number):string{return (value<0?'-':'')+Math.floor(Math.abs(value)/1000)+'.'+String(Math.abs(value)%1000).padStart(3,'0');}
function validDate(value:string){const date=new Date(value);return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;}
const present=(v:unknown)=>v!==undefined&&v!==null&&v!=='';
export function validateData(kind:Kind,input:Data,confirmed:boolean):Data {
 if(!input||typeof input!=='object'||Array.isArray(input))fail('ข้อมูลเอกสารไม่ถูกต้อง');
 const allowed=['clayTypeId','clayColorId','occurredAt','employeeId','supplier','billNumber','documentDate','tradeName','netKg','quantityKg','countedKg','weighInAt','weighOutAt','tareKg','grossKg','plateIn','plateOut','missingNote','notes','reason'];
 const d:Data=Object.fromEntries(Object.entries(input).filter(([key])=>allowed.includes(key)));
 for(const field of ['netKg','quantityKg','countedKg','tareKg','grossKg'])if(present(d[field])){const n=kg(d[field]);if(field!=='countedKg'&&n<=0)fail('น้ำหนักต้องมากกว่าศูนย์');d[field]=formatKg(n);}
 for(const field of ['supplier','billNumber','tradeName','plateIn','plateOut','missingNote','notes','reason'])if(present(d[field]))d[field]=text(d[field],field,true,field==='notes'||field==='missingNote'||field==='reason'?2000:200);
 for(const field of ['occurredAt','weighInAt','weighOutAt'])if(present(d[field])&&(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?\+07:00$/.test(d[field])||!Number.isFinite(Date.parse(d[field]))||Number(d[field].slice(11,13))>23||Number(d[field].slice(14,16))>59||Number(d[field].slice(17,19)||0)>59||!validDate(d[field].slice(0,10))))fail('วันเวลาต้องเป็นเวลาไทย +07:00');
 if(present(d.documentDate)&&(!/^\d{4}-\d{2}-\d{2}$/.test(d.documentDate)||!validDate(d.documentDate)))fail('วันที่เอกสารไม่ถูกต้อง');
 if(present(d.tareKg)&&present(d.grossKg)){if(kg(d.grossKg)<=kg(d.tareKg)||present(d.netKg)&&kg(d.grossKg)-kg(d.tareKg)!==kg(d.netKg))fail('น้ำหนักสุทธิไม่ตรงกับน้ำหนักรถพร้อมดินลบน้ำหนักรถเปล่า');}
 if(present(d.weighInAt)&&present(d.weighOutAt)&&Date.parse(d.weighOutAt)<Date.parse(d.weighInAt))fail('เวลาชั่งออกต้องไม่ก่อนชั่งเข้า');
 if(present(d.weighOutAt)&&present(d.occurredAt)&&Date.parse(d.occurredAt)<Date.parse(d.weighOutAt))fail('เวลารับโรงงานต้องไม่ก่อนชั่งออก');
 if(confirmed){
  for(const field of ['clayTypeId','employeeId'])if(!Number.isInteger(d[field])||d[field]<=0)fail('กรุณาเลือกประเภทดินและพนักงาน');
  if(!present(d.occurredAt))fail('กรุณาระบุวันเวลาจริง');
  const required=kind==='receipt'?['supplier','billNumber','documentDate','tradeName','netKg']:kind==='issue'?['quantityKg']:['countedKg','reason'];
  for(const field of required)if(!present(d[field]))fail('กรุณาระบุ '+field);
  if(kind==='receipt'&&['weighInAt','weighOutAt','tareKg','grossKg','plateIn','plateOut'].some(f=>!present(d[f]))&&!present(d.missingNote))fail('กรุณาระบุหมายเหตุข้อมูลชั่งที่ขาด');
 }
 d.clayColorId=d.clayColorId||null;return d;
}
export interface Stock {clayTypeId:number;clayColorId:number|null;receivedKg:string;issuedKg:string;adjustmentKg:string;balanceKg:string;openingKg:string;}
export function ordered(docs:Document[]):Document[]{return docs.filter(d=>d.status==='confirmed').sort((a,b)=>Math.floor(Date.parse(a.data.occurredAt||'1970-01-01')/60000)-Math.floor(Date.parse(b.data.occurredAt||'1970-01-01')/60000)||(a.sequence??a.id)-(b.sequence??b.id));}
export function replay(docs:Document[],from?:string,to?:string):Stock[]{
 const groups=new Map<string,{clayTypeId:number;clayColorId:number|null;received:number;issued:number;adjustment:number;balance:number;opening:number}>();
 for(const d of ordered(docs)){
  const key=d.data.clayTypeId+':'+(d.data.clayColorId??'');let s=groups.get(key);if(!s){s={clayTypeId:d.data.clayTypeId,clayColorId:d.data.clayColorId??null,received:0,issued:0,adjustment:0,balance:0,opening:0};groups.set(key,s);}
  const day=new Date(d.data.occurredAt||'1970-01-01').toLocaleDateString('en-CA',{timeZone:'Asia/Bangkok'});if(to&&day>to)continue;
  const amount=kg(d.kind==='receipt'?d.data.netKg:d.kind==='issue'?d.data.quantityKg:d.data.countedKg);const delta=d.kind==='receipt'?amount:d.kind==='issue'?-amount:amount-s.balance;
  s.balance+=delta;if(!Number.isSafeInteger(s.balance))fail('ยอดรวมเกินความละเอียดที่รองรับ');if(s.balance<0)fail('ยอดดินติดลบที่เอกสาร '+d.id+' กรุณาตรวจรายการก่อนหน้า',409);
  if(from&&day<from)s.opening=s.balance;else if(d.kind==='receipt')s.received+=amount;else if(d.kind==='issue')s.issued+=amount;else s.adjustment+=delta;
 }
 return [...groups.values()].map(s=>({clayTypeId:s.clayTypeId,clayColorId:s.clayColorId,receivedKg:formatKg(s.received),issuedKg:formatKg(s.issued),adjustmentKg:formatKg(s.adjustment),balanceKg:formatKg(s.balance),openingKg:formatKg(s.opening)}));
}
