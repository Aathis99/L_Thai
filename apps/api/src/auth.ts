import { randomBytes,scrypt,timingSafeEqual,createHash } from 'node:crypto';
import { promisify } from 'node:util';
const derive=promisify(scrypt);
export class ApiError extends Error { constructor(message:string,public status=400){super(message);} }
export function fail(message:string,status=400):never{throw new ApiError(message,status);}
export function text(value:unknown,label:string,required=true,max=120):string{
  if(value===undefined&&!required)return '';
  if(typeof value!=='string'||value.trim().length>max||(required&&!value.trim()))return fail(`กรุณาระบุ${label}ให้ถูกต้อง (ไม่เกิน ${max} ตัวอักษร)`);
  return value.trim();
}
export function username(value:unknown){const name=text(value,'ชื่อผู้ใช้',true,50).toLowerCase();if(!/^[a-z0-9._-]{3,50}$/.test(name))fail('ชื่อผู้ใช้ต้องเป็น a-z, 0-9, จุด, ขีด หรือขีดล่าง อย่างน้อย 3 ตัว');return name;}
export async function hashPassword(value:unknown){
  if(typeof value!=='string'||value.length<12||value.length>128)fail('รหัสผ่านต้องมี 12–128 ตัวอักษร');
  const salt=randomBytes(16).toString('hex');return salt+':'+(await derive(value,salt,64) as Buffer).toString('hex');
}
export const DUMMY_HASH='0'.repeat(32)+':'+'0'.repeat(128);
export async function verifyPassword(value:unknown,encoded:string){
  if(typeof value!=='string'||value.length>128)return false;
  const [salt,hash]=encoded.split(':');if(!salt||!/^[a-f0-9]{128}$/.test(hash||''))return false;
  return timingSafeEqual(await derive(value,salt,64) as Buffer,Buffer.from(hash,'hex'));
}
export const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
