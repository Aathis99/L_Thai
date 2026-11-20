import pg from 'pg';
import {createHash} from 'node:crypto';
import {fail,text} from '../auth.js';
import {all,one,transaction,audit,type Db} from '../database.js';
import {listSources,setRange} from '../finishing/firing.js';
import {transition,sources,summarize,rootItem,loadById,type Item,type Model,type Command} from '../kiln-prototype/model.js';
import {differences} from '../kiln-prototype/store.js';

type Recorder={id:number;username:string};
type LiveItem=Item&{orderId:number;typeId:number;colorId:number|null};
type Debit={reservation_id:number;source_id:string;issue_id:number;batch_id:number|null;pieces:number;status:string};
const key=(v:{issue_id:number;batch_id:number|null})=>`${v.issue_id}:${v.batch_id??'breeze'}`;
const day=(at:string)=>new Date(Date.parse(at)+7*3600000).toISOString().slice(0,10);
const catalogVersion=(items:Item[])=>createHash('sha256').update(JSON.stringify(items)).digest('hex');

async function catalog(db:Db):Promise<LiveItem[]>{
 const orders=await all(db,`SELECT o.*,t.width,t.length,t.name,t.clay AS type_clay,t.pieces_per_sqm AS type_rate,
  c.minimum clay_min,c.maximum clay_max,g.minimum color_min,g.maximum color_max,h.minimum shape_min,h.maximum shape_max,
  coalesce(p.accepted,'[]') accepted,
  coalesce((SELECT sum(a.pieces) FROM firing_qc_allocations a WHERE a.order_id=o.id AND a.voided_at IS NULL),0)::integer legacy_ready
  FROM pressing_orders o JOIN pressing_types t ON t.id=o.type_id
  LEFT JOIN firing_clay_ranges c ON c.clay=coalesce(o.production_clay,t.clay)
  LEFT JOIN firing_color_ranges g ON g.color_id=o.color_id LEFT JOIN firing_shape_ranges h ON h.type_id=t.id
  LEFT JOIN kiln_order_grade_policies p ON p.order_id=o.id ORDER BY o.id`);
 const ready=await listSources(db),held=await all(db,`SELECT s.order_id,sum(d.pieces)::integer pieces
  FROM kiln_workflow_debits d JOIN kiln_workflow_sources s ON s.source_id=d.source_id GROUP BY s.order_id`);
 return orders.map(o=>{
  const batches=ready.filter(v=>v.order_id===o.id);
  return {id:'order:'+o.id,orderKey:'order:'+o.id,orderId:o.id,typeId:o.type_id,colorId:o.color_id,
   reference:o.customer_reference||`สั่งเก็บสต็อก #${o.id}`,name:`${o.width}×${o.length} ${o.name??''}`.trim(),
   clay:o.production_clay??o.type_clay,color:o.color_name??'',purpose:o.purpose,
   target:Math.max(0,(o.customer_pieces??o.target_pieces)-o.legacy_ready),rate:Number(o.pieces_per_sqm??o.type_rate??0),
   ready:batches.reduce((n,b)=>n+Number(b.waiting_pieces),0)+(held.find(h=>h.order_id===o.id)?.pieces??0),
   readyOn:batches.map(b=>b.ready_on).sort()[0]??new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Bangkok',dateStyle:'short'}).format(new Date()),
   clayRange:o.clay_min?[o.clay_min,o.clay_max]:undefined,colorRange:o.color_min?[o.color_min,o.color_max]:undefined,
   shapeRange:o.shape_min?[o.shape_min,o.shape_max]:undefined,accepted:o.accepted,synthetic:false};
 });
}
async function readLocked(db:Db){
 const row=await one(db,'SELECT revision,state FROM kiln_workflow_state WHERE id=1');
 const state:Model={...row.state,items:await catalog(db)};
 const events=await all(db,`SELECT id,revision,actor,recorded_at,payload->'command' command,before_state,after_state FROM kiln_workflow_events ORDER BY id DESC LIMIT 100`);
 return {revision:row.revision as number,catalogVersion:catalogVersion(state.items),state,summary:summarize(state),sources:sources(state),copiedItems:[] as Item[],
  history:events.map(({before_state,after_state,...event})=>({...event,changes:differences(before_state,after_state)}))};
}
export function readWorkflow(db:Db):ReturnType<typeof readLocked>{
 return db instanceof pg.Pool?transaction(db,client=>readLocked(client)):readLocked(db);
}
function origins(rows:Debit[]){return Object.fromEntries(rows.map(d=>[`${d.reservation_id}:${key(d)}`,d.pieces]));}

