import {useState} from 'react';
import type {QcDocument,QcDocumentEntry,QcWorker} from '../../../../api/src/qc-documents/types';
import {symptomNames} from '../../../../api/src/qc-documents/types';
import type {Command} from '../kiln-prototype/types';
import {Field} from '../fields';
import {Modal} from '../pressing/shared';
import {localQcTime,readEntryForm} from './helpers';

export default function EntryForm({document:doc,workers,entry,busy,error,onSave,onClose,onReload}:{document:QcDocument;workers:QcWorker[];entry?:QcDocumentEntry;busy:boolean;error:string;onSave:(command:Command)=>Promise<boolean>;onClose:()=>void;onReload:()=>Promise<void>}){
 const [localError,setLocalError]=useState(''),[preview,setPreview]=useState('');
 const correcting=entry?.status==='confirmed';
 const loads=correcting?doc.loads.filter(l=>entry.lines.some(x=>x.loadId===l.id)):doc.loads;
 const symptoms=[...symptomNames,...new Set(entry?.lines.flatMap(l=>l.defects.filter(d=>!symptomNames.includes(d.name)).map(d=>d.name))??[])];
 const choices=[...workers.filter(w=>w.active),...(entry?.workers.filter(w=>!workers.some(current=>current.id===w.id&&current.active))??[])];
 return <Modal title={correcting?'แก้ผลคัดที่ยืนยันแล้ว':entry?'แก้ผลคัดร่าง':'เพิ่มผลคัดจากกระดาษ'} busy={busy} guardDismissal onClose={onClose}>
  <form className="qc-entry-form" onInput={event=>{try{const lines=readEntryForm(new FormData(event.currentTarget),loads.map(l=>l.id),symptoms);setPreview(lines.map(l=>`รายการ #${l.loadId}: คัด ${Object.values(l.counts).reduce((a,b)=>a+b,0)+l.defects.reduce((a,b)=>a+b.pieces,0)} · เสีย ${l.defects.reduce((a,b)=>a+b.pieces,0)}`).join(' | '));}catch{setPreview('กรุณาตรวจจำนวนที่กรอก');}}} onSubmit={async event=>{
   event.preventDefault();setLocalError('');const form=new FormData(event.currentTarget);
   try{const ok=await onSave({op:correcting?'qc-document-correct':'qc-draft-save',documentId:doc.id,...(entry?{entryId:entry.id}:{}),at:form.get('at')?String(form.get('at'))+':00+07:00':'',workerIds:form.getAll('workerIds').map(Number),note:String(form.get('note')??''),reason:String(form.get('reason')??''),lines:readEntryForm(form,loads.map(l=>l.id),symptoms,correcting)});if(ok)onClose();}catch(e){setLocalError((e as Error).message);}
  }}>
   {(error||localError)&&<div className="error" role="alert">{localError||error}{error&&<button type="button" className="button secondary" disabled={busy} onClick={()=>void onReload()}>โหลดล่าสุดและตรวจทาน</button>}</div>}
   <p>ลงเฉพาะยอดที่คัดครั้งนี้ แยกตามต้นทาง ระบบจะนำไปรวมในใบเดิมหลังยืนยัน</p>
   <Field label="วันเวลาที่คัดจริง (เวลาไทย)" name="at" type="datetime-local" defaultValue={localQcTime(entry?.at||undefined)} />
   <label className="field"><span>ผู้คัดจริง (เลือกได้หลายคน)</span><select multiple name="workerIds" size={Math.min(5,Math.max(2,choices.length))} defaultValue={entry?.workers.map(w=>String(w.id))??[]}>
    {choices.map(w=><option key={w.id} value={w.id}>{w.code} · {w.name}{!w.active?' (ข้อมูลเดิม)':''}</option>)}
   </select><small>เลือกชื่อจากทะเบียน คนคัดแยกจากบัญชีธุรการผู้บันทึก</small></label>
   {loads.map(load=>{const line=entry?.lines.find(l=>l.loadId===load.id);return <details className="qc-load-entry" key={load.id} open={loads.length===1||!!line}>
    <summary>{load.reference} · {load.code} · รายการเข้าเตา #{load.id}</summary>
    <div className="qc-result-inputs">{(['A+','underfired','touchup'] as const).map(key=><Field key={key} label={key==='A+'?'A+':key==='underfired'?'ไม่สุก → เข้าเตาใหม่':'แต้ม → เข้าเตาใหม่'} type="number" min="0" step="1" name={`load_${load.id}_${key}`} defaultValue={line?.counts[key]||''} />)}</div>
    <p>อาการด้านล่างนับเป็นเสีย หนึ่งแผ่นนับอาการหลักหนึ่งอย่าง ยอดเสียรวมอัตโนมัติ</p>
    <div className="qc-symptom-inputs">{symptoms.map((name,i)=><Field key={name} label={name==='ไม่สุก'?'ไม่สุก (คัดเป็นเสีย)':name} type="number" min="0" step="1" name={`load_${load.id}_defect_${i}`} defaultValue={line?.defects.find(d=>d.name===name)?.pieces||''} />)}</div>
    <div className="qc-result-inputs"><Field label="ชื่ออาการเพิ่มเติม" name={`load_${load.id}_other_name`} /><Field label="จำนวนอาการเพิ่มเติม" type="number" min="0" step="1" name={`load_${load.id}_other_qty`} /></div>
   </details>;})}
   {preview&&<p role="status">{preview}</p>}
   <Field label="หมายเหตุ / อาการรอง (ไม่เพิ่มจำนวนแผ่น)" name="note" defaultValue={entry?.note??''} />
   {correcting&&<Field label="เหตุผลการแก้ไข" name="reason" required />}
   <p>ผู้รายงาน ผู้ตรวจสอบ และผู้อนุมัติลงชื่อบนกระดาษหลังพิมพ์</p>
   <div className="pressing-actions"><button className="button primary" disabled={busy}>{busy?'กำลังบันทึก…':correcting?'บันทึกการแก้ไข':'บันทึกร่าง'}</button><button type="button" className="button secondary" onClick={onClose} disabled={busy}>ยกเลิก</button></div>
  </form>
 </Modal>;
}
