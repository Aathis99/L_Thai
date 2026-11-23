import type {Request,Response} from 'express';
import type {SessionRouteAccess} from '../app.js';
import {audit} from '../database.js';
import {fail} from '../auth.js';
import {catalogState,saveBody,saveProduct,saveProfile} from './catalog.js';
import {meshState,recordMesh,voidMesh} from './mesh.js';

export async function handleMeshRoute(req:Request,res:Response,access:SessionRouteAccess){
 if(req.path==='/finishing/mesh'&&req.method==='GET'){access.require('finishing.read');res.json(await meshState(access.db));return true;}
 const reverse=req.path.match(/^\/finishing\/mesh\/([1-9]\d*)\/void$/);
 if(req.method!=='POST'||(req.path!=='/finishing/mesh'&&!reverse))return false;
 const id=await access.mutate(reverse?'finishing.correct':'finishing.allocate',(db,actor)=>reverse?voidMesh(db,Number(reverse[1]),req.body??{},actor):recordMesh(db,req.body??{},actor));
 res.status(201).json({id});return true;
}

export async function handleCatalogRoute(req:Request,res:Response,access:SessionRouteAccess){
 if(req.method==='GET'&&req.path==='/catalog/state'){access.require('pressing.read');res.json(await catalogState(access.db));return true;}
 const match=req.path.match(/^\/catalog\/(products|bodies|profiles)(?:\/([1-9]\d*))?$/);
 if(!match)return false;
 const [,kind,rawId]=match,id=rawId?Number(rawId):undefined;
 if(id&&!Number.isSafeInteger(id))fail('รหัสรายการไม่ถูกต้อง');
 if(!((req.method==='POST'&&!id)||(req.method==='PUT'&&id)||(req.method==='DELETE'&&id&&kind==='profiles')))return false;
 const result=await access.mutate('pressing.manage',async(db,actor)=>{
  const save={products:saveProduct,bodies:saveBody,profiles:saveProfile}[kind as 'products'|'bodies'|'profiles'];
  const saved=await save(db,req.method==='DELETE'?{active:false}:req.body??{},id);await audit(db,actor.username,'ทะเบียนกระเบื้อง '+kind,String(saved));return saved;
 });
 res.status(id?200:201).json({id:result});return true;
}
