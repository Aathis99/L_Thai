import {fail} from '../auth.js';
import {one,type Db} from '../database.js';
export function parseReferenceTemperature(body:Record<string,unknown>):number|null {
 if(!body||Array.isArray(body)||Object.keys(body).length!==1||!Object.hasOwn(body,'temperature_c'))fail('กรุณาระบุอุณหภูมิอ้างอิงให้ถูกต้อง');
 const value=body.temperature_c;
 if(value!==null&&(typeof value!=='number'||!Number.isFinite(value)||value<=0))fail('อุณหภูมิอ้างอิงต้องมากกว่า 0 หรือเว้นว่าง');
 return value as number|null;
}
export async function saveReferenceTemperature(db:Db,id:number,value:number|null):Promise<{before:number|null;after:number|null}>{
 if(!await one(db,'SELECT id FROM color_chart_entries WHERE id=$1 FOR UPDATE',[id]))fail('ไม่พบรายการชาร์ตสี',404);
 const before=(await one(db,'SELECT temperature_c FROM color_reference_temperatures WHERE color_id=$1',[id]))?.temperature_c??null;
 if(value===null)await db.query('DELETE FROM color_reference_temperatures WHERE color_id=$1',[id]);
 else await db.query('INSERT INTO color_reference_temperatures VALUES($1,$2) ON CONFLICT(color_id) DO UPDATE SET temperature_c=excluded.temperature_c',[id,value]);
 return {before,after:value};
}
