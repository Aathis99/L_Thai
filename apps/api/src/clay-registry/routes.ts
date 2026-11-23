import type {Request,Response} from 'express';
import type {SessionRouteAccess} from '../app.js';
import {audit} from '../database.js';
import {fail} from '../auth.js';
import {clayRegistryState,updateClayType,saveClayColor} from './catalog.js';
export async function handleClayRegistryRoute(req:Request,res:Response,access:SessionRouteAccess):Promise<boolean>{
 if(req.path==='/catalog/clays'&&req.method==='GET'){access.require('pressing.read');res.json(await clayRegistryState(access.db));return true;}
 const m=req.path.match(/^\/catalog\/(clays|clay-colors)(?:\/([1-9]\d*))?$/);if(!m)return false;
 const [,kind,raw]=m,id=raw?Number(raw):undefined;if(id&&!Number.isSafeInteger(id))fail('รหัสรายการไม่ถูกต้อง');
 if(!(req.method==='PUT'&&id)&&!(req.method==='POST'&&kind==='clay-colors'&&!id))return false;
 const saved=await access.mutate('pressing.manage',async(db,actor)=>{
  const saved=kind==='clays'?await updateClayType(db,id!,req.body):await saveClayColor(db,req.body,id);
  await audit(db,actor.username,`${kind==='clays'?'ทะเบียนประเภทดิน':'ทะเบียนสีดิน'} ${id?'แก้ไข':'เพิ่ม'}`,String(saved));return saved;
 });res.status(id?200:201).json({id:saved});return true;
}
