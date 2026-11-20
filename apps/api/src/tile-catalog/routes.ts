import type {Request,Response} from 'express';
import type {SessionRouteAccess} from '../app.js';
import {audit} from '../database.js';
import {fail} from '../auth.js';
import {catalogState,saveBody,saveProduct,saveProfile} from './catalog.js';

export async function handleCatalogRoute(req:Request,res:Response,access:SessionRouteAccess){
 if(req.method==='GET'&&req.path==='/catalog/state'){access.require('pressing.read');res.json(await catalogState(access.db));return true;}
 const match=req.path.match(/^\/catalog\/(products|bodies|profiles)(?:\/([1-9]\d*))?$/);
 if(!match)return false;
 const [,kind,rawId]=match,id=rawId?Number(rawId):undefined;
 if(id&&!Number.isSafeInteger(id))fail('รหัสรายการไม่ถูกต้อง');
 if(!((req.method==='POST'&&!id)||(req.method==='PUT'&&id)))return false;
 const result=await access.mutate('pressing.manage',async(db,actor)=>{
  const save={products:saveProduct,bodies:saveBody,profiles:saveProfile}[kind as 'products'|'bodies'|'profiles'];
  const saved=await save(db,req.body??{},id);await audit(db,actor.username,'ทะเบียนกระเบื้อง '+kind,String(saved));return saved;
 });
 res.status(id?200:201).json({id:result});return true;
}
