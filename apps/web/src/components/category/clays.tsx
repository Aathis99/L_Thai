import {useState} from 'react';
import type {CategoryRecordsProps} from './records';
import type {ClayRegistryState,ClayType,ClayColor} from '../../lib/clay-registry';
import {Field} from '../fields';
import {Choice,FormDialog,Section,Card} from '../pressing/shared';
import {formText} from '../../lib/pressing';
export default function Clays({data,api,user,onSaved}:CategoryRecordsProps<ClayRegistryState>){
 const [editor,setEditor]=useState<{kind:'clay';item:ClayType}|{kind:'color';item?:ClayColor}|null>(null);
 const manage=user.permissions.includes('pressing.manage');
 const item=editor?.item;
 return <>
  <Section title="ทะเบียนประเภทดิน">
   <div className="pressing-cards">{data.clay_types.map(c=><Card key={c.id} title={c.name} meta={c.active?'ใช้งาน':'หยุดใช้'} actions={manage&&<button className="button warning" onClick={()=>setEditor({kind:'clay',item:c})}>แก้ไข</button>}>
    <p>{c.description||'ยังไม่มีคำอธิบาย'}</p>{c.code==='COLORED'&&<p>ดินขาวผสมสีในเนื้อดิน เลือกสีดินแยกจากสีเคลือบผิว</p>}
   </Card>)}</div>
  </Section>
  <Section title="สีดิน" action={manage&&<button className="button primary" onClick={()=>setEditor({kind:'color'})}>เพิ่มสีดิน</button>}>
   {!data.clay_colors.length&&<p>ยังไม่มีข้อมูลสีดิน เพิ่มได้เมื่อข้อมูลพร้อม</p>}
   <div className="pressing-cards">{data.clay_colors.map(c=><Card key={c.id} title={`${c.code} · ${c.name}`} meta={c.active?'ใช้งาน':'หยุดใช้'} actions={manage&&<button className="button warning" onClick={()=>setEditor({kind:'color',item:c})}>แก้ไขสีดิน</button>}><p>{c.notes}</p></Card>)}</div>
  </Section>
  {manage&&editor&&<FormDialog api={api} onSaved={onSaved} onClose={()=>setEditor(null)} scope="catalog" title={editor.kind==='clay'?'แก้ไขประเภทดิน':item?'แก้ไขสีดิน':'เพิ่มสีดิน'}
   path={editor.kind==='clay'?`/clays/${editor.item.id}`:item?`/clay-colors/${item.id}`:'/clay-colors'} method={item?'PUT':'POST'} submitLabel="บันทึก"
   build={f=>({name:formText(f,'name'),active:formText(f,'active')==='true',...(editor.kind==='clay'?{description:formText(f,'description')||null}:{code:formText(f,'code'),notes:formText(f,'notes')||null})})}>
   <div className="form-grid">
    {editor.kind==='color'&&<Field label="รหัสสีดิน" name="code" required defaultValue={editor.item?.code??''}/>}
    <Field label="ชื่อ" name="name" required defaultValue={item?.name??''}/>
    <Field label={editor.kind==='clay'?'คำอธิบาย':'หมายเหตุ'} name={editor.kind==='clay'?'description':'notes'} defaultValue={editor.kind==='clay'?editor.item.description??'':editor.item?.notes??''}/>
    <Choice label="สถานะ" name="active" defaultValue={item?.active===false?'false':'true'} options={[{value:'true',label:'ใช้งาน'},{value:'false',label:'หยุดใช้'}]}/>
   </div>
  </FormDialog>}
 </>;
}
