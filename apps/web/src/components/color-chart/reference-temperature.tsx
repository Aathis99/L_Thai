import {useState,type FormEvent} from 'react';
import type {ColorChartItem} from '../../lib/color-chart';
import {referenceTemperatureLabel,referenceTemperaturePayload} from '../../lib/color-chart';
import type {Api} from '../../lib/types';

type Props={item:ColorChartItem;canSet:boolean;api:Api;reload:()=>Promise<ColorChartItem[]|null>;onChanged:(value:number|null)=>Promise<void>};
export default function ReferenceTemperature({item,canSet,api,reload,onChanged}:Props){
 const [editing,setEditing]=useState(false);
 const [draft,setDraft]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 async function begin(){
  if(busy)return;
  setBusy(true);setError('');
  try{
   const items=await reload();
   if(!items){setError('โหลดข้อมูลล่าสุดไม่สำเร็จ กรุณาลองใหม่');return;}
   const current=items.find(value=>value.id===item.id);
   if(!current)return;
   setDraft(current.reference_temperature_c===null?'':String(current.reference_temperature_c));setEditing(true);
  }finally{setBusy(false);}
 }
 async function save(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(busy)return;
  let body:{temperature_c:number|null};
  try{body=referenceTemperaturePayload(draft);}catch(cause){setError((cause as Error).message);return;}
  setError('');setBusy(true);
  try{
   const result=await api<{id:number;reference_temperature_c:number|null}>(`/color-chart/${item.id}/reference-temperature`,'PUT',body);
   setEditing(false);await onChanged(result.reference_temperature_c);
  }catch(cause){
   setError(cause instanceof Error?cause.message:'บันทึกไม่สำเร็จ');
   await reload();
  }finally{setBusy(false);}
 }
 return <section aria-label="อุณหภูมิอ้างอิงของสี">
  <p>อุณหภูมิอ้างอิง (°C): {referenceTemperatureLabel(item.reference_temperature_c)}</p>
  {error&&<p role="alert" className="error-banner">{error}</p>}
  {canSet&&(editing?<form onSubmit={save}>
   <label className="field"><span>อุณหภูมิอ้างอิง (°C)</span><input name="temperature_c" type="number" step="any" value={draft} onChange={event=>setDraft(event.target.value)} disabled={busy}/></label>
   <p className="helper">เว้นว่างเพื่อล้างค่า</p>
   <button className="button success" disabled={busy} type="submit">{busy?'กำลังบันทึก…':'บันทึกอุณหภูมิ'}</button>
   <button className="button secondary" type="button" disabled={busy} onClick={()=>{setEditing(false);setError('');}}>ยกเลิก</button>
  </form>:<button className="button warning" disabled={busy} type="button" onClick={()=>void begin()}>แก้อุณหภูมิอ้างอิง</button>)}
 </section>;
}
