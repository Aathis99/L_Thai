import {one,type Db} from '../database.js';
import {fail} from '../auth.js';
export type ClayCode='WHITE'|'COLORED'|'RED'|'LATERITE';
export type ClayIdentity={clay_type_id:number;clay_color_id:number|null;clay_code:ClayCode;clay_name:string;clay_color_name:string|null;legacy_clay:string};
export function legacyClay(code:ClayCode):string{return {WHITE:'ขาว',COLORED:'สี',RED:'แดง',LATERITE:'ศิลาแลง'}[code];}
export async function resolveClayIdentity(db:Db,typeId:number,colorId:number|null,requireActive:boolean):Promise<ClayIdentity>{
 if(!Number.isSafeInteger(typeId)||typeId<=0||(colorId!==null&&(!Number.isSafeInteger(colorId)||colorId<=0)))fail('รหัสประเภทดินหรือสีดินไม่ถูกต้อง');
 const type=await one(db,'SELECT * FROM clay_types WHERE id=$1',[typeId]);
 if(!type)fail('ไม่พบประเภทดิน',404);
 if(requireActive&&!type.active)fail('ประเภทดินนี้หยุดใช้แล้ว',409);
 if(type.code!=='COLORED'&&colorId!==null)fail('เลือกสีดินได้เฉพาะดินสี');
 const color=colorId===null?null:await one(db,'SELECT * FROM clay_colors WHERE id=$1',[colorId]);
 if(colorId!==null&&!color)fail('ไม่พบสีดิน',404);
 if(type.code==='COLORED'&&requireActive&&!color)fail('กรุณาเพิ่มและเลือกสีดินก่อนใช้งาน');
 if(requireActive&&color&&!color.active)fail('สีดินนี้หยุดใช้แล้ว',409);
 return {clay_type_id:type.id,clay_color_id:color?.id??null,clay_code:type.code,clay_name:type.name,
  clay_color_name:color?.name??null,legacy_clay:legacyClay(type.code)};
}
