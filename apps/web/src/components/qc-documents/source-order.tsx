import {useEffect,useState} from 'react';
import type {Api} from '../../lib/types';
import type {ProductionOrder} from '../../lib/pressing';
import {Facts,Modal} from '../pressing/shared';

export default function SourceOrder({api,orderKey,onClose}:{api:Api;orderKey:string;onClose:()=>void}){
 const [order,setOrder]=useState<ProductionOrder>(),[error,setError]=useState('');
 useEffect(()=>{let current=true;void api<{items:ProductionOrder[]}>('/pressing/orders').then(data=>{if(!current)return;const found=data.items.find(o=>'order:'+o.id===orderKey);if(found)setOrder(found);else setError('ไม่พบใบสั่งผลิตต้นทาง');}).catch(e=>{if(current)setError(e.message);});return ()=>{current=false;};},[api,orderKey]);
 return <Modal title="ใบสั่งผลิตต้นทาง" onClose={onClose} size="lg"><div className="modal-body">{error?<p className="error-banner" role="alert">{error}</p>:order?<Facts values={{'ใบสั่งผลิต':`#${order.id}`,'เลขอ้างอิง':order.customer_reference||'งานสั่งเก็บสต็อก','งาน':order.purpose==='stock'?'ผลิตเก็บสต็อก':'ตามออเดอร์ลูกค้า','สินค้า':`${order.product_snapshot?.product_code??order.product_code??''} · ${order.product_snapshot?.name??order.product_name??''}`,'ดิน':`${order.clay_name_snapshot??order.production_clay??''} ${order.clay_color_name_snapshot??order.production_clay_color??''}`,'สี':order.color_name||'ไม่มีสี','ยอดสั่งปั๊ม':order.target_pieces,'ยอดลูกค้า':order.customer_pieces??'—','ปั๊มแล้ว':order.pressed_pieces,'ติดตาข่าย':order.requires_mesh?'ใช่':'ไม่ใช่'}}/>:<p>กำลังโหลดใบสั่งผลิต…</p>}</div><div className="modal-foot"><button type="button" className="button secondary" onClick={onClose}>ปิด</button></div></Modal>;
}
