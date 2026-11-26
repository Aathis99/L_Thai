import type {Request,Response} from 'express';
import type {SessionRouteAccess} from '../app.js';
import {one} from '../database.js';
import {fail} from '../auth.js';
import {state,detail,action,duplicates} from './store.js';
export async function handleRawClayRoute(req:Request,res:Response,access:SessionRouteAccess):Promise<boolean>{
 if(req.method==='GET'&&req.path==='/raw-clay/state'){access.require('raw_clay.read');res.json(await state(access.db,req.query));return true;}
 if(req.method==='GET'&&req.path==='/raw-clay/duplicates'){access.require('raw_clay.read');res.json(await duplicates(access.db,req.query));return true;}
 const doc=req.path.match(/^\/raw-clay\/documents\/([1-9]\d*)$/);if(req.method==='GET'&&doc){access.require('raw_clay.read');res.json(await detail(access.db,Number(doc[1])));return true;}
 const image=req.path.match(/^\/raw-clay\/images\/([1-9]\d*)$/);if(req.method==='GET'&&image){access.require('raw_clay.read');const row=await one(access.db,'SELECT bytes FROM raw_clay_images WHERE id=$1',[Number(image[1])]);if(!row)fail('ไม่พบภาพ',404);res.type('image/webp').send(row.bytes);return true;}
 if(req.method==='POST'&&req.path==='/raw-clay/action'){res.json(await access.mutate('raw_clay.read',async(db,actor)=>action(db,req.body,actor)));return true;}
 return false;
}
