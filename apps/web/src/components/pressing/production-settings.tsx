import {useState,type FormEvent} from 'react';
import type {CatalogState,CatalogProduct} from '../../lib/tile-catalog';
import {affectedProducts} from '../../lib/clay-registry';
import {formText} from '../../lib/pressing';
import {Field} from '../fields';
import {Choice,Modal,type PressingActions} from './shared';
export default function ProductionSettings({product,data,actions,onClose}:{product:CatalogProduct;data:CatalogState;actions:Pick<PressingActions,'api'|'onSaved'>;onClose:()=>void}){
 const [bodyId,setBodyId]=useState(product.body_id?String(product.body_id):'');
 const [clayId,setClayId]=useState(''),[colorId,setColorId]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const clay=data.clay_types?.find(x=>x.id===Number(clayId));
 const profile=data.profiles.find(x=>x.body_id===Number(bodyId)&&x.clay_type_id===Number(clayId)&&(x.clay_color_id??null)===(colorId?Number(colorId):null));
 const affected=bodyId?affectedProducts(Number(bodyId),data.products):[];
 async function save(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(busy)return;const f=new FormData(event.currentTarget);setBusy(true);setError('');
  try{
   if(!clay||!clay.active)throw Error('กรุณาเลือกประเภทดินที่ใช้งาน');
   if(clay.code==='COLORED'&&!colorId)throw Error('ยังไม่มีสีดินที่เลือก กรุณาเพิ่มข้อมูลสีดินก่อน');
   const number=(name:string,min:number)=>{const raw=formText(f,name),n=Number(raw);if(!raw||!Number.isFinite(n)||n<min)throw Error('กรุณากรอกค่าผลิตให้ครบ');return n;};
   const values={pieces_per_rack:number('pieces_per_rack',1),rest_days:number('rest_days',0),pieces_per_sqm:number('pieces_per_sqm',0.000001),destination:formText(f,'destination')};
   if(!Number.isInteger(values.pieces_per_rack)||!Number.isInteger(values.rest_days))throw Error('จำนวนแผ่นต่อไม้และวันพักต้องเป็นจำนวนเต็ม');
   await actions.api(`/catalog/products/${product.id}/production-settings`,'POST',{
    expected_body_id:product.body_id,body_id:bodyId?Number(bodyId):null,new_body_name:formText(f,'body_name'),
    profile_id:profile?.id??null,clay_type_id:clay.id,clay_color_id:clay.code==='COLORED'?Number(colorId):null,production:values});
   await actions.onSaved('บันทึกค่าผลิตแล้ว');onClose();
  }catch(e){setError(e instanceof Error?e.message:'บันทึกไม่สำเร็จ');}finally{setBusy(false);}
 }
 return <Modal title={`ตั้งค่าผลิต · ${product.product_code} · #${product.id}`} onClose={onClose} busy={busy}>
  <form onSubmit={save}><div className="modal-body"><fieldset disabled={busy} className="pressing-fieldset">
   <div className="form-grid">
    <Choice label="แบบดินปั๊มที่ยืนยัน" name="body_id" value={bodyId} onChange={v=>{setBodyId(v);setClayId('');setColorId('');}} empty="สร้างแบบสำหรับรายการนี้" options={data.bodies.map(b=>({value:b.id,label:`${b.name} · #${b.id}`}))}/>
    {!bodyId&&<Field label="ชื่อแบบใหม่ (ยืนยันลักษณะตามสินค้านี้)" name="body_name" required defaultValue={`${product.product_code} · ${product.name}`}/>}
    <Choice label="ประเภทดิน" name="clay_type_id" value={clayId} onChange={v=>{setClayId(v);setColorId('');}} options={(data.clay_types??[]).filter(c=>c.active).map(c=>({value:c.id,label:c.name}))}/>
    {clay?.code==='COLORED'&&<Choice label="สีดิน" name="clay_color_id" value={colorId} onChange={setColorId} options={(data.clay_colors??[]).filter(c=>c.active).map(c=>({value:c.id,label:`${c.code} · ${c.name}`}))}/>}
   </div>
   {clay?.code==='COLORED'&&!data.clay_colors?.some(c=>c.active)&&<p>ยังไม่มีสีดินให้เลือก เพิ่มเมื่อข้อมูลพร้อมได้ที่ทะเบียนประเภทดิน</p>}
   {!!affected.length&&<p>ค่าผลิตของแบบนี้ใช้ร่วมกับ: {affected.map(p=>`${p.product_code} #${p.id}`).join(', ')} กรุณาตรวจรายการก่อนบันทึก</p>}
   <div className="form-grid" key={`${bodyId}-${clayId}-${colorId}`}>
    <Field label="จำนวนแผ่นต่อไม้" name="pieces_per_rack" type="number" min={1} step={1} required defaultValue={profile?.pieces_per_rack??''}/>
    <Field label="วันพัก" name="rest_days" type="number" min={0} step={1} required defaultValue={profile?.rest_days??''}/>
    <Field label="จำนวนแผ่นต่อ ตร.ม." name="pieces_per_sqm" type="number" min={0.000001} step="any" required defaultValue={profile?.pieces_per_sqm??''}/>
    <Choice label="ปลายทางเบิก" name="destination" defaultValue={profile?.destination??''} options={[{value:'color',label:'ชุบ/เคลือบสี'},{value:'kiln',label:'เข้าเตา (บรีส)'}]}/>
   </div>
   {error&&<p role="alert" className="error-banner">{error}</p>}
   </fieldset></div><div className="modal-foot"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>ปิด</button><button className="button primary" disabled={busy||!clay||(clay.code==='COLORED'&&!colorId)}>บันทึกค่าผลิต</button></div>
  </form>
 </Modal>;
}
