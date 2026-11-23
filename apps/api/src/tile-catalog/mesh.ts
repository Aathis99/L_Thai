import {fail} from '../auth.js';
import {all,one,audit,type Db} from '../database.js';
import {integer,pressingText} from '../pressing/catalog.js';
import {finishingRequest} from '../finishing/requests.js';

type Actor={id:number;username:string};
type Body=Record<string,unknown>;
type MeshLine={key:string;pieces:number;signature:string};

async function allocationLines(db:Db){
 const rows=await all(db,`SELECT 'workflow' source,a.id allocation_id,a.qc_id,a.order_id,a.type_id,a.clay,a.color_id,a.color_name,a.grade,a.pieces,o.product_id
  FROM kiln_workflow_allocations a JOIN pressing_orders o ON o.id=a.order_id WHERE a.destination='order'
  UNION ALL SELECT 'legacy',a.id,a.qc_id,a.order_id,o.type_id,coalesce(o.production_clay,t.clay),o.color_id,o.color_name,NULL,a.pieces,o.product_id
  FROM firing_qc_allocations a JOIN pressing_orders o ON o.id=a.order_id JOIN pressing_types t ON t.id=o.type_id WHERE a.voided_at IS NULL`);
 return rows.map(row=>({...row,key:row.source+':'+row.allocation_id,signature:JSON.stringify([row.source,row.allocation_id,row.qc_id,row.order_id,row.type_id,row.clay,row.color_id,row.color_name,row.grade,row.product_id])}));
}

export async function assertMeshSources(db:Db){
 const entries=await all(db,`SELECT e.*,o.requires_mesh,o.customer_pieces FROM tile_mesh_entries e JOIN pressing_orders o ON o.id=e.order_id WHERE e.voided_at IS NULL`);
 if(!entries.length)return;
 const sources=new Map((await allocationLines(db)).map(row=>[row.key,row]));
 const used=new Map<string,number>(),byOrder=new Map<number,number>();
 for(const entry of entries){
  if(!entry.requires_mesh)fail('ต้องย้อนยอดติดตาข่ายก่อนเปลี่ยนประเภทงาน',409);
  byOrder.set(entry.order_id,(byOrder.get(entry.order_id)??0)+entry.pieces);
  if(byOrder.get(entry.order_id)!>entry.customer_pieces)fail('ยอดติดตาข่ายเกินออเดอร์',409);
  for(const line of entry.lines as MeshLine[]){
   const source=sources.get(line.key);
   if(!source||source.order_id!==entry.order_id||source.signature!==line.signature)fail('ต้องย้อนยอดติดตาข่ายก่อนแก้แหล่ง QC หรือจัดสรรที่ใช้แล้ว',409);
   used.set(line.key,(used.get(line.key)??0)+line.pieces);
   if(used.get(line.key)!>source.pieces)fail('ต้องย้อนยอดติดตาข่ายก่อนลดยอด QC หรือจัดสรรที่ใช้แล้ว',409);
  }
 }
}

export async function meshState(db:Db){
 const orders=await all(db,`SELECT o.id,o.customer_reference,o.customer_pieces,o.product_id,o.product_snapshot->>'name' product_name,
  o.product_snapshot->>'product_code' product_code,o.production_clay,o.production_clay_color,o.color_name
  FROM pressing_orders o WHERE o.requires_mesh AND o.purpose='customer' ORDER BY o.id`);
 const entries=await all(db,`SELECT e.*,u.username recorded_by_username FROM tile_mesh_entries e JOIN users u ON u.id=e.recorded_by ORDER BY e.id DESC`);
 const sources=await allocationLines(db),used=new Map<string,number>();
 for(const entry of entries.filter(e=>!e.voided_at))for(const line of entry.lines as MeshLine[])used.set(line.key,(used.get(line.key)??0)+line.pieces);
 return {orders:orders.map(order=>{
  const lines=sources.filter(s=>s.order_id===order.id).map(({signature,...source})=>({...source,grade:source.grade??'เดิม',available_pieces:source.pieces-(used.get(source.key)??0)}));
  const allocated=lines.reduce((n,l)=>n+Number(l.pieces),0),completed=entries.filter(e=>e.order_id===order.id&&!e.voided_at).reduce((n,e)=>n+e.pieces,0);
  return {...order,allocated_pieces:allocated,completed_pieces:completed,waiting_pieces:allocated-completed,ready_pieces:completed,lines};
 }),entries:entries.map(entry=>({...entry,lines:(entry.lines as MeshLine[]).map(line=>{
  const signature=JSON.parse(line.signature);
  return {...line,source:signature[0],allocation_id:signature[1],qc_id:signature[2],grade:signature[8]??'เดิม'};
 })}))};
}

