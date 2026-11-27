'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import type {Api,SessionUser} from '../../lib/types';
import {canRawClay,clayRequestEnvelope,canRebaseClayEditor,displayClayWeight,displayClayTime,kindLabels,statusLabels,receiptDuplicates,type ClayState,type ClayKind,type ClayDocument,type ClayRevision,type ClayStock,type ClayCommand,type ClayMovement,type ClayRequestEnvelope} from '../../lib/raw-clay';
import {Field} from '../fields';
import {Facts,Modal,Section} from '../pressing/shared';
import ClayForm from './form';

type ClayDetail={revision:number;document:ClayDocument;history:ClayRevision[];currentMovement:ClayMovement|null;movementHistory:{sourceDocumentId:number;version:number;actor:string;at:string;reason:string;movement:ClayMovement}[]};
const fieldNames:Record<string,string>={supplier:'ผู้ขาย',billNumber:'เลขบิลผู้ขาย',documentDate:'วันที่เอกสาร',tradeName:'ชื่อดินตามเอกสาร',netKg:'น้ำหนักสุทธิ (กก.)',tareKg:'น้ำหนักรถ (กก.)',grossKg:'น้ำหนักรวม (กก.)',weighInAt:'ชั่งเข้าผู้ขาย',weighOutAt:'ชั่งออกผู้ขาย',plateIn:'ทะเบียนรถเข้า',plateOut:'ทะเบียนรถออก',missingNote:'ข้อมูลใบชั่งที่ขาด',occurredAt:'วันเวลาหน้างาน',employeeName:'ผู้ทำงานจริง',quantityKg:'เบิก (กก.)',countedKg:'ยอดตรวจนับ (กก.)',reason:'เหตุผลปรับยอด',notes:'หมายเหตุ'};

function StatusPill({status}:{status:ClayDocument['status']}){
 return <span className={`status-pill ${status}`}><i className="status-dot" aria-hidden="true"/>{statusLabels[status]}</span>;
}

function ImageViewer({ids}:{ids:number[]}){
 const [open,setOpen]=useState<number|null>(null);
 return <div><div className="pressing-actions">{ids.map((id,i)=><button key={id} type="button" className="button secondary" onClick={()=>setOpen(id)}>เปิดภาพ {i+1}</button>)}</div>{open!==null&&<div className="raw-clay-image"><div className="pressing-actions"><button type="button" className="button secondary" onClick={()=>setOpen(null)}>ปิดภาพ</button><a className="button secondary" href={`/api/raw-clay/images/${open}`} target="_blank" rel="noreferrer">เปิดภาพเต็มเพื่ออ่านเอกสาร</a></div>{/* Protected same-origin endpoint, loaded only on explicit request. */}<img key={open} src={`/api/raw-clay/images/${open}`} alt="หลักฐานใบรับดิน" onError={e=>{e.currentTarget.alt='โหลดภาพไม่สำเร็จ กรุณาปิดภาพและลองใหม่';}} style={{maxWidth:'100%',height:'auto',display:'block'}}/></div>}</div>;
}

function DocumentFacts({doc,state}:{doc:ClayDocument;state:ClayState}){
 const values:Record<string,string>={'เลขรายการ':doc.number,'สถานะ':statusLabels[doc.status],'ฉบับ':String(doc.version),'ประเภทดิน':doc.data.clayTypeName?`${doc.data.clayTypeName}${doc.data.clayColorName?` · ${doc.data.clayColorName}`:''}`:clayName(state,doc.data.clayTypeId,doc.data.clayColorId),'ผู้บันทึก':doc.createdBy??doc.actor,'ผู้ทำรายการล่าสุด':doc.actor,'บันทึกเมื่อ':displayClayTime(doc.createdAt),'ผู้ยืนยัน':doc.confirmedBy??'—'};
 for(const [key,label]of Object.entries(fieldNames)){const value=doc.data[key as keyof typeof doc.data];if(value!==undefined&&value!==null&&value!=='')values[label]=key.endsWith('At')?displayClayTime(String(value)):key.endsWith('Kg')?displayClayWeight(String(value)):String(value);}
 if(!doc.data.employeeName)values['ผู้ทำงานจริง']=state.employees.find(e=>e.id===doc.data.employeeId)?.name??`#${doc.data.employeeId}`;
 return <><Facts values={values}/>{doc.kind==='receipt'&&<><h3>ภาพหลักฐาน {doc.imageIds.length} รูป</h3><ImageViewer ids={doc.imageIds}/></>}</>;
}

