import {useEffect,useState} from 'react';
import type {Api,SessionUser} from '../../lib/types';
import FiringPage from '../finishing/firing';
import QcPage from '../finishing/qc';
import KilnPrototype from './panel';

export default function KilnArea({api,user,qc=false,qa=false,initialRoundId,openQc,openStock}:{
 api:Api;user:SessionUser;qc?:boolean;qa?:boolean;initialRoundId?:number;openQc:(id:number)=>void;openStock:()=>void;
}){
 const [legacy,setLegacy]=useState(initialRoundId!==undefined);
 useEffect(()=>setLegacy(initialRoundId!==undefined),[initialRoundId,qc]);
 return <>
  {!qa&&<nav className="pressing-actions" aria-label="เลือกงานเตา"><button className={`button ${!legacy?'primary':'secondary'}`} aria-pressed={!legacy} onClick={()=>setLegacy(false)}>งานปัจจุบัน</button>
   <button className={`button ${legacy?'primary':'secondary'}`} aria-pressed={legacy} onClick={()=>setLegacy(true)}>งานเดิมก่อนเปิดขั้นตอนใหม่</button></nav>}
  {legacy&&!qa?<><p>ทำงานค้างและตรวจประวัติเดิม เกรดที่ยังไม่ได้บันทึกจะแสดงเป็นข้อมูลเดิม งานเข้าเผาใหม่ให้ใช้แผนและเตรียมลงเบอร์ในงานปัจจุบัน</p>
   {qc?<QcPage api={api} user={user} initialRoundId={initialRoundId} openFinishedStock={openStock}/>:<FiringPage api={api} user={user} openQc={openQc} legacyOnly/>}</>:
   <KilnPrototype api={api} user={user} qa={qa} initialTab={qc?'QC':'ภาพรวม'}/>}
 </>;
}
