import {useEffect,useState} from 'react';
import type {Api,SessionUser} from '../../lib/types';
import KilnPrototype from './panel';
import QcDocumentsPage from '../qc-documents/page';

export default function KilnArea({api,user,qc=false,qa=false,initialRoundId,openQc,openStock}:{
 api:Api;user:SessionUser;qc?:boolean;qa?:boolean;initialRoundId?:number;openQc:(id:number)=>void;openStock:()=>void;
}){
 const [operations,setOperations]=useState(false);
 useEffect(()=>{setOperations(false);},[initialRoundId,qc]);
 return <>
  {qc&&!qa&&operations&&<button className="button secondary" onClick={()=>setOperations(false)}>กลับใบ QC</button>}
  {qc&&!qa&&!operations?<QcDocumentsPage api={api} user={user} openOperations={()=>setOperations(true)}/>:
   <KilnPrototype api={api} user={user} qa={qa} initialTab={qc?'QC':'ภาพรวม'}/>}
 </>;
}
