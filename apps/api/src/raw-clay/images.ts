import sharp from 'sharp';
import {fail} from '../auth.js';
export async function encodeImage(data:unknown,contentType:unknown):Promise<Buffer>{
 if(typeof data!=='string'||!data.length||data.length>Math.ceil(8*1024*1024/3)*4)fail('ไฟล์ภาพต้องไม่เกิน 8 MiB',413);
 if(!/^[A-Za-z0-9+/]+={0,2}$/.test(data)||data.length%4!==0)fail('ข้อมูลภาพไม่ถูกต้อง');
 const input=Buffer.from(data,'base64');if(input.length>8*1024*1024)fail('ไฟล์ภาพต้องไม่เกิน 8 MiB',413);
 if(!['image/jpeg','image/png','image/webp'].includes(String(contentType)))fail('รองรับเฉพาะ JPEG PNG WebP',415);
 try{
  const image=sharp(input,{limitInputPixels:40_000_000,failOn:'warning'});const meta=await image.metadata();
  if(meta.mediaType!==contentType||(meta.pages??1)>1)fail('ชนิดภาพไม่ถูกต้องหรือเป็นภาพเคลื่อนไหว');
  if(contentType==='image/png'){for(let off=8;off+12<=input.length;){const type=input.toString('ascii',off+4,off+8);if(type==='acTL')fail('รองรับเฉพาะภาพนิ่ง');if(type==='IDAT')break;off+=12+input.readUInt32BE(off);}}
  for(const quality of [85,75,65]){const encoded=await image.clone().autoOrient().resize(2560,2560,{fit:'inside',withoutEnlargement:true}).webp({quality}).toBuffer();if(encoded.length<=1048576)return encoded;}
 }catch(error){if(error instanceof Error&&'status'in error)throw error;fail('ไม่สามารถอ่านภาพได้ กรุณาเลือกภาพใหม่');}
 return fail('ภาพยังใหญ่เกิน 1 MiB กรุณาเลือกภาพใหม่ที่อ่านได้ชัดเจน');
}
