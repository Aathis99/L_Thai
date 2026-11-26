import {createHash} from 'node:crypto';
import {all,one,audit,type Db} from '../database.js';
import {fail,text} from '../auth.js';
import {encodeImage} from './images.js';
import {replay,validateData,ordered,kg,formatKg,type Document,type Kind} from './model.js';
export const documents=async(db:Db):Promise<Document[]> => (await all(db,'SELECT document FROM raw_clay_documents ORDER BY id')).map(r=>r.document);
export async function detail(db:Db,id:number){
 const row=await one(db,'SELECT document FROM raw_clay_documents WHERE id=$1',[id]);if(!row)fail('ไม่พบเอกสาร',404);
 const history=await all(db,'SELECT version,document,actor,at,reason,movements FROM raw_clay_revisions WHERE document_id=$1 ORDER BY version',[id]);
 const createdBy=row.document.createdBy??history[0]?.actor??row.document.actor;
 const changes=await all(db,`SELECT document_id,version,actor,at,reason,(SELECT value FROM jsonb_array_elements(movements) WHERE value->>'documentId'=$2) movement FROM raw_clay_revisions WHERE movements @> $1::jsonb ORDER BY id`,[JSON.stringify([{documentId:id}]),String(id)]);
 return {document:{...row.document,createdBy},history:history.map(h=>({...h,document:{...h.document,createdBy}})),currentMovement:ledger(await documents(db)).find(m=>m.documentId===id)??null,movementHistory:changes.filter((h,i)=>i===0||JSON.stringify(h.movement)!==JSON.stringify(changes[i-1].movement)).map(h=>({sourceDocumentId:h.document_id,version:h.version,actor:h.actor,at:h.at,reason:h.reason,movement:h.movement}))};
}
export async function duplicates(db:Db,q:Record<string,any>){
 const normalize=(v:any)=>String(v??'').replace(/\s+/g,'').toLowerCase();const values=[normalize(q.supplier),normalize(q.billNumber),String(q.documentDate??''),normalize(q.plate)];if(values.some(v=>!v))return {documents:[]};
 const rows=await all(db,`SELECT document || jsonb_build_object('createdBy',coalesce(document->>'createdBy',(SELECT actor FROM raw_clay_revisions WHERE document_id=raw_clay_documents.id ORDER BY version LIMIT 1),document->>'actor')) document FROM raw_clay_documents WHERE document->>'kind'='receipt' AND document->>'status'<>'cancelled' AND id<>$5 AND lower(regexp_replace(document->'data'->>'supplier','\\s','','g'))=$1 AND lower(regexp_replace(document->'data'->>'billNumber','\\s','','g'))=$2 AND document->'data'->>'documentDate'=$3 AND lower(regexp_replace(coalesce(nullif(document->'data'->>'plateOut',''),document->'data'->>'plateIn'),'\\s','','g'))=$4 ORDER BY id DESC LIMIT 100`,[...values,Number(q.ownId)||0]);return {documents:rows.map(r=>r.document)};
}
export async function state(db:Db,q:Record<string,any>){
 const snapshot=await one(db,`SELECT revision,coalesce((SELECT jsonb_agg(document ORDER BY id) FROM raw_clay_documents),'[]'::jsonb) documents FROM raw_clay_state WHERE id=1`);const docs:Document[]=snapshot.documents;const page=Math.max(1,Math.trunc(Number(q.page)||1));const pageSize=Math.min(100,Math.max(1,Math.trunc(Number(q.pageSize)||30)));
 for(const field of ['from','to'])if(q[field]&&!/^\d{4}-\d{2}-\d{2}$/.test(q[field]))fail('ช่วงวันที่ไม่ถูกต้อง');
 const search=String(q.search||'').toLowerCase();const filtered=docs.filter(d=>(!q.kind||d.kind===q.kind)&&(!q.status||d.status===q.status)&&(!q.clayTypeId||d.data.clayTypeId===Number(q.clayTypeId))&&(!search||JSON.stringify(d.data).toLowerCase().includes(search)||d.number.toLowerCase().includes(search))&&(!q.from||String(d.data.occurredAt||'').slice(0,10)>=q.from)&&(!q.to||String(d.data.occurredAt||'').slice(0,10)<=q.to)).reverse();
 return {revision:snapshot.revision,documents:filtered.slice((page-1)*pageSize,page*pageSize),total:filtered.length,page,pageSize,stock:replay(docs),summary:replay(docs,q.from,q.to),clay_types:await all(db,'SELECT id,code,name,active FROM clay_types ORDER BY id'),clay_colors:await all(db,'SELECT id,code,name,active FROM clay_colors ORDER BY id'),employees:await all(db,`SELECT id,concat_ws(' ',nullif(prefix,''),first_name,nullif(last_name,'')) name,active FROM employees WHERE archived=0 ORDER BY code`)};
}
function actionPermission(actionName:string,kind:Kind):string{if(actionName==='correct'||actionName==='cancel')return 'raw_clay.correct';if(actionName==='confirm')return 'raw_clay.confirm';return kind==='adjustment'?'raw_clay.adjust':'raw_clay.record';}
function ledger(docs:Document[]){const balances=new Map<string,number>();return ordered(docs).map(d=>{const key=d.data.clayTypeId+':'+(d.data.clayColorId??'');const before=balances.get(key)||0;const after=d.kind==='adjustment'?kg(d.data.countedKg):before+(d.kind==='receipt'?kg(d.data.netKg):-kg(d.data.quantityKg));balances.set(key,after);return {documentId:d.id,clayTypeId:d.data.clayTypeId,clayColorId:d.data.clayColorId??null,beforeKg:formatKg(before),deltaKg:formatKg(after-before),afterKg:formatKg(after)};});}
export async function action(db:Db,body:any,actor:{id:number;username:string;permissions:string[]}){
 if(!body||!/^[-a-fA-F0-9]{36}$/.test(body.requestId||'')||!['save','confirm','correct','cancel'].includes(body.action)||!body.payload||typeof body.payload!=='object')fail('คำขอไม่ถูกต้อง');
 const fingerprint=createHash('sha256').update(JSON.stringify({revision:body.revision,action:body.action,payload:body.payload})).digest('hex');

 const current=await one(db,'SELECT revision FROM raw_clay_state WHERE id=1 FOR UPDATE');
 const p=body.payload;let docs=await documents(db);let old:Document|undefined;
 if(p.id!==undefined){if(!Number.isInteger(p.id)||p.id<=0)fail('รหัสเอกสารไม่ถูกต้อง');old=docs.find(d=>d.id===p.id);if(!old)fail('ไม่พบเอกสาร',404);}
 const kind:Kind=old?.kind||p.kind;if(!['receipt','issue','adjustment'].includes(kind))fail('ประเภทเอกสารไม่ถูกต้อง');
 if(!actor.permissions.includes(actionPermission(body.action,kind)))fail('คุณไม่มีสิทธิ์ทำรายการนี้',403);
 if((kind==='adjustment')&&!actor.permissions.includes('raw_clay.adjust'))fail('คุณไม่มีสิทธิ์ปรับยอด',403);
 const prior=await one(db,'SELECT * FROM raw_clay_requests WHERE request_id=$1',[body.requestId]);if(prior){if(prior.actor_id!==actor.id||prior.fingerprint!==fingerprint)fail('รหัสคำขอนี้ใช้กับข้อมูลอื่นแล้ว',409);return prior.response;}
 if(body.revision!==current.revision)fail('ข้อมูลเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุด โดยเก็บค่าที่กรอกไว้',409);
 const mode=body.action;
 if(mode==='confirm'&&(p.data!==undefined||p.images!==undefined)&&!actor.permissions.includes(kind==='adjustment'?'raw_clay.adjust':'raw_clay.record'))fail('คุณไม่มีสิทธิ์แก้ข้อมูลหรือภาพขณะยืนยัน',403);const reason=mode==='correct'||mode==='cancel'?text(p.reason,'เหตุผล',true,2000):'';
 if(mode==='save'&&old&&old.status!=='draft'||mode==='confirm'&&(!old||old.status!=='draft')||mode==='correct'&&old?.status!=='confirmed'||mode==='cancel'&&(!old||old.status==='cancelled'))fail('สถานะเอกสารเปลี่ยนแล้ว',409);
 const input={...(p.data??old?.data??{})};if(kind==='adjustment')input.occurredAt=old?.status==='confirmed'?old.data.occurredAt:new Date().toLocaleString('sv-SE',{timeZone:'Asia/Bangkok'}).replace(' ','T').slice(0,16)+':00+07:00';
 let data=mode==='cancel'?{...old!.data}:validateData(kind,input,mode==='confirm'||mode==='correct');
 if(kind==='adjustment'){if(old?.status==='confirmed')data.occurredAt=old.data.occurredAt;else if(mode==='confirm'||mode==='save')data.occurredAt=new Date().toLocaleString('sv-SE',{timeZone:'Asia/Bangkok'}).replace(' ','T').slice(0,16)+':00+07:00';}
 if(mode==='confirm'||mode==='correct'){
  const clay=await one(db,'SELECT * FROM clay_types WHERE id=$1',[data.clayTypeId]);if(!clay||(!clay.active&&old?.data.clayTypeId!==data.clayTypeId))fail('ประเภทดินไม่พร้อมใช้งาน');
  if(clay.code==='COLORED'){const color=await one(db,'SELECT * FROM clay_colors WHERE id=$1',[data.clayColorId]);if(!color||(!color.active&&old?.data.clayColorId!==data.clayColorId))fail('กรุณาเลือกสีดินที่ใช้งาน');data.clayColorName=old?.status==='confirmed'&&old.data.clayTypeId===data.clayTypeId&&old.data.clayColorId===data.clayColorId?old.data.clayColorName:color.name;}else if(data.clayColorId)fail('ดินประเภทนี้ไม่ใช้สีดิน');
  const emp=await one(db,`SELECT id,concat_ws(' ',nullif(prefix,''),first_name,nullif(last_name,'')) name,active,archived FROM employees WHERE id=$1`,[data.employeeId]);if(!emp||((!emp.active||emp.archived)&&old?.data.employeeId!==data.employeeId))fail('พนักงานไม่พร้อมใช้งาน');
  data.employeeName=old?.status==='confirmed'&&old.data.employeeId===data.employeeId?old.data.employeeName:emp.name;data.clayTypeName=old?.status==='confirmed'&&old.data.clayTypeId===data.clayTypeId?old.data.clayTypeName:clay.name;
 }
 let imageIds=old?.imageIds||[];if(p.images!==undefined){if(!Array.isArray(p.images)||p.images.length>3)fail('แนบภาพได้ไม่เกิน 3 รูป');imageIds=[];}
 if(kind==='receipt'&&(mode==='confirm'||mode==='correct')&&(p.images??imageIds).length<1)fail('ใบรับที่ยืนยันต้องมีภาพ 1–3 รูป');
 if(kind!=='receipt'&&p.images?.length)fail('แนบภาพเฉพาะใบรับดิน');
 const now=new Date().toISOString();const id=old?.id??(await one(db,"INSERT INTO raw_clay_documents(document) VALUES('{}') RETURNING id")).id;
 if(p.images){for(const image of p.images){if(image.id!==undefined){if(!Number.isInteger(image.id)||!await one(db,'SELECT 1 FROM raw_clay_images WHERE id=$1 AND document_id=$2',[image.id,id]))fail('ภาพไม่ใช่ของเอกสารนี้');imageIds.push(image.id);}else{const bytes=await encodeImage(image.data,image.contentType);imageIds.push((await one(db,'INSERT INTO raw_clay_images(document_id,bytes) VALUES($1,$2) RETURNING id',[id,bytes])).id);}}if(new Set(imageIds).size!==imageIds.length)fail('ภาพซ้ำ');}
 const originalCreator=old?.createdBy??(old?(await one(db,'SELECT actor FROM raw_clay_revisions WHERE document_id=$1 ORDER BY version LIMIT 1',[old.id]))?.actor:undefined)??old?.actor??actor.username;
 const doc:Document={id,number:old?.number??`${kind==='receipt'?'RC':kind==='issue'?'RI':'RA'}-${new Date().getFullYear()+543}-${String(id).padStart(6,'0')}`,kind,status:mode==='cancel'?'cancelled':mode==='confirm'||mode==='correct'?'confirmed':'draft',version:(old?.version||0)+1,sequence:old?.sequence??(mode==='confirm'?current.revision+1:null),data,imageIds,createdAt:old?.createdAt||now,updatedAt:now,actor:actor.username,createdBy:originalCreator,...(old?.confirmedBy?{confirmedBy:old.confirmedBy}:mode==='confirm'?{confirmedBy:actor.username}:{})};
 docs=docs.filter(d=>d.id!==id).concat(doc);replay(docs);const movements=ledger(docs);
 await db.query('UPDATE raw_clay_documents SET document=$2 WHERE id=$1',[id,JSON.stringify(doc)]);
 await db.query('INSERT INTO raw_clay_revisions(document_id,version,document,actor,reason,movements) VALUES($1,$2,$3,$4,$5,$6)',[id,doc.version,JSON.stringify(doc),actor.username,reason||data.reason||'',JSON.stringify(movements)]);
 await db.query('UPDATE raw_clay_state SET revision=revision+1 WHERE id=1');const response={revision:current.revision+1,document:doc};
 await db.query('INSERT INTO raw_clay_requests(request_id,actor_id,fingerprint,response) VALUES($1,$2,$3,$4)',[body.requestId,actor.id,fingerprint,JSON.stringify(response)]);await audit(db,actor.username,'raw_clay.'+mode,doc.number);return response;
}