export async function recordMesh(db:Db,body:Body,actor:Actor){
 const orderId=integer(body.order_id,'ใบสั่งผลิต');
 if(!Array.isArray(body.lines)||!body.lines.length)fail('กรุณาระบุแหล่ง QC และจำนวนที่ติดตาข่ายเสร็จ');
 const input=body.lines.map((line:any)=>({key:pressingText(line?.key,'แหล่ง QC',true),pieces:integer(line?.pieces,'จำนวนติดเสร็จ')})).sort((a,b)=>a.key.localeCompare(b.key));
 if(new Set(input.map(l=>l.key)).size!==input.length)fail('แหล่ง QC ซ้ำกัน');
 return finishingRequest(db,'tile-mesh',body,{orderId,lines:input},async()=>{
  await assertMeshSources(db);
  const order=await one(db,'SELECT * FROM pressing_orders WHERE id=$1',[orderId]);
  if(!order||!order.requires_mesh||order.purpose!=='customer')fail('ใบสั่งนี้ไม่ใช่งานติดตาข่ายตามออเดอร์');
  const state=await meshState(db),item=state.orders.find(o=>o.id===orderId)!;
  const sources=await allocationLines(db),lines:MeshLine[]=[];
  for(const inputLine of input){
   const available=item.lines.find((l:{key:string;available_pieces:number})=>l.key===inputLine.key),source=sources.find(l=>l.key===inputLine.key);
   if(!available||!source||inputLine.pieces>available.available_pieces)fail('ยอดติดตาข่ายเกินแผ่น QC ที่ยังรอติดของออเดอร์นี้',409);
   lines.push({...inputLine,signature:source.signature});
  }
  const pieces=lines.reduce((n,l)=>n+l.pieces,0);
  if(item.completed_pieces+pieces>order.customer_pieces)fail('ยอดติดตาข่ายเกินจำนวนลูกค้าสั่ง',409);
  const saved=await one(db,'INSERT INTO tile_mesh_entries(order_id,pieces,lines,recorded_by) VALUES($1,$2,$3,$4) RETURNING id',[orderId,pieces,JSON.stringify(lines),actor.id]);
  await audit(db,actor.username,'บันทึกติดตาข่ายเสร็จ',String(saved.id));return saved.id;
 });
}

export async function voidMesh(db:Db,id:number,body:Body,actor:Actor){
 const reason=pressingText(body.reason,'เหตุผลย้อนยอด',true);
 return finishingRequest(db,'tile-mesh-void',body,{id,reason},async()=>{
  const entry=await one(db,'SELECT * FROM tile_mesh_entries WHERE id=$1',[id]);
  if(!entry)fail('ไม่พบรายการติดตาข่าย',404);if(entry.voided_at)fail('ย้อนรายการนี้แล้ว',409);
  await db.query('UPDATE tile_mesh_entries SET voided_at=now(),voided_by=$2,reason=$3 WHERE id=$1',[id,actor.id,reason]);
  await audit(db,actor.username,'ย้อนยอดติดตาข่าย',String(id));return id;
 });
}
