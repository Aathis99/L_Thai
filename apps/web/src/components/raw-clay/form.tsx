import {useState,type ReactNode} from 'react';
import {Field} from '../fields';
import {Choice,Modal} from '../pressing/shared';
import {localClayTime,nowClayTime,readClayForm,validatePhotos,kindLabels,type ClayKind,type ClayState,type ClayDocument,type ClayCommand,type ClayImage} from '../../lib/raw-clay';

function Clock({name,label,value='',optional=false}:{name:string;label:string;value?:string;optional?:boolean}){
 const [date,setDate]=useState(value.slice(0,10)),[hour,setHour]=useState(value.slice(11,13)),[minute,setMinute]=useState(value.slice(14,16));
 const change=(part:'date'|'hour'|'minute',value:string)=>({date:setDate,hour:setHour,minute:setMinute})[part](value);
 const setTime=(value:string)=>{setDate(value.slice(0,10));setHour(value.slice(11,13));setMinute(value.slice(14,16));};
 return <fieldset className="kiln-time-input"><legend>{label}{optional?' (ถ้ามี)':''}</legend>
  <Field label="วันที่" type="date" name={`${name}_date`} value={date} required={!optional} onChange={e=>change('date',e.target.value)}/>
  <div className="kiln-clock-fields">{(['hour','minute'] as const).map(part=><label className="field" key={part}><span>{part==='hour'?'ชั่วโมง (00–23)':'นาที (00–59)'}</span><select name={`${name}_${part}`} value={part==='hour'?hour:minute} required={!optional} onChange={e=>change(part,e.target.value)}><option value="">—</option>{Array.from({length:part==='hour'?24:60},(_,i)=>String(i).padStart(2,'0')).map(n=><option key={n}>{n}</option>)}</select></label>)}</div>
  <div className="pressing-actions"><button type="button" className="button secondary" onClick={()=>setTime(nowClayTime())}>เวลาปัจจุบัน</button>{optional&&<button type="button" className="quiet" onClick={()=>setTime('')}>ไม่ระบุ</button>}</div>
 </fieldset>;
}
function Weight({name,label,value}:{name:string;label:string;value:string}){return <div><Field label={label} name={name} inputMode="decimal" defaultValue={value}/><label className="field"><span>หน่วย{label}</span><select name={name+'_unit'} defaultValue="kg"><option value="kg">กิโลกรัม</option><option value="t">ตัน</option></select></label></div>;}
const text=(f:FormData,name:string)=>String(f.get(name)??'').trim();
async function imagePayload(file:File):Promise<ClayImage>{
 return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(Error('อ่านภาพไม่สำเร็จ กรุณาเลือกใหม่'));reader.onload=()=>resolve({data:String(reader.result).split(',')[1],contentType:file.type});reader.readAsDataURL(file);});
}