function clayName(state:ClayState,type:number,color:number|null){return `${state.clay_types.find(t=>t.id===type)?.name??`#${type}`}${color?` · ${state.clay_colors.find(c=>c.id===color)?.name??`#${color}`}`:''}`;}

function StockKpiStrip({state,tab}:{state:ClayState;tab:ClayKind|'stock'}){
 const totalBalanceKg=state.stock.reduce((sum,item)=>sum+(Number(item.balanceKg)||0),0);
 const totalTons=(totalBalanceKg/1000).toLocaleString('th-TH',{minimumFractionDigits:3,maximumFractionDigits:3});
 const draftCount=state.documents.filter(d=>d.status==='draft').length;
 const confirmedCount=state.documents.filter(d=>d.status==='confirmed').length;
 return <section className="clay-kpi-grid" aria-label="สรุปสต็อกวัตถุดิบ">
  <article className="clay-kpi-card">
   <div>
    <div className="clay-kpi-label">วัตถุดิบคงเหลือรวม</div>
    <div className="clay-kpi-value">{displayClayWeight(totalBalanceKg.toFixed(3))}<span className="clay-kpi-unit">กก.</span></div>
    <div className="clay-kpi-sub">{totalTons} ตัน · {state.stock.length} ประเภทดิน</div>
   </div>
   <span className="clay-kpi-icon clay" aria-hidden="true">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17h18l-2-9H5l-2 9Z"/><path d="M2 20h20"/></svg>
   </span>
  </article>
  <article className="clay-kpi-card">
   <div>
    <div className="clay-kpi-label">รายการร่างในหน้านี้</div>
    <div className="clay-kpi-value">{draftCount}<span className="clay-kpi-unit">รายการ</span></div>
    <div className={`clay-kpi-sub${draftCount>0?' warn':''}`}>{draftCount>0?'ยังไม่รวมเข้าสต็อกจนกว่าจะยืนยัน':'ไม่มีรายการร่างค้างตรวจในหน้านี้'}</div>
   </div>
   <span className="clay-kpi-icon warn" aria-hidden="true">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4Z"/></svg>
   </span>
  </article>
  <article className="clay-kpi-card">
   <div>
    <div className="clay-kpi-label">{tab==='stock'?'ประเภทดินที่มีสต็อก':`รายการ${kindLabels[tab]}ตามตัวกรอง`}</div>
    <div className="clay-kpi-value">{tab==='stock'?state.stock.length:state.total}<span className="clay-kpi-unit">{tab==='stock'?'ประเภท':'รายการ'}</span></div>
    <div className="clay-kpi-sub">{tab==='stock'?'รวมตามประเภทดินและสีดิน':`ยืนยันแล้ว ${confirmedCount} รายการในหน้านี้`}</div>
   </div>
   <span className="clay-kpi-icon good" aria-hidden="true">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
   </span>
  </article>
 </section>;
}

function StockTable({state,items,period=false}:{state:ClayState;items:ClayStock[];period?:boolean}){
 return <div className="table-wrap"><table><thead><tr><th>ประเภทดิน / สีดิน</th>{period&&<th className="num-col">ยกมา (กก.)</th>}<th className="num-col">รับเข้า (กก.)</th><th className="num-col">เบิกเข้าโม่ (กก.)</th><th className="num-col">ปรับยอด (กก.)</th><th className="num-col">{period?'คงเหลือปลายช่วง':'คงเหลือปัจจุบัน'} (กก.)</th></tr></thead><tbody>{items.map(s=><tr key={`${s.clayTypeId}:${s.clayColorId}`}><td><strong>{clayName(state,s.clayTypeId,s.clayColorId)}</strong></td>{period&&<td className="num-col">{displayClayWeight(s.openingKg)}</td>}<td className="num-col">{displayClayWeight(s.receivedKg)}</td><td className="num-col">{displayClayWeight(s.issuedKg)}</td><td className="num-col">{displayClayWeight(s.adjustmentKg)}</td><td className="num-col"><strong>{displayClayWeight(s.balanceKg)}</strong></td></tr>)}{!items.length&&<tr><td colSpan={period?6:5}>ยังไม่มีรายการวัตถุดิบ</td></tr>}</tbody></table></div>;
}

export default function RawClayPanel({api,user}:{api:Api;user:SessionUser}){
 const [tab,setTab]=useState<ClayKind|'stock'>('receipt'),[state,setState]=useState<ClayState|null>(null),[error,setError]=useState(''),[message,setMessage]=useState(''),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false);
 const [filters,setFilters]=useState({search:'',status:'',clayTypeId:'',from:'',to:''}),[page,setPage]=useState(1);
 const [editor,setEditor]=useState<{kind:ClayKind;document?:ClayDocument;revision:number}|null>(null),[detail,setDetail]=useState<ClayDetail|null>(null),[cancelling,setCancelling]=useState(false);
 const [uncertain,setUncertain]=useState(false),[conflict,setConflict]=useState(false),[reconcile,setReconcile]=useState<ClayDetail|null>(null);
 const latest=useRef(0),pending=useRef<ClayRequestEnvelope|null>(null);
 const [duplicateReview,setDuplicateReview]=useState<{signature:string;documents:ClayDocument[];acknowledged:boolean}|null>(null);
 const can=(operation:string)=>canRawClay(user.permissions,operation);
 const refresh=useCallback(async()=>{
  const ticket=++latest.current;setLoading(true);
  try{const query=new URLSearchParams({...filters,page:String(page),pageSize:'30',...(tab==='stock'?{}:{kind:tab})});const result=await api<ClayState>(`/raw-clay/state?${query}`);if(ticket===latest.current){setState(result);setError('');}return result;}catch(cause){if(ticket===latest.current)setError(cause instanceof Error?cause.message:'โหลดข้อมูลไม่สำเร็จ');return null;}finally{if(ticket===latest.current)setLoading(false);}
 },[api,filters,page,tab]);
 useEffect(()=>{void refresh();return()=>{latest.current++;};},[refresh]);
 async function openDocument(id:number){setError('');setDuplicateReview(null);try{const result=await api<ClayDetail>(`/raw-clay/documents/${id}`);setDetail({...result,revision:state!.revision});setCancelling(false);}catch(cause){setError((cause as Error).message);}}
 async function mutate(command:ClayCommand,revision=state!.revision){
  if(busy)return false;setBusy(true);setError('');setMessage('');
  const body=pending.current?.body??{revision,...command};command=body;let sent=false;
  try{
   const source=command.payload.data??detail?.document.data,kind=command.payload.kind??detail?.document.kind;
   if(!pending.current&&kind==='receipt'&&source&&(command.action==='save'||command.action==='confirm')&&source.billNumber&&source.documentDate){
    const query=new URLSearchParams({supplier:source.supplier??'',billNumber:source.billNumber,documentDate:source.documentDate,plate:source.plateOut||source.plateIn||'',ownId:String(command.payload.id??0)});
    const candidates=(await api<{documents:ClayDocument[]}>(`/raw-clay/duplicates?${query}`)).documents;
    const duplicates=receiptDuplicates(source,candidates,command.payload.id),signature=JSON.stringify({command,documents:duplicates.map(d=>[d.id,d.version])});
    if(duplicates.length&&(duplicateReview?.signature!==signature||!duplicateReview.acknowledged)){setDuplicateReview({signature,documents:duplicates,acknowledged:false});setError('พบใบรับที่อาจซ้ำ กรุณาเปิดตรวจรายการเดิมและยืนยันว่าเป็นเที่ยวรับแยกก่อนบันทึก');return false;}
   }
   pending.current=clayRequestEnvelope(pending.current,body);sent=true;
   const result=await api<{document:ClayDocument;revision:number}>('/raw-clay/action','POST',{...pending.current.body,requestId:pending.current.requestId});if(!result?.document?.id||!Number.isInteger(result.revision)||!kindLabels[result.document.kind])throw Error('เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง กรุณาลองคำขอเดิมอีกครั้ง');pending.current=null;setUncertain(false);setConflict(false);setEditor(null);setDuplicateReview(null);await refresh();setDetail(null);setMessage(`${kindLabels[result.document.kind]} ${result.document.number} · ${statusLabels[result.document.status]}เรียบร้อย`);return true;
  }catch(cause){const status=(cause as {status?:number}).status;if(sent){if(status&&[400,401,403,404,409,413,422].includes(status)){pending.current=null;setUncertain(false);setConflict(status===409);}else{setUncertain(true);}}setError(cause instanceof Error?cause.message:'บันทึกไม่สำเร็จ');return false;}finally{setBusy(false);}
 }
 const filterChange=(key:keyof typeof filters,value:string)=>{setPage(1);setFilters(f=>({...f,[key]:value}));};
 const duplicateWarning=state&&duplicateReview&&<aside className="info-banner"><strong>ตรวจใบรับที่อาจซ้ำ</strong><p>ผู้ขาย เลขบิล วันที่เอกสาร และทะเบียนรถตรงกัน โปรดเปิดรายละเอียดก่อนเพิ่มอีกเที่ยว</p>{duplicateReview.documents.map(doc=><details key={doc.id}><summary>เปิด {doc.number} · {statusLabels[doc.status]} · {doc.data.netKg??'—'} กก.</summary><DocumentFacts doc={doc} state={state}/></details>)}<label className="check-line"><input type="checkbox" checked={duplicateReview.acknowledged} disabled={busy} onChange={e=>setDuplicateReview(current=>current?{...current,acknowledged:e.target.checked}:null)}/><span>ตรวจรายการเดิมแล้ว ยืนยันว่าเที่ยวรับนี้เป็นคนละรายการและต้องการบันทึกต่อ</span></label></aside>;
 return <div className="pressing-panel">
  {state&&<StockKpiStrip state={state} tab={tab}/>}
  <div className="pressing-navigation">
   <nav aria-label="งานวัตถุดิบ">{(['receipt','stock','issue','adjustment'] as const).map(t=><button key={t} className={`button ${tab===t?'tab-selected':'secondary'}`} aria-pressed={tab===t} onClick={()=>{setTab(t);setPage(1);setDetail(null);}}>{t==='stock'?'สต็อกวัตถุดิบ':t==='adjustment'?'ปรับยอดและประวัติ':kindLabels[t]}</button>)}</nav>
   <button className="button secondary" disabled={loading||busy} onClick={()=>void refresh()}>โหลดล่าสุด</button>
  </div>
  {message&&<p role="status" className="success-banner">{message}</p>}{error&&!editor&&<p role="alert" className="error-banner">{error}</p>}
  <Section title="ค้นหาและช่วงรายงาน">
   <div className="clay-filters">
    {tab!=='stock'&&<div className="clay-filter-search"><Field label="ผู้ขาย / เลขบิล / ทะเบียน / เลขรายการ" value={filters.search} onChange={e=>filterChange('search',e.target.value)}/></div>}
    <label className="field"><span>ประเภทดิน</span><select value={filters.clayTypeId} onChange={e=>filterChange('clayTypeId',e.target.value)}><option value="">ทั้งหมด</option>{state?.clay_types.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
    {tab!=='stock'&&<label className="field"><span>สถานะ</span><select value={filters.status} onChange={e=>filterChange('status',e.target.value)}><option value="">ทั้งหมด</option>{Object.entries(statusLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>}
    <Field label="ตั้งแต่วันที่" type="date" value={filters.from} onChange={e=>filterChange('from',e.target.value)}/>
    <Field label="ถึงวันที่" type="date" value={filters.to} onChange={e=>filterChange('to',e.target.value)}/>
   </div>
  </Section>
  {loading&&<p role="status">กำลังโหลด…</p>}
  {state&&<>{tab==='stock'?<><Section title="คงเหลือปัจจุบัน"><p>รวมตามประเภทดินและสีดิน ชื่อการค้าอยู่ในใบรับ หน่วยกิโลกรัม</p><StockTable state={state} items={state.stock.filter(s=>!filters.clayTypeId||s.clayTypeId===Number(filters.clayTypeId))}/></Section><Section title="สรุปตามช่วงวันที่"><p>แยกยอดยกมา การเคลื่อนไหวในช่วง และคงเหลือปลายช่วง</p><StockTable state={state} items={state.summary.filter(s=>!filters.clayTypeId||s.clayTypeId===Number(filters.clayTypeId))} period/></Section></>:<Section title={tab==='adjustment'?'รายการตรวจนับและประวัติปรับยอด':kindLabels[tab]} action={can(tab==='adjustment'?'adjust':'record')&&<button className="button primary" disabled={busy} onClick={()=>{setError('');setDuplicateReview(null);setEditor({kind:tab,revision:state.revision});}}>＋ เพิ่ม{kindLabels[tab]}</button>}>
   <div className="table-wrap"><table><thead><tr><th>วันเวลาหน้างาน</th><th>เลขรายการ</th><th>ประเภทดิน / สีดิน</th>{tab==='receipt'&&<><th>ผู้ขาย / บิล</th><th>ชื่อดินตามเอกสาร</th></>}<th className="num-col">น้ำหนัก (กก.)</th><th>ผู้ทำงานจริง</th><th>สถานะ</th>{tab==='receipt'&&<th className="num-col">รูป</th>}<th>รายละเอียด</th></tr></thead><tbody>{state.documents.map(doc=><tr key={doc.id}><td className="whitespace-nowrap">{displayClayTime(doc.data.occurredAt)}</td><td className="whitespace-nowrap"><strong>{doc.number}</strong></td><td>{clayName(state,doc.data.clayTypeId,doc.data.clayColorId)}</td>{tab==='receipt'&&<><td><strong>{doc.data.supplier}</strong>{doc.data.billNumber&&<span className="subtext">{doc.data.billNumber}</span>}</td><td>{doc.data.tradeName}</td></>}<td className="num-col"><strong>{displayClayWeight(doc.data.netKg??doc.data.quantityKg??doc.data.countedKg??'—')}</strong></td><td>{doc.data.employeeName??state.employees.find(e=>e.id===doc.data.employeeId)?.name??'—'}</td><td><span className="status-cell"><StatusPill status={doc.status}/><span className="version-tag">ฉบับ {doc.version}</span></span></td>{tab==='receipt'&&<td className="num-col">{doc.imageIds.length}</td>}<td><button className="button secondary" onClick={()=>void openDocument(doc.id)}>เปิด / ประวัติ</button></td></tr>)}{!state.documents.length&&<tr><td colSpan={10}>ไม่พบรายการตามตัวกรอง</td></tr>}</tbody></table></div>
   <div className="raw-clay-pagination">
    <span>หน้า {state.page} · ทั้งหมด {state.total} รายการ</span>
    <div className="pressing-actions">
     <button className="button secondary" disabled={page<=1||loading} onClick={()=>setPage(p=>p-1)}>ก่อนหน้า</button>
     <button className="button secondary" disabled={page*state.pageSize>=state.total||loading} onClick={()=>setPage(p=>p+1)}>ถัดไป</button>
    </div>
   </div>
  </Section>}
  {detail&&!editor&&<Modal title={`${kindLabels[detail.document.kind]} · ${detail.document.number}`} busy={busy} guardDismissal size="lg" onClose={()=>{if(!pending.current){setDetail(null);setCancelling(false);}}}>
   <div className="raw-clay-detail-body">
    <div className="status-cell"><StatusPill status={detail.document.status}/><span className="version-tag">ฉบับ {detail.document.version}</span></div>
    {uncertain&&<aside className="error-banner" role="alert"><span>ยังไม่ทราบผลบันทึก</span><button className="button primary" disabled={busy} onClick={()=>{if(pending.current)void mutate(pending.current.body,pending.current.body.revision);}}>ลองคำขอเดิมอีกครั้ง</button></aside>}
    <DocumentFacts doc={detail.document} state={state}/>
    {detail.currentMovement&&<p className="info-banner">ผลต่อยอดปัจจุบัน: ก่อน <strong>{displayClayWeight(detail.currentMovement.beforeKg)}</strong> · เปลี่ยนแปลง <strong>{displayClayWeight(detail.currentMovement.deltaKg)}</strong> · หลัง <strong>{displayClayWeight(detail.currentMovement.afterKg)}</strong></p>}
    {detail.document.kind==='adjustment'&&detail.movementHistory?.map((h,i)=><p key={i}><button className="quiet" onClick={()=>void openDocument(h.sourceDocumentId)}>เปิดต้นทาง #{h.sourceDocumentId} ฉบับ {h.version}</button> · {displayClayTime(h.at)} · {h.actor} · {h.reason} · ก่อน {displayClayWeight(h.movement.beforeKg)} · เปลี่ยนแปลง {displayClayWeight(h.movement.deltaKg)} · หลัง {displayClayWeight(h.movement.afterKg)}</p>)}
    {duplicateWarning}
    <div className="raw-clay-detail-actions">
     <div className="pressing-actions">
      {detail.document.status==='draft'&&can('confirm')&&(detail.document.kind!=='adjustment'||can('adjust'))&&<button className="button primary" disabled={busy} onClick={()=>void mutate({action:'confirm',payload:{id:detail.document.id}},detail.revision)}>ยืนยันรายการนี้</button>}
      {detail.document.status!=='cancelled'&&can(detail.document.status==='draft'?(detail.document.kind==='adjustment'?'adjust':'record'):'correct')&&(detail.document.kind!=='adjustment'||detail.document.status==='draft'||can('adjust'))&&<button className={`button ${detail.document.status==='draft'?'secondary':'warning'}`} disabled={busy} onClick={()=>{setError('');setEditor({kind:detail.document.kind,document:detail.document,revision:detail.revision});}}>แก้{detail.document.status==='draft'?'ร่าง':'ไขพร้อมเหตุผล'}</button>}
     </div>
     {detail.document.status!=='cancelled'&&can('correct')&&(detail.document.kind!=='adjustment'||can('adjust'))&&<button className="button danger-soft" disabled={busy} onClick={()=>setCancelling(true)}>ยกเลิกรายการพร้อมเหตุผล</button>}
    </div>
    {cancelling&&<form className="raw-clay-cancel-box" onSubmit={async e=>{e.preventDefault();const reason=String(new FormData(e.currentTarget).get('reason')??'');await mutate({action:'cancel',payload:{id:detail.document.id,reason}},detail.revision);}}>
     <Field label="เหตุผลยกเลิก (เก็บประวัติและคำนวณยอดใหม่)" name="reason" required/>
     <div className="pressing-actions">
      <button className="button destructive" disabled={busy}>ยืนยันยกเลิกรายการ</button>
      <button type="button" className="button secondary" disabled={busy} onClick={()=>setCancelling(false)}>ไม่ยกเลิก</button>
     </div>
    </form>}
    {error&&<p className="error-banner" role="alert">{error}</p>}
    <h3>ประวัติฉบับและผลต่อยอด</h3>
    {detail.history.map((revision,i)=><details key={`${revision.version}:${i}`}><summary>ฉบับ {revision.version} · {displayClayTime(revision.at)} · {revision.actor} · {revision.reason||'บันทึกรายการ'}</summary><DocumentFacts doc={revision.document} state={state}/><p>ผลคำนวณรายการเคลื่อนไหว ณ ฉบับนี้ รวมจุดตรวจนับที่ได้รับผลจากการแก้ไข</p><div className="table-wrap"><table><thead><tr><th>รายการอ้างอิง</th><th>ประเภทดิน / สี</th><th className="num-col">ก่อน (กก.)</th><th className="num-col">เปลี่ยนแปลง (กก.)</th><th className="num-col">หลัง (กก.)</th></tr></thead><tbody>{revision.movements.map(m=><tr key={m.documentId}><td><button type="button" className="quiet" onClick={()=>void openDocument(m.documentId)}>เปิด #{m.documentId}</button></td><td>{clayName(state,m.clayTypeId,m.clayColorId)}</td><td className="num-col">{displayClayWeight(m.beforeKg)}</td><td className="num-col">{displayClayWeight(m.deltaKg)}</td><td className="num-col">{displayClayWeight(m.afterKg)}</td></tr>)}</tbody></table></div></details>)}
    {!detail.history.length&&<p>ยังไม่มีประวัติฉบับก่อนหน้า</p>}
   </div>
  </Modal>}
  {uncertain&&<aside className="error-banner" role="alert"><span>ยังไม่ทราบผลบันทึก กรุณาลองคำขอเดิมอีกครั้งก่อนทำรายการอื่น</span><button className="button primary" disabled={busy} onClick={()=>{if(pending.current)void mutate(pending.current.body,pending.current.body.revision);}}>ลองบันทึกคำขอเดิมอีกครั้ง</button></aside>}
  {editor&&<ClayForm key={editor.document?.id+':'+editor.document?.version} retryPending={uncertain} onRetry={()=>{if(pending.current)void mutate(pending.current.body,pending.current.body.revision);}} conflict={conflict} reconciliation={reconcile&&<aside className="info-banner"><strong>เอกสารนี้มีฉบับใหม่ กรุณาตรวจข้อมูลและภาพล่าสุดด้านล่าง</strong><DocumentFacts doc={reconcile.document} state={state}/><p>การโหลดฉบับล่าสุดจะทิ้งค่าที่ยังไม่บันทึกและภาพที่เลือกในฟอร์มนี้</p><button type="button" className="button secondary" disabled={busy} onClick={()=>{setEditor(current=>current?{kind:reconcile.document.kind,document:reconcile.document,revision:reconcile.revision}:null);setReconcile(null);setConflict(false);setError('');}}>ทิ้งค่าที่ยังไม่บันทึกและโหลดฉบับล่าสุด</button></aside>} state={state} kind={editor.kind} document={editor.document} duplicateWarning={duplicateWarning} busy={busy} error={error} canConfirm={can('confirm')&&(editor.kind!=='adjustment'||can('adjust'))} onClose={()=>{if(!pending.current){setEditor(null);setDuplicateReview(null);setReconcile(null);setConflict(false);}}} onSave={command=>mutate(command,editor.revision)} onReload={async()=>{if(!conflict||pending.current)return;const fresh=await refresh();if(!fresh)return;const loaded=editor.document?await api<ClayDetail>(`/raw-clay/documents/${editor.document.id}`):null;const current=loaded?{...loaded,revision:fresh.revision}:null;if(current)setDetail(current);if(!canRebaseClayEditor(editor.document,current?.document)){setReconcile(current);setError('เอกสารนี้ถูกแก้ไขแล้ว ตรวจฉบับล่าสุดและเลือกโหลดก่อนบันทึก');return;}setEditor(previous=>previous?{...previous,revision:fresh.revision}:null);setConflict(false);setError('');setMessage('โหลดสถานะล่าสุดแล้ว เอกสารนี้ยังเป็นฉบับเดิม');}}/>}
  </>}
 </div>;
}
