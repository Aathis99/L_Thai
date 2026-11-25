import type {Request,Response} from 'express';
import type {SessionRouteAccess} from '../app.js';
import {fail} from '../auth.js';
import {readWorkflow,saveWorkflow} from './store.js';
const permissions:Record<string,string>={plan:'finishing.fire',reserve:'finishing.fire',move:'finishing.fire',cancel:'finishing.fire',
 'rail-ready':'finishing.fire',start:'finishing.fire',stop:'finishing.fire',withdraw:'finishing.fire',unload:'finishing.fire',log:'finishing.fire',
 qc:'finishing.qc','repair-ready':'finishing.qc',settings:'finishing.temperature',policy:'pressing.manage',correct:'finishing.correct',
 'plan-edit':'finishing.correct','plan-cancel':'finishing.fire'};
Object.assign(permissions,{'qc-document-open':'finishing.qc','qc-draft-save':'finishing.qc','qc-draft-delete':'finishing.qc','qc-draft-confirm':'finishing.qc','qc-document-correct':'finishing.correct','qc-document-issue':'finishing.read'});
export async function handleKilnWorkflow(req:Request,res:Response,access:SessionRouteAccess){
 access.require('finishing.read');
 if(req.method==='GET'&&req.path==='/kiln/state'){res.json(await readWorkflow(access.db));return true;}
 if(req.method==='POST'&&req.path==='/kiln/action'){
  const command=req.body?.command;
  const permission=command?.op==='allocate'?(command.destination==='stock'?'finishing.stock':'finishing.allocate'):permissions[command?.op];
  if(!permission)fail('ไม่รองรับการทำงานนี้ในระบบใช้งานจริง');
  const result=await access.mutate(permission,async(db,actor)=>{
   const require=(p:string)=>{if(!actor.permissions.includes(p))fail('คุณไม่มีสิทธิ์ทำรายการนี้',403);};
   if(command.op==='correct'||command.op==='qc-document-correct'){
    if(command.op==='qc-document-correct')require('finishing.qc');
    if(command.qcs?.length||command.repairReady?.length)require('finishing.qc');
    if(command.allocations?.length){require('finishing.allocate');require('finishing.stock');}
   }
   if(command.op==='policy')require('finishing.stock');
   return saveWorkflow(db,req.body,actor);
  });
  res.status(201).json(result);return true;
 }
 return false;
}
