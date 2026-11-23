import {all,one,type Db} from '../database.js';
import {fail} from '../auth.js';
import {pressingText} from '../pressing/catalog.js';
export async function clayRegistryState(db:Db){return {clay_types:await all(db,'SELECT * FROM clay_types ORDER BY id'),clay_colors:await all(db,'SELECT * FROM clay_colors ORDER BY id')};}
function body(value:unknown,allowed:string[]){
 if(!value||typeof value!=='object'||Array.isArray(value))fail('ข้อมูลทะเบียนไม่ถูกต้อง');
 const b=value as Record<string,unknown>;
 if(Object.keys(b).some(k=>!allowed.includes(k)))fail('มีช่องข้อมูลที่ไม่อนุญาตให้เปลี่ยน');
 if(b.active!==undefined&&typeof b.active!=='boolean')fail('สถานะไม่ถูกต้อง');return b;
}
export async function updateClayType(db:Db,id:number,value:unknown):Promise<number>{
 const b=body(value,['name','description','active']),old=await one(db,'SELECT * FROM clay_types WHERE id=$1',[id]);if(!old)fail('ไม่พบประเภทดิน',404);
 await db.query('UPDATE clay_types SET name=$2,description=$3,active=$4 WHERE id=$1',[id,b.name===undefined?old.name:pressingText(b.name,'ชื่อดิน',true),b.description===undefined?old.description:pressingText(b.description,'คำอธิบาย',false),b.active??old.active]);return id;
}
export async function saveClayColor(db:Db,value:unknown,id?:number):Promise<number>{
 const b=body(value,['code','name','notes','active']),old=id?await one(db,'SELECT * FROM clay_colors WHERE id=$1',[id]):null;if(id&&!old)fail('ไม่พบสีดิน',404);
 const code=b.code===undefined&&old?old.code:pressingText(b.code,'รหัสสีดิน',true),name=b.name===undefined&&old?old.name:pressingText(b.name,'ชื่อสีดิน',true);
 if(await one(db,'SELECT id FROM clay_colors WHERE lower(code)=lower($1) AND ($2::integer IS NULL OR id<>$2)',[code,id??null]))fail('รหัสสีดินซ้ำ',409);
 const values=[code,name,b.notes===undefined?old?.notes??null:pressingText(b.notes,'หมายเหตุ',false),b.active??old?.active??true];
 const row=id?await one(db,'UPDATE clay_colors SET code=$1,name=$2,notes=$3,active=$4 WHERE id=$5 RETURNING id',[...values,id]):await one(db,'INSERT INTO clay_colors(code,name,notes,active) VALUES($1,$2,$3,$4) RETURNING id',values);return row.id;
}