export default function ClayForm({retryPending=false,conflict=false,reconciliation,onRetry,kind,state,document:doc,busy,error,canConfirm,onClose,onSave,onReload,duplicateWarning}:{retryPending?:boolean;conflict?:boolean;reconciliation?:ReactNode;onRetry:()=>void;kind:ClayKind;state:ClayState;document?:ClayDocument;busy:boolean;error:string;canConfirm:boolean;onClose:()=>void;onSave:(command:ClayCommand)=>Promise<boolean>;onReload:()=>Promise<void>;duplicateWarning?:ReactNode}){
 const [typeId,setTypeId]=useState(String(doc?.data.clayTypeId??''));
 const [existing,setExisting]=useState(doc?.imageIds??[]),[files,setFiles]=useState<File[]>([]),[localError,setLocalError]=useState(''),[saving,setSaving]=useState(false);
 const data=doc?.data,correcting=doc?.status==='confirmed',locked=busy||saving||retryPending;
 const colored=state.clay_types.find(t=>t.id===Number(typeId))?.code==='COLORED';
 const choices=state.employees.filter(e=>e.active||e.id===data?.employeeId);
 if(data?.employeeId&&!choices.some(e=>e.id===data.employeeId))choices.push({id:data.employeeId,name:data.employeeName??`#${data.employeeId}`,active:false});
 return <Modal title={`${correcting?'แก้ไข':doc?'แก้ร่าง':'เพิ่ม'}${kindLabels[kind]}${doc?` · ${doc.number}`:''}`} onClose={onClose} busy={locked} guardDismissal>
  <form className="qc-entry-form" noValidate onSubmit={async e=>{
   e.preventDefault();if(locked)return;setLocalError('');setSaving(true);
   try{
    const f=new FormData(e.currentTarget,(e.nativeEvent as SubmitEvent).submitter),action=correcting?'correct':text(f,'submitAction')==='confirm'?'confirm':'save';
    const next=readClayForm(f,kind,action!=='save',colored);
    if(correcting&&!text(f,'reason'))throw Error('กรุณาระบุเหตุผลการแก้ไข');
    let images:ClayImage[]|undefined;
    if(kind==='receipt'){
     validatePhotos([...existing.map(id=>({id})),...files],action!=='save');
     images=[...existing.map(id=>({id})),...await Promise.all(files.map(imagePayload))];
    }
    const command:ClayCommand={action,payload:{kind,...(doc?{id:doc.id}:{}),data:next,...(images?{images}:{}),...(correcting?{reason:text(f,'reason')}:{})}};
    if(await onSave(command))onClose();
   }catch(cause){setLocalError(cause instanceof Error?cause.message:'บันทึกไม่สำเร็จ');}finally{setSaving(false);}
  }}>
   {(localError||error)&&<div className="error" role="alert">{localError||error}{error&&conflict&&<><p>ข้อมูลที่กรอกยังอยู่ หากมีผู้อื่นแก้ไข กรุณาโหลดล่าสุดแล้วตรวจทานก่อนส่งอีกครั้ง</p><button type="button" className="button secondary" disabled={locked} onClick={()=>void onReload()}>ตรวจฉบับล่าสุดก่อนบันทึก</button></>}</div>}
   {retryPending&&<aside className="error" role="alert">ยังไม่ทราบผลบันทึก กรุณาลองคำขอเดิมก่อนทำรายการอื่น<button type="button" className="button primary" disabled={busy||saving} onClick={onRetry}>ลองคำขอเดิมอีกครั้ง</button></aside>}
   <fieldset disabled={locked}>
   {!correcting&&<p>ร่างบันทึกเท่าที่มีได้โดยไม่เปลี่ยนยอดสต็อก ต้องกรอกข้อมูลให้ครบก่อนยืนยัน</p>}
   {reconciliation}
   {duplicateWarning}
   <fieldset disabled={locked}><legend>ประเภทวัตถุดิบและผู้ทำงานจริง</legend>
    <Choice name="clayTypeId" label="ประเภทดิน" value={typeId} onChange={setTypeId} options={state.clay_types.filter(t=>t.active||t.id===data?.clayTypeId).map(t=>({value:t.id,label:t.name}))}/>
    {colored&&<Choice name="clayColorId" label="สีดิน" defaultValue={data?.clayColorId??''} options={state.clay_colors.filter(c=>c.active||c.id===data?.clayColorId).map(c=>({value:c.id,label:c.name}))}/>}
    <Choice name="employeeId" label={kind==='receipt'?'ผู้รับดินจริง':kind==='issue'?'ผู้เบิกจริง':'ผู้ตรวจนับจริง'} defaultValue={data?.employeeId} options={choices.map(e=>({value:e.id,label:e.name+(e.active?'':' (ข้อมูลเดิม)')}))}/>
   </fieldset>
   {kind==='receipt'&&<fieldset disabled={locked}><legend>ข้อมูลตามบิลผู้ขาย</legend><Field label="ผู้ขาย" name="supplier" defaultValue={data?.supplier} required/><Field label="เลขบิล / ใบชั่งผู้ขาย" name="billNumber" defaultValue={data?.billNumber} required/><Field label="วันที่เอกสาร" name="documentDate" type="date" defaultValue={data?.documentDate??nowClayTime().slice(0,10)} required/><Field label="ชื่อดินตามเอกสาร (ไม่แยกยอดสต็อก)" name="tradeName" defaultValue={data?.tradeName} required/><Weight name="netKg" label="น้ำหนักสุทธิ" value={data?.netKg??''}/></fieldset>}
   {kind==='receipt'&&<><fieldset disabled={locked}><legend>ชั่งเข้าที่ผู้ขาย ก่อนใส่ดิน</legend><Clock name="weighInAt" label="เวลาชั่งเข้า" value={localClayTime(data?.weighInAt)} optional/><Weight name="tareKg" label="น้ำหนักรถเปล่า" value={data?.tareKg??''}/><Field label="ทะเบียนรถชั่งเข้า" name="plateIn" defaultValue={data?.plateIn}/></fieldset><fieldset disabled={locked}><legend>ชั่งออกที่ผู้ขาย รถพร้อมดิน</legend><Clock name="weighOutAt" label="เวลาชั่งออก" value={localClayTime(data?.weighOutAt)} optional/><Weight name="grossKg" label="น้ำหนักรวมรถและดิน" value={data?.grossKg??''}/><Field label="ทะเบียนรถชั่งออก" name="plateOut" defaultValue={data?.plateOut}/></fieldset><Field label="หมายเหตุเมื่อข้อมูลใบชั่งไม่ครบ" name="missingNote" defaultValue={data?.missingNote}/><p>น้ำหนักสุทธิ = น้ำหนักรวม − น้ำหนักรถ เมื่อมีข้อมูลครบคู่ เวลาชั่งออกต้องไม่ก่อนชั่งเข้า</p></>}
   {kind!=='adjustment'?<fieldset disabled={locked}><Clock name="occurredAt" label={kind==='receipt'?'เวลารับที่โรงงาน (เวลาไทย)':'เวลาเบิกเข้าโม่ (เวลาไทย)'} value={localClayTime(data?.occurredAt)||nowClayTime()}/></fieldset>:<p>ยืนยันยอดตรวจนับ ณ เวลายืนยันปัจจุบัน ระบบคงค่านับนี้เมื่อแก้เอกสารก่อนหน้า</p>}
   {kind==='issue'&&<Weight name="quantityKg" label="น้ำหนักเบิกเข้าโม่" value={data?.quantityKg??''}/>}
   {kind==='adjustment'&&<><Weight name="countedKg" label="คงเหลือที่ตรวจนับจริง" value={data?.countedKg??''}/><Field label="เหตุผลปรับยอด" name="adjustmentReason" defaultValue={data?.reason} required/></>}
   <Field label="หมายเหตุ" name="notes" maxLength={1000} defaultValue={data?.notes}/>
   {kind==='receipt'&&<fieldset disabled={locked}><legend>ภาพหลักฐาน {existing.length+files.length}/3 รูป</legend><p>ร่าง 0–3 รูป · ยืนยัน 1–3 รูป · JPEG / PNG / WebP รูปนิ่ง ไม่เกิน 8 MiB ต่อรูป ระบบแปลง WebP ก่อนเก็บ</p>{existing.map((id,i)=><div className="pressing-actions" key={id}><span>ภาพเดิม {i+1}</span><button type="button" className="quiet" onClick={()=>setExisting(ids=>ids.filter(v=>v!==id))}>นำออกจากฉบับนี้</button></div>)}{files.map((file,i)=><div className="pressing-actions" key={i}><span>{file.name}</span><button type="button" className="quiet" onClick={()=>setFiles(fs=>fs.filter((_,index)=>index!==i))}>นำออก</button></div>)}<label className="field"><span>เพิ่มภาพ</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={e=>{try{const selected=[...files,...Array.from(e.target.files??[])];validatePhotos([...existing.map(id=>({id})),...selected],false);setFiles(selected);setLocalError('');}catch(cause){setLocalError((cause as Error).message);}e.target.value='';}}/></label><p>ภาพฉบับเก่ายังคงอยู่ในประวัติหลังแก้ไข</p></fieldset>}
   {correcting&&<Field label="เหตุผลการแก้ไขฉบับยืนยัน" name="reason" required/>}
   <div className="pressing-actions"><button className="button primary" name="submitAction" value="save" disabled={locked}>{locked?'กำลังบันทึก…':correcting?'บันทึกฉบับแก้ไข':'บันทึกร่าง'}</button>{!correcting&&canConfirm&&doc&&<button className="button primary" name="submitAction" value="confirm" disabled={locked}>บันทึกและยืนยัน</button>}<button type="button" className="button secondary" disabled={locked} onClick={onClose}>ปิด</button></div>
   {!doc&&<p>บันทึกร่างก่อน แล้วตรวจทานและยืนยันจากหน้ารายละเอียด</p>}
   </fieldset>
  </form>
 </Modal>;
}
