import {fail,text} from '../auth.js';
import {all,one,type Db} from '../database.js';
import {integer,pressingText} from '../pressing/catalog.js';

type Body=Record<string,unknown>;
export const clays=['แดง','ขาว','ศิลาแลง','สี'] as const;
function positive(value:unknown,label:string,optional=false):number|null{
 if(optional&&(value===null||value===undefined||value===''))return null;
 if(typeof value!=='number'||!Number.isFinite(value)||value<=0)fail(`กรุณาระบุ${label}เป็นจำนวนมากกว่า 0`);
 return value;
}
function dimensions(body:Body){
 const unit=pressingText(body.size_unit??'in','หน่วยขนาด',true);
 if(!['in','mm','cm'].includes(unit))fail('หน่วยขนาดไม่ถูกต้อง');
 return [pressingText(body.shape,'รูปทรง',false),positive(body.size_1,'ขนาดมิติแรก',true),positive(body.size_2,'ขนาดมิติที่สอง',true),unit,positive(body.thickness_mm,'ความหนา',true)];
}
export async function catalogState(db:Db){return {
 products:await all(db,'SELECT * FROM tile_products ORDER BY id'),bodies:await all(db,'SELECT * FROM tile_bodies ORDER BY id'),
 profiles:await all(db,'SELECT * FROM pressing_types ORDER BY id'),
};}
export async function saveBody(db:Db,body:Body,id?:number){
 const values=[pressingText(body.name,'ชื่อแบบดินปั๊ม',true),...dimensions(body)];
 if(id){
  const used=await one(db,`SELECT 1 FROM pressing_types t JOIN pressing_orders o ON o.type_id=t.id WHERE t.body_id=$1 LIMIT 1`,[id]);
  const current=await one(db,'SELECT * FROM tile_bodies WHERE id=$1',[id]);
  if(!current)fail('ไม่พบแบบดินปั๊ม',404);
  if(used&&['shape','size_1','size_2','size_unit','thickness_mm'].some((key,i)=>current[key]!==values[i+1]))fail('แบบดินปั๊มมีงานอ้างอิงแล้ว กรุณาสร้างแบบใหม่เมื่อลักษณะเปลี่ยน',409);
 }
 const row=id?await one(db,'UPDATE tile_bodies SET name=$1,shape=$2,size_1=$3,size_2=$4,size_unit=$5,thickness_mm=$6 WHERE id=$7 RETURNING id',[...values,id]):await one(db,'INSERT INTO tile_bodies(name,shape,size_1,size_2,size_unit,thickness_mm) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',values);
 return row.id as number;
}
export async function saveProduct(db:Db,body:Body,id?:number){
 const mounting=body.mounting_type??null;
 if(mounting!==null&&mounting!=='mesh')fail('รูปแบบการติดตาข่ายไม่ถูกต้อง');
 const bodyId=body.body_id==null?null:integer(body.body_id,'แบบดินปั๊ม');
 if(bodyId&&!await one(db,'SELECT id FROM tile_bodies WHERE id=$1',[bodyId]))fail('ไม่พบแบบดินปั๊ม');
 if(body.active!==undefined&&typeof body.active!=='boolean')fail('สถานะสินค้าไม่ถูกต้อง');
 const values=[pressingText(body.product_code,'รหัสสินค้า',true),pressingText(body.name,'ชื่อสินค้า',true),...dimensions(body),mounting,bodyId,body.active??true];
 const row=id?await one(db,`UPDATE tile_products SET product_code=$1,name=$2,shape=$3,size_1=$4,size_2=$5,size_unit=$6,thickness_mm=$7,mounting_type=$8,body_id=$9,active=$10 WHERE id=$11 RETURNING id`,[...values,id]):await one(db,`INSERT INTO tile_products(product_code,name,shape,size_1,size_2,size_unit,thickness_mm,mounting_type,body_id,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,values);
 if(!row)fail('ไม่พบสินค้า',404);return row.id as number;
}
export async function saveProfile(db:Db,body:Body,id?:number){
 const bodyId=integer(body.body_id,'แบบดินปั๊ม');
 const tileBody=await one(db,'SELECT * FROM tile_bodies WHERE id=$1',[bodyId]);if(!tileBody)fail('ไม่พบแบบดินปั๊ม');
 if(!clays.includes(body.clay as any))fail('กรุณาเลือกประเภทดิน');
 const clayColor=body.clay==='สี'?pressingText(body.clay_color,'สีที่ผสมในดิน',true):null;
 if(body.destination!=='color'&&body.destination!=='kiln')fail('กรุณาเลือกปลายทางเบิก');
 const values=[tileBody.size_1,tileBody.size_2,body.clay,tileBody.name,clayColor,
  integer(body.pieces_per_rack,'จำนวนแผ่นต่อไม้'),integer(body.rest_days,'จำนวนวันพัก',0),body.destination,positive(body.pieces_per_sqm,'แผ่นต่อ ตร.ม.'),bodyId];
 if(id){
  const current=await one(db,'SELECT * FROM pressing_types WHERE id=$1',[id]);if(!current)fail('ไม่พบประเภทผลิต',404);
  const used=await one(db,`SELECT EXISTS(SELECT 1 FROM pressing_orders WHERE type_id=$1) OR EXISTS(SELECT 1 FROM pressing_stock_sources WHERE type_id=$1) AS used`,[id]);
  // Explicitly linking a legacy identity is allowed; reassigning an already-linked, used identity is not.
  if(used.used&&(current.clay!==body.clay||(current.body_id!==null&&current.body_id!==bodyId)||(body.clay==='สี'&&current.clay_color!==clayColor)))fail('ประเภทผลิตมีประวัติอ้างอิงแล้ว เปลี่ยนดินหรือแบบไม่ได้',409);
 }
 if(await one(db,`SELECT id FROM pressing_types WHERE body_id=$1 AND clay=$2 AND lower(coalesce(clay_color,''))=lower(coalesce($3,'')) AND ($4::integer IS NULL OR id<>$4)`,[bodyId,body.clay,clayColor,id??null]))fail('มีค่าผลิตของดินและสีดินนี้แล้ว',409);
 const row=id?await one(db,`UPDATE pressing_types SET width=$1,length=$2,clay=$3,name=$4,clay_color=$5,pieces_per_rack=$6,rest_days=$7,destination=$8,pieces_per_sqm=$9,body_id=$10 WHERE id=$11 RETURNING id`,[...values,id]):await one(db,`INSERT INTO pressing_types(width,length,clay,name,clay_color,pieces_per_rack,rest_days,destination,pieces_per_sqm,body_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,values);
 return row.id as number;
}

export async function validateProductOrder(db:Db,body:Body,typeId:number){
 if(body.product_id==null)return null;
 const product=await one(db,'SELECT * FROM tile_products WHERE id=$1',[integer(body.product_id,'สินค้า')]);
 if(!product||!product.active||!product.body_id)fail('สินค้ายังไม่พร้อมผลิต กรุณาตรวจแบบดินปั๊มและค่าผลิต');
 const profile=await one(db,'SELECT * FROM pressing_types WHERE id=$1',[typeId]);
 if(!profile||profile.body_id!==product.body_id)fail('ประเภทผลิตไม่ตรงกับแบบดินปั๊มของสินค้า',409);
 if(!profile.active||!profile.pieces_per_sqm||(profile.clay==='สี'&&!profile.clay_color))fail('ค่าผลิตยังไม่ครบ');
 if(product.mounting_type==='mesh'&&body.purpose!=='customer')fail('สินค้าติดตาข่ายต้องมีออเดอร์ลูกค้า');
 return product;
}
export async function snapshotOrder(db:Db,orderId:number,product:any){
 await db.query(`UPDATE pressing_orders o SET product_id=$2,product_snapshot=$3,requires_mesh=$4,
  production_pieces_per_rack=t.pieces_per_rack,production_rest_days=t.rest_days,production_clay_color=t.clay_color
  FROM pressing_types t WHERE o.id=$1 AND t.id=o.type_id`,[orderId,product?.id??null,product?JSON.stringify(product):null,product?.mounting_type==='mesh']);
 return orderId;
}
