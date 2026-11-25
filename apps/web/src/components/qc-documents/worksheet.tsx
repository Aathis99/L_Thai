import type {QcReport} from '../../../../api/src/qc-documents/types';
import {outcomeLabels,printedSymptoms,qcDate,reportReferences,sourceLabel} from './helpers';

export default function Worksheet({report:r}:{report:QcReport}){
 return <>{r.sources.filter(source=>(source.pieces??0)>0).map(source=><section className="qc-work-sheet" key={source.id}>
  <header className="qc-report-heading"><div><strong>LT-PD-S-01</strong><h1>ใบแจ้งยอดคัดแผ่น — คนงานจดหน้างาน</h1></div><strong>{r.number}</strong></header>
  <p>ใบ QC อ้างอิงออเดอร์: {reportReferences(r)}</p>
  <p><strong>สำหรับออเดอร์: {source.reference} · ใบสั่งผลิต #{source.orderKey.replace('order:','')}</strong></p>
  <p>รายการเข้าเตา #{source.id} · {sourceLabel(source)}</p>
  <table className="qc-report-meta"><tbody>
   <tr><th>เตา / เบอร์ / รอบ</th><td>{r.kiln} / {r.rail} / #{r.roundId}</td><th>จำนวนเข้า / ออก</th><td>{source.pieces} แผ่น</td></tr>
   <tr><th>ชิ้นงาน</th><td>{r.name}</td><th>ดิน / สี</th><td>{r.clay} {r.clayColor} / {r.color||'ไม่มีสี'}</td></tr>
   <tr><th>วันที่เข้าเตา</th><td>{qcDate(r.startedAt)}</td><th>วันที่คัดแผ่น</th><td>________________</td></tr>
  </tbody></table>
  <table className="qc-report-counts"><thead><tr>{Object.values(outcomeLabels).map(label=><th key={label}>{label}</th>)}</tr></thead><tbody><tr>{Object.keys(outcomeLabels).map(key=><td key={key}>____________</td>)}</tr></tbody></table>
  <p className="qc-report-small">ไม่สุก / แต้ม: ส่งเข้าเตาใหม่ ไม่ลงซ้ำในตารางเสีย · หนึ่งแผ่นนับอาการเสียหลักหนึ่งอย่าง</p>
  <h2>รายละเอียดชิ้นงานเสีย</h2><table className="qc-symptom-table"><thead><tr><th>อาการเสียหลัก</th><th>จำนวนแผ่น</th></tr></thead><tbody>{(r.printSymptoms??printedSymptoms(r.defects)).map(d=><tr key={d.name}><td>{d.name==='ไม่สุก'?'ไม่สุก (คัดเป็นเสีย)':d.name}</td><td>____________</td></tr>)}</tbody></table>
  <p>อาการอื่น / หมายเหตุ: __________________________________________________</p>
  <div className="qc-report-signatures"><div>ผู้คัด ____________________<p>วันที่ ____________________</p></div><div>ผู้ตรวจสอบ ____________________<p>วันที่ ____________________</p></div></div>
 </section>)}</>;
}