async function debitSources(db:Db,state:Model){
 const available=await listSources(db),previous=await all(db,'SELECT * FROM kiln_workflow_debits ORDER BY id') as Debit[];
 const wanted=state.reservations.filter(r=>r.status!=='cancelled'&&!r.sourceId.startsWith('repair:'));
 const remaining=new Map(available.map(s=>[key(s),Number(s.waiting_pieces)]));
 const next:Debit[]=[];
 // Keep existing physical origins; decreases release only this reservation's pieces.
 for(const old of previous){
  const reservation=wanted.find(r=>r.id===old.reservation_id);
  const retained=next.filter(d=>d.reservation_id===old.reservation_id).reduce((n,d)=>n+d.pieces,0);
  const keep=reservation?Math.max(0,Math.min(old.pieces,reservation.pieces-retained)):0;
  remaining.set(key(old),(remaining.get(key(old))??0)+old.pieces-keep);
  if(keep)next.push({...old,pieces:keep,status:reservation!.status});
 }
 for(const reservation of wanted){
  const item=state.items.find(i=>i.id===reservation.sourceId) as LiveItem|undefined;
  if(!item)fail('ไม่พบต้นทางจริงของรายการเตรียม',409);
  let needed=reservation.pieces-next.filter(d=>d.reservation_id===reservation.id).reduce((n,d)=>n+d.pieces,0);
  const candidates=available.filter(s=>s.order_id===item.orderId).sort((a,b)=>a.ready_on.localeCompare(b.ready_on)||a.issue_id-b.issue_id||(a.batch_id??0)-(b.batch_id??0));
  for(const source of candidates){
   const take=Math.min(needed,remaining.get(key(source))??0);if(take<=0)continue;
   const old=next.find(d=>d.reservation_id===reservation.id&&key(d)===key(source));
   if(old)old.pieces+=take;else next.push({reservation_id:reservation.id,source_id:item.id,issue_id:source.issue_id,batch_id:source.batch_id,pieces:take,status:reservation.status});
   remaining.set(key(source),(remaining.get(key(source))??0)-take);needed-=take;if(!needed)break;
  }
  if(needed>0)fail('ยอดของพร้อมจริงไม่พอหรือถูกใช้แล้ว กรุณาโหลดล่าสุด',409);
 }
 if([...remaining.values()].some(n=>n<0))fail('ยอดต้นทางจริงต่ำกว่าของที่กันหรือเข้าเผาแล้ว',409);
 for(const round of state.rounds)for(const load of round.loads.filter(l=>!l.sourceId.startsWith('repair:'))){
  for(const debit of next.filter(d=>d.reservation_id===load.reservationId)){
   const source=available.find(s=>key(s)===key(debit));
   if(!source||source.ready_on>day(round.startedAt))fail('วันเข้าเผาก่อนงานต้นทางจริงพร้อม',409);
  }
 }
 await db.query('DELETE FROM kiln_workflow_debits');
 for(const debit of next)await db.query(`INSERT INTO kiln_workflow_debits(reservation_id,source_id,issue_id,batch_id,pieces,status) VALUES($1,$2,$3,$4,$5,$6)`,[debit.reservation_id,debit.source_id,debit.issue_id,debit.batch_id,debit.pieces,debit.status]);
 return {before:origins(previous),after:origins(next)};
}
async function projectAllocations(db:Db,state:Model,actor:Recorder){
 const previous=await all(db,'SELECT id,recorded_by FROM kiln_workflow_allocations');
 await db.query('DELETE FROM kiln_workflow_allocations');
 for(const a of state.allocations.filter(a=>a.pieces>0)){
  const qc=state.qcs.find(q=>q.id===a.qcId)!;
  const item=rootItem(state,loadById(state,qc.loadId).sourceId) as LiveItem;
  await db.query(`INSERT INTO kiln_workflow_allocations(id,qc_id,order_id,type_id,clay,color_id,color_name,grade,destination,pieces,recorded_at,recorded_by)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[a.id,a.qcId,item.orderId,item.typeId,item.clay,item.colorId,item.color||null,a.grade,a.destination,a.pieces,a.at,previous.find(v=>v.id===a.id)?.recorded_by??actor.id]);
 }
}
export async function saveWorkflow(db:Db,body:any,actor:Recorder){
 const requestId=text(body.request_id,'รหัสคำขอ',true,100),c=body.command as Command;
 if(!c||typeof c!=='object'||Array.isArray(c)||['demo','import'].includes(c.op))fail('ไม่รองรับข้อมูลทดลองในระบบใช้งานจริง');
 if(c.ready!==undefined||c.rate!==undefined)fail('ยอดและอัตราต้นทางจริงต้องแก้ที่ทะเบียนหรือส่วนงานต้นทาง');
 if(!Number.isInteger(body.revision)||body.revision<0)fail('ฉบับข้อมูลไม่ถูกต้อง');
 const payload={revision:body.revision,catalog_version:body.catalog_version,command:c};
 const existing=await one(db,'SELECT payload=$2::jsonb matches FROM kiln_workflow_events WHERE request_id=$1',[requestId,JSON.stringify(payload)]);
 if(existing){if(!existing.matches)fail('รหัสคำขอถูกใช้กับข้อมูลอื่นแล้ว',409);return {...await readLocked(db),replayed:true};}
 const row=await one(db,'SELECT revision,state FROM kiln_workflow_state WHERE id=1 FOR UPDATE');
 if(row.revision!==body.revision)fail('มีผู้อื่นแก้ข้อมูลแล้ว กรุณาโหลดล่าสุด',409);
 const before:Model={...row.state,items:await catalog(db)};
 if(body.catalog_version!==catalogVersion(before.items))fail('ข้อมูลต้นทางหรือทะเบียนเปลี่ยนแล้ว กรุณาโหลดล่าสุด',409);
 if(c.op==='start'){
  const legacy=await all(db,`SELECT kiln FROM firing_rounds r WHERE finished_on IS NULL AND EXISTS(SELECT 1 FROM firing_loads l WHERE l.round_id=r.id AND l.pieces>0)`);
  if(legacy.some(r=>{const id=/^(?:เตา\s*)?(\d+)(?:\/\d+)?$/.exec(r.kiln.trim())?.[1];return !id||Number(id)===c.kilnId;}))
   fail('ยังมีรอบเผางานเดิมใช้เตานี้อยู่ กรุณาตรวจงานเดิมก่อน',409);
 }
 let state=transition(before,c);
 const current=state.items.find(i=>i.id===c.sourceId) as LiveItem|undefined;
 if(c.op==='settings'){
  if(!current)fail('ไม่พบต้นทางจริง');
  if(c.clayRange)await setRange(db,{clay:current.clay,minimum:c.clayRange[0],maximum:c.clayRange[1]},actor);
  if(c.colorRange){if(!current.colorId)fail('งานนี้ไม่มีสีเคลือบ');await setRange(db,{color_id:current.colorId,minimum:c.colorRange[0],maximum:c.colorRange[1]},actor);}
  if(c.shapeRange)await db.query('INSERT INTO firing_shape_ranges VALUES($1,$2,$3) ON CONFLICT(type_id) DO UPDATE SET minimum=$2,maximum=$3',[current.typeId,...c.shapeRange]);
 }
 if(c.op==='policy')await db.query('INSERT INTO kiln_order_grade_policies VALUES($1,$2) ON CONFLICT(order_id) DO UPDATE SET accepted=$2',[current!.orderId,JSON.stringify(c.accepted)]);
 // Re-read settings shared by clay, color and tile type before final validation.
 state.items=await catalog(db);
 state=transition(state,{op:'correct'});
 const used=new Set(state.plans.map(p=>p.sourceId));if(current)used.add(current.id);
 for(const item of state.items as LiveItem[])if(used.has(item.id))await db.query('INSERT INTO kiln_workflow_sources VALUES($1,$2,$3) ON CONFLICT(source_id) DO NOTHING',[item.id,item.orderId,item.typeId]);
 const input=await debitSources(db,state);
 await projectAllocations(db,state,actor);
 if(await one(db,`SELECT 1 FROM finished_stock_receipts r WHERE r.voided_at IS NULL AND EXISTS (
  SELECT 1 FROM firing_qc_loads x JOIN firing_loads l ON l.id=x.load_id JOIN finishing_order_balances b ON b.id=l.order_id
  WHERE x.qc_id=r.qc_id AND b.missing_pieces>0) LIMIT 1`))fail('ต้องปรับรายการรับสต็อกเดิมก่อนลดจำนวนที่กันให้ออเดอร์',409);
 await db.query('UPDATE kiln_workflow_state SET revision=revision+1,state=$1 WHERE id=1',[JSON.stringify(state)]);
 await db.query(`INSERT INTO kiln_workflow_events(request_id,payload,revision,actor,before_state,after_state) VALUES($1,$2,$3,$4,$5,$6)`,[requestId,JSON.stringify(payload),row.revision+1,actor.username,JSON.stringify({...before,inputOrigins:input.before}),JSON.stringify({...state,inputOrigins:input.after})]);
 await audit(db,actor.username,'งานเตา '+c.op,String(row.revision+1));
 return {...await readLocked(db),replayed:false};
}
