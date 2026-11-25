import {useEffect,useRef} from 'react';
import {createPortal} from 'react-dom';
import type {QcReport,QcReportVersion} from '../../../../api/src/qc-documents/types';
import {outcomeLabels,printedSymptoms,qcDate,qcDateTime,reportRevisionLabel,thaiDateRange,reportReferences,sourceLabel} from './helpers';
import Worksheet from './worksheet';

export default function ReportView({report:r,version,superseded=false,worksheet=false,onClose}:{report:QcReport;version?:QcReportVersion;superseded?:boolean;worksheet?:boolean;onClose:()=>void}){
 const overlay=useRef<HTMLDivElement>(null);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;overlay.current?.focus();return ()=>previous?.focus();},[]);
 const label=worksheet?'ใบจดหน้างาน':reportRevisionLabel(version?.revision),draft=!version;
 const workers=[...new Set(r.entries.flatMap(e=>e.workers.map(w=>w.name)))];
 const rows=r.entries.flatMap(e=>e.lines.map(line=>({entry:e,line,order:r.orders.find(o=>o.loadIds.includes(line.loadId))})));
 return createPortal(<div className="qc-print-overlay" role="dialog" aria-modal="true" aria-label={`เอกสาร ${r.number}`} tabIndex={-1} ref={overlay} onKeyDown={event=>{
  if(event.key==='Escape')onClose();
  if(event.key==='Tab'){const controls=overlay.current?.querySelectorAll<HTMLElement>('button,[href],input,select,textarea,[tabindex="0"]');if(!controls?.length)return;const first=controls[0],last=controls[controls.length-1];if(event.shiftKey&&(document.activeElement===first||document.activeElement===overlay.current)){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
 }}>
  <div className="qc-report-tools"><strong>{r.number} · {label}{superseded?' · ข้อมูลก่อนแก้ไข':''}</strong><div className="pressing-actions"><button className="button primary" onClick={()=>window.print()}>พิมพ์ / บันทึก PDF</button><button className="button secondary" onClick={onClose}>ปิดเอกสาร</button></div></div>
  <article className="qc-paper">
   {worksheet?<Worksheet report={r}/>:<><section className="qc-report-summary">
    <header className="qc-report-heading"><div><strong>LT-PD-S-01</strong><h1>เอกสารบันทึกการตรวจสอบคุณภาพ</h1><p>แผนกคัดแผ่น</p></div><div><strong>{r.number}</strong><p>{label}</p></div></header>
    {(draft||superseded)&&<p className="qc-report-warning">{superseded?'ข้อมูลก่อนแก้ไข — ใช้ตรวจประวัติ':r.pending>0?'ร่าง / ยังไม่คัดครบ':'ร่าง / ยังไม่ใช่ฉบับทางการ'}</p>}
    <p><strong>อ้างอิงออเดอร์:</strong> {reportReferences(r)}</p>
    <table className="qc-report-meta"><tbody>
     <tr><th>หมายเลขเตา</th><td>{r.kiln} · เบอร์ {r.rail} · รอบ #{r.roundId}</td><th>ชื่อชิ้นงาน</th><td>{r.name}</td></tr>
     <tr><th>ดิน</th><td>{r.clay} {r.clayColor}</td><th>สี</th><td>{r.color||'ไม่มีสี'}</td></tr>
     <tr><th>วันที่เข้าเตา</th><td>{qcDate(r.startedAt)}</td><th>วันที่ออกเตา</th><td>{qcDate(r.withdrawnAt)}</td></tr>
     <tr><th>วันที่ตรวจสอบ</th><td>{thaiDateRange(r.entries.map(e=>e.at))}</td><th>ชื่อพนักงานคัด</th><td>{workers.slice(0,3).join(', ')}{workers.length>3?' (รายละเอียดหน้าแนบ)':''}</td></tr>
     <tr><th>จำนวนเข้าเตา</th><td>{r.input.toLocaleString('th-TH')} แผ่น</td><th>จำนวนออกเตา</th><td>{r.output.toLocaleString('th-TH')} แผ่น (อ้างยอดเข้า)</td></tr>
    </tbody></table>
    <table className="qc-report-counts"><thead><tr>{Object.values(outcomeLabels).map(label=><th key={label}>{label}</th>)}<th>ยังไม่คัด</th></tr></thead><tbody><tr>{Object.keys(outcomeLabels).map(k=><td key={k}>{r.counts[k as keyof typeof r.counts].toLocaleString('th-TH')}</td>)}<td>{r.pending.toLocaleString('th-TH')}</td></tr></tbody></table>
    <p className="qc-report-small">ไม่สุก / แต้ม: ต้องเข้าเตาใหม่ · A+: ผ่านด้านคุณภาพ การจัดสรร/รับสต็อกทำแยกตามขั้นตอน</p>
    <h2>รายละเอียดชิ้นงานเสีย</h2>
    <table className="qc-symptom-table"><thead><tr><th>อาการเสียหลัก</th><th>จำนวนแผ่น</th></tr></thead><tbody>{(r.printSymptoms??printedSymptoms(r.defects)).map(d=><tr key={d.name}><td>{d.name==='ไม่สุก'?'ไม่สุก (คัดเป็นเสีย)':d.name}</td><td>{d.pieces?d.pieces.toLocaleString('th-TH'):'—'}</td></tr>)}</tbody><tfoot><tr><th>รวมเสีย</th><th>{r.counts.waste.toLocaleString('th-TH')}</th></tr></tfoot></table>
    <div className="qc-report-signatures">{['ผู้รายงาน','ผู้ตรวจสอบ','ผู้อนุมัติ'].map(label=><div key={label}><p>ลงชื่อ ____________________</p><p>{label}</p><p>วันที่ ____________________</p></div>)}</div>
   </section>
   <section className="qc-report-appendix">
    <h2>รายละเอียดตามออเดอร์ — {r.number}</h2>
    <table><thead><tr><th colSpan={6}>{r.number} · {label} · ยอดตามต้นทาง</th></tr><tr><th>ออเดอร์ / ใบสั่งผลิต</th><th>เข้า</th>{Object.values(outcomeLabels).map(n=><th key={n}>{n}</th>)}</tr></thead><tbody>{r.orders.map(order=><tr key={order.orderKey}><td>{order.reference}<br/>ใบสั่งผลิต #{order.orderKey.replace('order:','')}<br/>{r.sources.filter(s=>order.loadIds.includes(s.id)).map(source=><p key={source.id}>เข้าเตา #{source.id} · {sourceLabel(source)}</p>)}</td><td>{order.input}</td>{Object.keys(outcomeLabels).map(k=><td key={k}>{order.counts[k as keyof typeof order.counts]}</td>)}</tr>)}</tbody></table>
    <h2>ผลคัดแต่ละครั้ง</h2>
    <table><thead><tr><th colSpan={4}>{r.number} · {label} · รายละเอียดการคัด</th></tr><tr><th>วันที่ / ผู้คัด</th><th>ต้นทาง</th><th>ผลคัด (แผ่น)</th><th>อาการเสีย / หมายเหตุ</th></tr></thead><tbody>{rows.map(({entry,line,order})=><tr key={`${entry.id}:${line.loadId}`}><td>{qcDateTime(entry.at)}<br/>{entry.workers.map(w=>w.name).join(', ')}<br/>บันทึก: {entry.recordedBy}</td><td>{order?.reference}<br/>ใบสั่งผลิต #{order?.orderKey.replace('order:','')}<br/>เข้าเตา #{line.loadId}<br/>{r.sources.find(s=>s.id===line.loadId)&&sourceLabel(r.sources.find(s=>s.id===line.loadId)!)}</td><td>{Object.entries(outcomeLabels).map(([k,label])=><p key={k}>{label}: {line.counts[k as keyof typeof line.counts]}</p>)}</td><td>{line.defects.map(d=><p key={d.name}>{d.name}: {d.pieces}</p>)}{entry.note&&<p>{entry.note}</p>}</td></tr>)}</tbody></table>
    {draft&&r.missing.length>0&&<p>ยังออกฉบับทางการไม่ได้: {r.missing.join(' · ')} · ยอดร่างที่ยังไม่ยืนยัน {r.draftPieces} แผ่น</p>}
    {version&&<p>สร้างฉบับเอกสารโดย {version.createdBy} เมื่อ {qcDateTime(version.createdAt)}</p>}
   </section></>}
   <footer className="qc-report-footer">LT-PD-S-01 · {r.number} · {label}{superseded?' · ข้อมูลก่อนแก้ไข':''}</footer>
  </article>
 </div>,document.body);
}
