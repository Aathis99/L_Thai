"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import type {Api,SessionUser} from '../../lib/types';
import type {Data,Command} from '../kiln-prototype/types';
import type {QcDocumentEntry,QcReport,QcReportVersion} from '../../../../api/src/qc-documents/types';
import {Field} from '../fields';
import {Card,Choice,Facts,Section} from '../pressing/shared';
import EntryForm from './entry-form';
import ReportView from './report';
import SourceOrder from './source-order';
import {matchesQc,outcomeLabels,qcDateTime,reportStatus,reportRevisionLabel,thaiDateRange,refreshedEditor,sourceLabel} from './helpers';
import './print.css';

export default function QcDocumentsPage({api,user,openOperations}:{api:Api;user:SessionUser;openOperations:()=>void}){
 const [data,setData]=useState<Data>(),[selected,setSelected]=useState<number>(),[query,setQuery]=useState(''),[kiln,setKiln]=useState(''),[status,setStatus]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[editor,setEditor]=useState<{entry?:QcDocumentEntry;epoch?:number}|null>(null);
 const [preview,setPreview]=useState<{content:QcReport;version?:QcReportVersion;superseded?:boolean;worksheet?:boolean}|null>(null);
 const [sourceOrder,setSourceOrder]=useState<string>();
 const request=useRef<{key:string;body:unknown}|null>(null),generation=useRef(0);
 const can=(p:string)=>user.permissions.includes('finishing.'+p);
 const refresh=useCallback(async()=>{const n=++generation.current;const next=await api<Data>('/kiln/state');if(n===generation.current)setData(next);return next;},[api]);
 useEffect(()=>{void refresh().catch(e=>setError(e.message));return ()=>{generation.current++;};},[refresh]);
 const mutate=async(command:Command):Promise<Data|undefined>=>{
  if(!data||busy)return;setBusy(true);setError('');setMessage('');const key=JSON.stringify(command);
  if(request.current?.key!==key)request.current={key,body:{request_id:crypto.randomUUID(),revision:data.revision,catalog_version:data.catalogVersion,command}};
  try{const next=await api<Data>('/kiln/action','POST',request.current.body);setData(next);request.current=null;setMessage('บันทึกแล้ว');return next;}
  catch(e){setError((e as Error).message);return;}
  finally{setBusy(false);}
 };
 const reload=async()=>{if(busy)return;try{
  const next=await refresh();request.current=null;setError('');
  const latest=next.state.qcDocuments?.find(d=>d.id===selected)?.entries.find(e=>e.id===editor?.entry?.id),result=refreshedEditor(editor?.entry,latest);
  if(result.kind==='close'){setEditor(null);setMessage('ผลคัดที่กำลังแก้มีสถานะเปลี่ยนแล้ว กรุณาตรวจรายการล่าสุด');}
  else if(result.kind==='replace'){setEditor({entry:result.entry,epoch:(editor?.epoch??0)+1});setMessage('มีการแก้ไขผลคัดนี้แล้ว โหลดค่าล่าสุดแทนค่าที่เปิดค้างไว้ กรุณาตรวจทานและกรอกใหม่');}
  else setMessage('โหลดข้อมูลล่าสุดแล้ว กรุณาตรวจทานก่อนส่งอีกครั้ง');
 }catch(e){setError((e as Error).message);}};
 if(!data)return <Section title="ใบตรวจสอบคุณภาพ"><p>{error||'กำลังโหลดใบ QC…'}</p>{error&&<button className="button secondary" onClick={()=>void reload()}>โหลดใหม่</button>}</Section>;
 const documents=data.state.qcDocuments??[],doc=documents.find(d=>d.id===selected),report=doc?data.qcReports?.[doc.id]:undefined;
 const button=(label:string,command:Command,permission='qc')=>can(permission)&&<button className="button secondary" disabled={busy} onClick={()=>void mutate(command)}>{label}</button>;
 return <div className="qc-documents">
  <div className="pressing-actions"><button className="button secondary" disabled={busy} onClick={()=>void reload()}>โหลดข้อมูลล่าสุด</button><button className="button secondary" onClick={openOperations}>จัดสรร / ซ่อม</button></div>
  {error&&<p className="error" role="alert">{error} <button className="button secondary" disabled={busy} onClick={()=>void reload()}>โหลดล่าสุดและตรวจทาน</button></p>}
  {message&&<p role="status">{message}</p>}
  {!doc||!report?<>
   <Section title="ใบตรวจสอบคุณภาพ LT-PD-S-01"><p>หนึ่งใบต่อรอบเผาและสินค้า/ดิน/สีเดียวกัน แยกยอดตามออเดอร์ต้นทาง</p>
    <div className="qc-filters"><Field label="ค้นเลข QC / ออเดอร์ / ใบสั่งผลิต" value={query} onChange={e=>setQuery(e.target.value)} /><Choice label="เตา" name="kiln" value={kiln} onChange={setKiln} empty="ทุกเตา" options={data.state.kilns.map(k=>({value:k.name,label:k.name}))} /><Choice label="สถานะ" name="status" value={status} onChange={setStatus} empty="ทุกสถานะ" options={['ร่าง','กำลังคัด','คัดครบ รอออกฉบับทางการ','คัดครบ รอข้อมูล/ร่างค้าง','ฉบับทางการ'].map(s=>({value:s,label:s}))} /><Field label="สร้างตั้งแต่" type="date" value={from} onChange={e=>setFrom(e.target.value)} /><Field label="ถึงวันที่" type="date" value={to} onChange={e=>setTo(e.target.value)} /></div>
    <div className="qc-table-scroll"><table className="qc-table"><thead><tr><th>เลข QC / ออเดอร์</th><th>เตา / ชิ้นงาน</th><th>เข้า / ออก</th><th>ยืนยันแล้ว</th><th>ยังไม่คัด</th><th>สถานะ</th><th>เปิด</th></tr></thead><tbody>
     {documents.filter(d=>{const r=data.qcReports?.[d.id],day=new Date(Date.parse(d.createdAt)+7*3600000).toISOString().slice(0,10);return r&&matchesQc(r,query)&&(!kiln||r.kiln===kiln)&&(!status||reportStatus(r)===status)&&(!from||day>=from)&&(!to||day<=to);}).slice().reverse().map(d=>{const r=data.qcReports![d.id];return <tr key={d.id}><td><strong>{d.number}</strong><br/>{r.orders.map(o=>o.reference).join(' / ')}</td><td>{r.kiln} · รอบ #{r.roundId}<br/>{r.name}<br/>{r.clay} {r.clayColor} · {r.color||'ไม่มีสี'}</td><td>{r.input.toLocaleString('th-TH')}</td><td>{r.confirmed.toLocaleString('th-TH')}</td><td>{r.pending.toLocaleString('th-TH')}</td><td>{reportStatus(r)}</td><td><button className="button secondary" onClick={()=>{setSelected(d.id);setError('');}}>เปิดใบ</button></td></tr>;})}
    </tbody></table></div>{documents.length===0&&<p>ยังไม่มีใบ QC เปิดใบจากงานที่เอาของลงแล้วด้านล่าง</p>}
   </Section>
   <Section title="งานออกเตาที่พร้อมเปิดใบ QC"><div className="pressing-cards">{(data.qcCandidates??[]).map(candidate=><Card key={candidate.groupKey} title={`รอบ #${candidate.roundId} · ${candidate.loads[0].name}`} meta={<p>{candidate.loads.map(l=>l.reference).join(' / ')}</p>} actions={can('qc')&&<button className="button primary" disabled={busy} onClick={async()=>{const next=await mutate({op:'qc-document-open',loadId:candidate.loads[0].id});const saved=next?.state.qcDocuments?.find(d=>d.groupKey===candidate.groupKey);if(saved)setSelected(saved.id);}}>เปิดใบ QC</button>}><p>{candidate.loads[0].clay} {candidate.loads[0].clayColor} · {candidate.loads[0].color||'ไม่มีสี'}</p></Card>)}</div>{!data.qcCandidates?.length&&<p>ยังไม่มีงานที่พร้อมเปิดใบ QC ให้เอาของลงจากเตาให้เสร็จก่อน</p>}</Section>
  </>:<>
   <Section title={`${doc.number} · ${reportStatus(report)}`} action={<button className="button secondary" onClick={()=>{setSelected(undefined);setEditor(null);}}>กลับรายการใบ QC</button>}>
    <Facts values={{'เตา / เบอร์ / รอบ':`${report.kiln} / ${report.rail} / #${report.roundId}`,'ชิ้นงาน':report.name,'ดิน / สี':`${report.clay} ${report.clayColor} · ${report.color||'ไม่มีสี'}`,'วันที่เข้า / ออก':`${qcDateTime(report.startedAt)} / ${qcDateTime(report.withdrawnAt)}`,'ตรวจช่วงวันที่':thaiDateRange(report.entries.map(e=>e.at)),'เข้าเตา':report.input.toLocaleString('th-TH'),'ออกเตา (อ้างยอดเข้า)':report.output.toLocaleString('th-TH'),'ยืนยันแล้ว':report.confirmed.toLocaleString('th-TH'),'ยังไม่คัด':report.pending.toLocaleString('th-TH'),'ร่างที่ยังไม่ยืนยัน':report.draftPieces.toLocaleString('th-TH')}} />
    <p><strong>อ้างอิงออเดอร์:</strong> {report.orders.map(o=>o.reference).join(' / ')}</p>
    <div className="pressing-actions">{can('qc')&&<button className="button primary" disabled={busy||report.pending===0} onClick={()=>{setError('');setEditor({});}}>เพิ่มผลคัด</button>}<button className="button secondary" onClick={()=>setPreview({content:report,worksheet:true})}>พิมพ์ใบจดหน้างาน</button><button className="button secondary" onClick={()=>setPreview({content:report})}>ดู / พิมพ์ร่าง</button>{report.ready&&<button className="button primary" disabled={busy} onClick={async()=>{const next=await mutate({op:'qc-document-issue',documentId:doc.id});const latest=next?.state.qcDocuments?.find(d=>d.id===doc.id)?.reports.at(-1);if(latest)setPreview({content:latest.content,version:latest});}}>{report.officialCurrent?'พิมพ์ฉบับทางการซ้ำ':'สร้างฉบับทางการ'}</button>}</div>
    {!report.ready&&<p>ก่อนออกฉบับทางการ: {report.missing.join(' · ')}</p>}
    {doc.reports.length>0&&!report.officialCurrent&&<p className="error">ฉบับเดิมมีข้อมูลก่อนการแก้ไข กรุณาตรวจและออกฉบับใหม่เมื่อข้อมูลครบ</p>}
   </Section>
   <Section title="ยอดยืนยันแยกตามออเดอร์"><div className="qc-table-scroll"><table className="qc-table"><thead><tr><th>ออเดอร์ / ต้นทาง</th><th>เข้า</th>{Object.values(outcomeLabels).map(n=><th key={n}>{n}</th>)}</tr></thead><tbody>{report.orders.map(order=><tr key={order.orderKey}><td>{order.reference}<br/>ใบสั่งผลิต #{order.orderKey.replace('order:','')}<br/>{report.sources.filter(s=>order.loadIds.includes(s.id)).map(source=><p key={source.id}>รายการเข้าเตา #{source.id} · {sourceLabel(source)} {source.parentDocumentId&&<button className="button secondary" onClick={()=>setSelected(source.parentDocumentId)}>เปิดใบ QC ต้นทาง</button>}</p>)}{user.permissions.includes('pressing.read')&&<button className="button secondary" onClick={()=>setSourceOrder(order.orderKey)}>เปิดใบสั่งผลิตต้นทาง</button>}</td><td>{order.input}</td>{Object.keys(outcomeLabels).map(k=><td key={k}>{order.counts[k as keyof typeof order.counts]}</td>)}</tr>)}</tbody></table></div></Section>
   <Section title="ผลคัดแต่ละครั้ง"><div className="pressing-cards">{doc.entries.filter(e=>e.status!=='cancelled').map(entry=>{
    const actual=entry.status==='confirmed'?report.entries.find(e=>e.id===entry.id)!:entry;
    return <Card key={entry.id} title={`${entry.status==='draft'?'ร่าง':'ยืนยันแล้ว'} #${entry.id} · ${qcDateTime(entry.at)}`} meta={<p>ผู้คัด: {entry.workers.map(w=>w.name).join(', ')||'ยังไม่ระบุ'} · บันทึกโดย {entry.recordedBy}</p>} actions={<>{entry.status==='draft'?<>{can('qc')&&<button className="button secondary" disabled={busy} onClick={()=>{setError('');setEditor({entry});}}>แก้ร่าง</button>}{button('ยืนยันครั้งนี้',{op:'qc-draft-confirm',documentId:doc.id,entryId:entry.id})}{button('ยกเลิกร่าง',{op:'qc-draft-delete',documentId:doc.id,entryId:entry.id})}</>:can('correct')&&can('qc')&&<button className="button secondary" disabled={busy} onClick={()=>{setError('');setEditor({entry:actual});}}>แก้ผลยืนยัน</button>}</>}>
     {actual.lines.map(line=><p key={line.loadId}>รายการเข้าเตา #{line.loadId}: {Object.entries(outcomeLabels).map(([k,label])=>`${label} ${line.counts[k as keyof typeof line.counts]}`).join(' · ')}</p>)}{entry.note&&<p>{entry.note}</p>}
    </Card>;
   })}</div>{doc.entries.length===0&&<p>ยังไม่มีผลคัด เพิ่มข้อมูลจากกระดาษแล้วบันทึกร่างเพื่อตรวจทาน</p>}</Section>
   <Section title="ฉบับเอกสารและประวัติการแก้ไข">{doc.reports.map(version=><p key={version.revision}>{reportRevisionLabel(version.revision)} · {qcDateTime(version.createdAt)} · {version.createdBy} <button className="button secondary" onClick={()=>setPreview({content:version.content,version,superseded:!report.officialCurrent||version!==doc.reports.at(-1)})}>ดูฉบับนี้</button></p>)}{doc.corrections.map((correction,i)=><p key={i}>{qcDateTime(correction.at)} · {correction.actor} · {correction.reason}</p>)}{!doc.reports.length&&!doc.corrections.length&&<p>ยังไม่มีฉบับทางการหรือการแก้ไข</p>}</Section>
   {editor&&<EntryForm key={`${editor.entry?.id??'new'}:${editor.epoch??0}`} document={doc} workers={data.qcWorkers??[]} entry={editor.entry} busy={busy} error={error} onSave={async command=>!!(await mutate(command))} onClose={()=>setEditor(null)} onReload={reload} refreshed={(editor.epoch??0)>0} />}
  </>}
  {preview&&<ReportView report={preview.content} version={preview.version} superseded={preview.superseded} worksheet={preview.worksheet} onClose={()=>setPreview(null)} />}
  {sourceOrder&&<SourceOrder api={api} orderKey={sourceOrder} onClose={()=>setSourceOrder(undefined)} />}
 </div>;
}
