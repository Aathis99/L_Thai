"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Api, SessionUser } from '../../lib/types';
import { Field } from '../fields';
import { Card, Choice, Facts, FormDialog, Section } from '../pressing/shared';
import { DefectFields, FireTimeInput, NumberInput, PlanForm, PolicyFields, QcFields, RailFields, TimeInput, readQc } from './forms';
import { type Command, type Data, type Source, atField, fireAtField, dateTime, fieldNumber as n, fieldText as t, grades, operationNames, outcomeNames, qty, selectedGrades } from './types';

type Editor = { title: string; revision: number;catalogVersion?:string; build: (f: FormData) => Command; children: ReactNode };
const tabs = ['ภาพรวม', 'แผนและเตรียม', 'รอบเผาและไฟ', 'QC', 'ซ่อม/เผาซ้ำ', 'รายงาน', 'ประวัติ', 'ตั้งค่า'] as const;
type Tab = typeof tabs[number];
const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);

export default function KilnPrototype({ api, user, initialTab = 'ภาพรวม',qa=true }: { api: Api; user: SessionUser; initialTab?: Tab;qa?:boolean }) {
  const [data, setData] = useState<Data>(), [tab, setTab] = useState<Tab>(initialTab);
  const [editor, setEditor] = useState<Editor>(), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [query, setQuery] = useState(''), [kiln, setKiln] = useState(0);
  const generation = useRef(0);
  const can = (p: string) => user.permissions.includes(p.includes('.') ? p : 'finishing.' + p);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    const next = await api<Data>(qa?'/kiln-qa/state':'/kiln/state');
    if (current === generation.current) setData(next);
    return next;
  }, [api,qa]);
  useEffect(() => {
    const run = () => { void refresh().catch(e => setError(e.message)); };
    run(); window.addEventListener('focus', run);
    return () => { generation.current++; window.removeEventListener('focus', run); };
  }, [refresh]);
  useEffect(() => setTab(initialTab), [initialTab]);
  const open = (title: string, build: Editor['build'], children: ReactNode) => {
    if (!data) return;
    setError(''); setMessage(''); setEditor({ title, build, children, revision: data.revision,catalogVersion:data.catalogVersion });
  };
  const button = (label: string, build: Editor['build'], children: ReactNode, permission = 'fire') => can(permission) ?
    <button className="button secondary" onClick={() => open(label, build, children)}>{label}</button> : null;
  if (!data) return <Section title={qa?'งานเตาจำลอง QA':'งานเตา'}><p role="status">{error || 'กำลังโหลดข้อมูลงานเตา…'}</p></Section>;
  const state = data.state;
  const info = (sourceId: string) => data.sources.find(s => s.sourceId === sourceId)!;
  const matches = (sourceId: string) => { const s = info(sourceId); return !query || `${s.reference} ${s.name} ${s.code} ${s.color}`.toLowerCase().includes(query.toLowerCase()); };
  const rounds = state.rounds.filter(r => !kiln || r.kilnId === kiln);
  const loads = state.rounds.flatMap(r => r.loads.map(l => ({ ...l, round: r })));
  const pending = (loadId: number, pieces: number) => pieces - sum(state.qcs.filter(q => q.loadId === loadId).map(q => sum(Object.values(q.counts))));
  const loadItem = (loadId: number) => info(loads.find(l => l.id === loadId)!.sourceId);
  const name = (s: Source) => `${s.reference} · ${s.name} · ${s.code}`;
  const planForm = (sourceId?: string) => open('วางแผนเข้าเตา', f => ({ op: 'plan', sourceId: t(f, 'sourceId'), kilnId: n(f, 'kilnId'), rail: n(f, 'rail'), date: t(f, 'date'), unit: t(f, 'unit'), input: n(f, 'input'), pieces: n(f, 'pieces'), temperature: n(f, 'temperature') }), <PlanForm data={data} initialSource={sourceId} qa={qa} />);
  const timeAction = (op: string, roundId: number, label: string) => button(label, f => ({ op, roundId, at: fireAtField(f) }), <FireTimeInput />);
  return <div className="kiln-prototype">
    <Section title={qa?'งานเตา · แบบจำลอง QA':'งานเตา · แผนและการผลิต'} action={<button className="button secondary" onClick={() => void refresh().then(() => setError('')).catch(e => setError(e.message))}>โหลดล่าสุด</button>}>
      {qa?<p className="status-banner">พื้นที่ทดลองแยกจากระบบหลัก · ยอดทั้งหมดในหน้านี้เป็นยอดจำลอง ไม่ตัดสต็อกใช้งานจริง</p>:<p>ยืนยันเตรียมลงเบอร์เพื่อกันของจริง ผลคัดและยอดรับสต็อกเชื่อมกับส่วนงานเดิม</p>}
      <p>{qa?'ทดลองขั้นตอนตั้งแต่แผนจนถึง QC และงานซ่อม ข้อมูลเก็บร่วมกันใน QA ให้ผู้มีสิทธิ์ช่วยกันทำต่อได้':'บันทึกงานร่วมกันตั้งแต่แผน เข้าเผา บันทึกไฟ จนถึง QC และงานซ่อม'}</p>
      {message && <p role="status">{message}</p>}{error && <p role="alert" className="error">{error}</p>}
      <div className="pressing-actions">
        {qa&&button('เริ่มชุดตัวอย่างใหม่', () => ({ op: 'demo', confirm: 'RESET-QA' }), <p>แทนที่ยอดทดลองปัจจุบันด้วยงานตัวอย่าง 4 ชุด ประวัติก่อนเปลี่ยนยังเก็บไว้ การทำนี้ไม่มีผลต่อฐานหลัก</p>)}
        {data.sources.length > 0 && can('fire') && <button className="button primary" onClick={() => planForm()}>วางแผนเข้าเตา</button>}
        <small>ข้อมูลฉบับ {data.revision}</small>
      </div>
    </Section>
    <div className="pressing-actions" aria-label="ส่วนงานเตา">{tabs.map(v => <button key={v} aria-pressed={tab === v} className={`button ${tab === v ? 'primary' : 'secondary'}`} onClick={() => setTab(v)}>{v}</button>)}</div>
    <div className="pressing-actions">
      <Field label="ค้นหางานหรือออเดอร์" value={query} onChange={e => setQuery(e.target.value)} />
      <Choice label="กรองเตา" name="filter-kiln" value={kiln} onChange={v => setKiln(Number(v))} options={[{ value: 0, label: 'ทุกเตา' }, ...state.kilns.map(k => ({ value: k.id, label: k.name }))]} />
    </div>
    {tab === 'ภาพรวม' && <>
      {qa?<Section title="วิธีลองงาน">
        <ol><li>เริ่มชุดตัวอย่าง แล้ววางแผนงาน QA-OD-001 ลง 2/1 (50 แผ่น = 1 ตร.ม.)</li>
          <li>ยืนยันเตรียมลงเบอร์ ยืนยันเบอร์พร้อมเข้า แล้วเปิดรอบเผาที่ 1150°C บันทึกไฟ ปิดไฟ นำออก และเอาของลง</li>
          <li>ไป QC แบ่งยอดเป็นเกรดและงานซ่อม จากนั้นยืนยันซ่อมพร้อมและวางแผนกลับเข้าเตา</li>
          <li>ลองกันของเกินยอด หรืองานขอบโค้งที่ 1150°C ระบบต้องแจ้งเงื่อนไขที่ไม่ผ่าน</li></ol>
      </Section>:<Section title="เริ่มงาน"><ol><li>ตรวจใบสั่งผลิตและยอดของพร้อมจากงานชุบหรือใบเบิกบรีส</li><li>กำหนดช่วงอุณหภูมิดิน สี รูปแบบ และเกรดที่รับในแท็บตั้งค่า</li><li>วางแผนแล้วเตรียมลงเบอร์ เมื่อพร้อมจึงยืนยันเข้าเผา</li><li>บันทึกไฟ ปิดไฟ นำออก เอาของลง แล้วส่งต่อ QC และงานซ่อม</li></ol></Section>}
      <Section title="เตาและเบอร์ราง"><div className="pressing-cards">{state.kilns.filter(k => !kiln || k.id === kiln).map(k => <Card key={k.id} title={k.name}>
        {[1, 2].map(rail => {
          const r = state.rounds.find(r => r.kilnId === k.id && r.rail === rail && !r.unloadedAt);
          const reserved = sum(state.reservations.filter(p => p.kilnId === k.id && p.rail === rail && p.status === 'reserved').map(p => p.pieces));
          const ready = state.railsReady.some(v => v.kilnId === k.id && v.rail === rail);
          const stage = r ? (r.withdrawnAt ? 'รอเย็น/เอาของลง' : r.stoppedAt ? 'ปิดไฟ รอนำออก' : 'อยู่ในเตา') : reserved ? ready ? 'พร้อมเข้า' : 'เตรียมของ' : 'ว่าง';
          return <div key={rail} style={{ borderTop: '1px solid var(--color-factory-line)', padding: '10px 0' }}><strong>{k.id}/{rail} · {stage}</strong>
            <p>{r ? `รอบ #${r.id} · ${r.temperature}°C · เข้า ${dateTime(r.startedAt)}` : `กันเตรียม ${qty(reserved)} แผ่น`}</p>
            <div className="pressing-actions"><button className="button secondary" onClick={() => { setKiln(k.id); setTab(r ? 'รอบเผาและไฟ' : 'แผนและเตรียม'); }}>เปิดงานเบอร์นี้</button>
              {!r && reserved > 0 && !ready && button(`ยืนยันพร้อมเข้า ${k.id}/${rail}`, () => ({ op: 'rail-ready', kilnId: k.id, rail }), <p>ยืนยันว่าจัดของเตรียมลงเบอร์นี้เรียบร้อยแล้ว การเพิ่ม/ย้ายของภายหลังต้องยืนยันพร้อมใหม่</p>)}
              {!r && ready && button(`เข้าเผา ${k.id}/${rail}`, f => ({ op: 'start', kilnId: k.id, rail, temperature: n(f, 'temperature'), at: fireAtField(f) }), <><FireTimeInput /><NumberInput name="temperature" label="อุณหภูมิเป้าหมาย (°C)" value={qa?1150:0} min={1} /><p>ระบบตรวจของพร้อม สี ดิน รูปแบบ และเตาว่างก่อนเริ่ม</p></>)}
            </div>
          </div>;
        })}
      </Card>)}</div></Section>
      <Section title={qa?'ยอดทดลองปัจจุบัน':'ยอดปัจจุบัน'}><Summary data={data} /></Section>
    </>}
    {tab === 'แผนและเตรียม' && <>
      <Section title="แผนล่วงหน้า"><div className="pressing-cards">{state.plans.filter(p => (!kiln || p.kilnId === kiln) && matches(p.sourceId)).map(p => {
        const s = info(p.sourceId), used = sum(state.reservations.filter(r => r.planId === p.id && r.status !== 'cancelled').map(r => r.pieces));
        const allPlans = sum(state.plans.filter(v => !v.cancelled && v.sourceId === p.sourceId).map(v => v.pieces));
        return <Card key={p.id} title={`แผน #${p.id} · ${p.kilnId}/${p.rail} · ${p.date}${p.cancelled ? ' · ยกเลิกแล้ว' : ''}`} meta={<span className="badge neutral">{s.code}</span>} actions={!p.cancelled && <>
          {p.pieces > used && button('ยืนยันเตรียมลงเบอร์', f => ({ op: 'reserve', planId: p.id, pieces: n(f, 'pieces') }), <><p>{name(s)}</p><NumberInput name="pieces" label="จำนวนที่เตรียมจริง (แผ่น)" min={1} value={Math.max(1, Math.min(p.pieces - used, s.available))} /><p>พร้อมเหลือ {qty(s.available)} แผ่น การยืนยันนี้กันยอดไม่ให้เบอร์อื่นใช้ซ้ำ</p></>)}
          {button('แก้แผน', f => ({ op: 'plan-edit', planId: p.id, date: t(f, 'date'), pieces: n(f, 'pieces'), temperature: n(f, 'temperature') }), <><Field name="date" label="วันที่แผน" type="date" defaultValue={p.date} required /><NumberInput name="pieces" label="จำนวนแผนที่แก้เป็นแผ่น" min={1} value={p.pieces} /><NumberInput name="temperature" label="อุณหภูมิเป้าหมาย" min={1} value={p.temperature} /><p>พื้นที่คำนวณกลับจากจำนวนแผ่น ยอดเตรียมหรือเข้าเผาที่มีอยู่ต้องไม่เกินแผนที่แก้</p></>, 'correct')}
          {!state.reservations.some(r => r.planId === p.id && r.status === 'loaded') && button('ยกเลิกแผนและคืนของเตรียม', () => ({ op: 'plan-cancel', planId: p.id }), <p>ยกเลิกแผนนี้และคืนของที่กันเตรียมไว้ทั้งหมด โดยเก็บประวัติเดิม</p>)}
        </>}>
          <p>{name(s)}</p><Facts values={{ 'แผน (แผ่น)': qty(p.pieces), 'แผน (ตร.ม.)': s.rate ? qty(p.pieces / s.rate) : 'รอกำหนดอัตรา', 'พร้อมเหลือ': qty(s.available), 'เตรียม/เข้าเผาแล้ว': qty(used), 'อุณหภูมิ': `${p.temperature}°C` }} />
          {allPlans > s.sourceReady && <p>แผนรวม {qty(allPlans)} มากกว่าของพร้อม {qty(s.sourceReady)} แผ่น กรุณาตรวจยอด/แผนซ้ำ</p>}
        </Card>;
      })}</div>{!state.plans.length && <p>ยังไม่มีแผน กด “วางแผนเข้าเตา” เพื่อเริ่ม</p>}</Section>
      <Section title="รายการเตรียมที่กันไว้"><div className="pressing-cards">{state.reservations.filter(r => r.status === 'reserved' && (!kiln || r.kilnId === kiln) && matches(r.sourceId)).map(r => <Card key={r.id} title={`เตรียม #${r.id} · ${r.kilnId}/${r.rail}`} actions={<>
        {button('แบ่ง/ย้ายเบอร์', f => ({ op: 'move', reservationId: r.id, kilnId: n(f, 'kilnId'), rail: n(f, 'rail'), pieces: n(f, 'pieces') }), <><RailFields data={data} kiln={r.kilnId} rail={r.rail === 1 ? 2 : 1} /><NumberInput name="pieces" label="จำนวนย้าย" value={r.pieces} min={1} /></>)}
        {button('ยกเลิกเตรียมและคืนยอด', () => ({ op: 'cancel', reservationId: r.id }), <p>คืน {qty(r.pieces)} แผ่นให้งาน {name(info(r.sourceId))}</p>)}
      </>}><p>{name(info(r.sourceId))}</p><strong>{qty(r.pieces)} แผ่น</strong></Card>)}</div></Section>
    </>}
    {tab === 'รอบเผาและไฟ' && <Section title="รอบเผา"><div className="pressing-cards">{rounds.slice().reverse().map(r => <Card key={r.id} title={`รอบ #${r.id} · ${r.kilnId}/${r.rail} · ${r.temperature}°C`} actions={<>
      {button('บันทึกไฟ', f => ({ op: 'log', roundId: r.id, at: fireAtField(f), temperature: n(f, 'temperature'), cone: t(f, 'cone'), note: t(f, 'note') }), <><FireTimeInput /><NumberInput name="temperature" label="อุณหภูมิจริง (°C)" value={0} /><Field name="cone" label="เบอร์โคน (เช่น 05)" /><Field name="note" label="หมายเหตุ" /></>)}
      {!r.stoppedAt && timeAction('stop', r.id, 'ปิดไฟ')}
      {r.stoppedAt && !r.withdrawnAt && timeAction('withdraw', r.id, 'นำเบอร์ออกจากเตา')}
      {r.withdrawnAt && !r.unloadedAt && timeAction('unload', r.id, 'เอาของลงเสร็จ คืนเบอร์ว่าง')}
      {r.unloadedAt && <button className="button secondary" onClick={() => setTab('QC')}>ไป QC</button>}
    </>}>
      <Facts values={{ 'จุดไฟ': dateTime(r.startedAt), 'ปิดไฟ': dateTime(r.stoppedAt), 'นำออก': dateTime(r.withdrawnAt), 'ลงของเสร็จ': dateTime(r.unloadedAt) }} />
      {r.loads.map(l => <div key={l.id}><p>รายการ #{l.id} · {name(info(l.sourceId))} · เข้าเผาจริง {qty(l.pieces)} · รอคัด {qty(pending(l.id, l.pieces))}</p>
        <small>เกณฑ์ตอนยืนยัน: ดิน {l.criteria.clayRange?.join('–')} · สี {l.criteria.colorRange?.join('–') || 'ไม่ใช้สี'} · รูปแบบ {l.criteria.shapeRange?.join('–')} °C</small>
        {button('แก้ยอดและข้อมูลที่เกี่ยวข้อง', f => ({ op: 'correct', loadId: l.id, pieces: n(f, 'pieces'), note: t(f, 'note'),reason:t(f,'reason'),
          qcs: state.qcs.filter(q => q.loadId === l.id).map(q => ({ id: q.id, ...readQc(f, `q${q.id}_`) })),
          allocations: state.allocations.filter(a => state.qcs.some(q => q.loadId === l.id && q.id === a.qcId)).map(a => ({ id: a.id, pieces: n(f, `a${a.id}`) })),
          repairReady: state.repairReady.filter(x => state.qcs.some(q => q.loadId === l.id && q.id === x.qcId)).map(x => ({ qcId: x.qcId, kind: x.kind, pieces: n(f, `r${x.qcId}_${x.kind}`) })),
        }), <><NumberInput name="pieces" label="ยอดเข้าเผาที่ถูกต้อง" value={l.pieces} />
          {state.qcs.filter(q => q.loadId === l.id).map(q => <fieldset key={q.id}><legend>ผลคัด #{q.id}</legend><QcFields initial={q} prefix={`q${q.id}_`} /></fieldset>)}
          {state.allocations.filter(a => state.qcs.some(q => q.loadId === l.id && q.id === a.qcId)).map(a => <NumberInput key={a.id} name={`a${a.id}`} label={`${a.destination === 'order' ? 'กันให้ออเดอร์' : 'รับสต็อก'} #${a.id} · ${a.grade}`} value={a.pieces} />)}
          {state.repairReady.filter(x => state.qcs.some(q => q.loadId === l.id && q.id === x.qcId)).map(x => <NumberInput key={`${x.qcId}:${x.kind}`} name={`r${x.qcId}_${x.kind}`} label={`ซ่อมพร้อม QC #${x.qcId} · ${outcomeNames[x.kind]}`} value={x.pieces} />)}
          <Field name="reason" label="เหตุผลการแก้ไข" required /><Field name="note" label="หมายเหตุการแก้" /><p>แก้เฉพาะยอดที่ผิด ระบบบันทึกพร้อมกันเมื่อยอดทั้งหมดสอดคล้อง ไม่ปรับ QC/สต็อกแทนเอง</p></>, 'correct')}
      </div>)}
      <TemperaturePlot logs={r.logs} />
      {!r.logs.length && <p>ยังไม่มีบันทึกอุณหภูมิ ช่องที่ขาดไม่ใช่ศูนย์</p>}
      {r.logs.slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).map(l => <p key={l.id}>{dateTime(l.at)} · {l.temperature}°C · โคน {l.cone || '—'} {l.note}
        {button('แก้อุณหภูมิ', f => ({ op: 'correct', logId: l.id, temperature: n(f, 'temperature'), note: t(f, 'note') }), <><NumberInput name="temperature" label="อุณหภูมิที่ถูกต้อง" value={l.temperature} /><Field name="note" label="หมายเหตุ" /></>, 'correct')}
      </p>)}
    </Card>)}</div>{!rounds.length && <p>ยังไม่มีรอบเผา ไปภาพรวมเพื่อเริ่มจากเบอร์ที่เตรียมของไว้</p>}</Section>}
    {tab === 'QC' && <>
      <Section title="คิวรอคัดข้อมูลเดิม"><div className="pressing-cards">{loads.filter(l => (qa||(!data.qcCandidates?.some(c=>c.loads.some(x=>x.id===l.id))&&!state.qcDocuments?.some(d=>d.loads.some(x=>x.id===l.id)))) && l.round.unloadedAt && pending(l.id, l.pieces) > 0 && (!kiln || l.round.kilnId === kiln) && matches(l.sourceId)).map(l => <Card key={l.id} title={`รอบ #${l.round.id} · รายการ #${l.id}`} actions={button('ลงผลคัด QC', f => ({ op: 'qc', loadId: l.id, at: atField(f), ...readQc(f), note: t(f, 'note') }), <><p>{name(info(l.sourceId))} · รอคัด {qty(pending(l.id, l.pieces))} แผ่น</p><TimeInput /><QcFields /><Field name="note" label="หมายเหตุ/อาการรอง" /></>, 'qc')}>
        <p>{name(info(l.sourceId))}</p><Facts values={{ 'เข้าเผาจริง': qty(l.pieces), 'รอคัด': qty(pending(l.id, l.pieces)) }} />
      </Card>)}</div><p>ผลแต่ละกลุ่มไม่ซ้ำแผ่นกัน คัดไม่ครบให้คงยอดที่เหลือเป็นรอคัด</p></Section>
      <Section title="ผลคัดและปลายทาง"><div className="pressing-cards">{state.qcs.filter(q => matches(loads.find(l => l.id === q.loadId)!.sourceId)).slice().reverse().map(q => {
        const s = loadItem(q.loadId);
        return <Card key={q.id} title={`QC #${q.id} · ${s.reference}`} actions={button('จัดสรรออเดอร์/รับสต็อก', f => ({ op: 'allocate', qcId: q.id, grade: t(f, 'grade'), destination: t(f, 'destination'), pieces: n(f, 'pieces'), at: atField(f) }), <><Choice name="grade" label="เกรด" options={grades.filter(g=>g==='A+'||q.counts[g]>0).map(g => ({ value: g, label: g }))} />
          <Choice name="destination" label="ปลายทาง" options={[{ value: 'order', label: 'กันให้ออเดอร์ต้นทาง' }, { value: 'stock', label: 'ยืนยันรับสต็อกแยกเกรด' }]} /><NumberInput name="pieces" label="จำนวนที่ยืนยัน" min={1} value={1} /><TimeInput />
          <p>ออเดอร์นี้รับ: {s.accepted.join(', ') || 'ยังไม่กำหนด'} · สต็อกรับ: {state.stockGrades.join(', ') || 'ยังไม่กำหนด'}</p></>, can('allocate') ? 'allocate' : 'stock')}>
          <p>{name(s)} · {dateTime(q.at)}</p><Facts values={Object.fromEntries(Object.entries(outcomeNames).map(([k, label]) => [label, qty(q.counts[k as keyof typeof q.counts])]))} />
          {q.defects.map(d => <p key={d.name}>{d.name}: {qty(d.pieces)} แผ่น</p>)}{q.note && <p>{q.note}</p>}
          {grades.map(g => <p key={g}>{g} คงรอจัดสรร {qty(q.counts[g] - sum(state.allocations.filter(a => a.qcId === q.id && a.grade === g).map(a => a.pieces)))}</p>)}
        </Card>;
      })}</div></Section>
    </>}
    {tab === 'ซ่อม/เผาซ้ำ' && <Section title="คิวซ่อมและของพร้อมกลับเตา"><div className="pressing-cards">{data.sources.filter(s => s.sourceId.startsWith('repair:') && matches(s.sourceId)).map(s => {
      const [, qcId, kind] = s.sourceId.split(':'), q = state.qcs.find(q => q.id === Number(qcId))!, k = kind as 'underfired' | 'touchup';
      return <Card key={s.sourceId} title={`${s.code} · QC #${qcId} · ${outcomeNames[k]}`} actions={<>
        {button('ยืนยันพร้อมกลับเข้าเตา', f => ({ op: 'repair-ready', qcId: Number(qcId), kind, pieces: n(f, 'pieces') }), <><p>{name(s)}</p><NumberInput name="pieces" label="จำนวนซ่อม/เตรียมเสร็จเพิ่ม" value={Math.max(1, q.counts[k] - s.sourceReady)} min={1} /></>, 'qc')}
        {can('fire') && <button className="button secondary" onClick={() => planForm(s.sourceId)}>วางแผนเผาซ้ำ</button>}
      </>}><p>{name(s)}</p><Facts values={{ 'ผลคัดส่งซ่อม': qty(q.counts[k]), 'ยังรอเตรียม': qty(q.counts[k] - s.sourceReady), 'ยืนยันพร้อมสะสม': qty(s.sourceReady), 'พร้อมยังไม่กัน': qty(s.available), 'กัน/เข้าเผาแล้ว': qty(s.sourceUsed) }} /></Card>;
    })}</div><p>ยืนยันพร้อมบางส่วนได้ งานซ่อมยังอ้างอิงต้นทางเดิมและไม่เพิ่มยอดผลิตใหม่</p></Section>}
    {tab === 'รายงาน' && <>
      <Section title={qa?'ยอดรวมทดลอง':'ยอดรวม'}><Summary data={data} /><p>ยอดผ่านเตารวมการเผาซ้ำ ส่วนยอดผลิตเข้าเผาใหม่ไม่รวมงานซ่อม ยอดพร้อมส่ง/สต็อกนับจากรายการยืนยันเท่านั้น</p></Section>
      <Section title="งานต้นทางและแผน"><div className="pressing-cards">{data.sources.filter(s => matches(s.sourceId)).map(s => <Card key={s.sourceId} title={name(s)}>
        <Facts values={{ 'แผนรวม': qty(sum(state.plans.filter(p => !p.cancelled && p.sourceId === s.sourceId).map(p => p.pieces))), 'พร้อมสะสม': qty(s.sourceReady), 'กัน/เข้าเผา': qty(s.sourceUsed), 'พร้อมเหลือ': qty(s.available), 'ตร.ม. พร้อมเหลือ': s.rate ? qty(s.available / s.rate) : 'รอกำหนดอัตรา' }} />
      </Card>)}</div></Section>
      <Section title="ประวัติพร้อมส่งและรับสต็อกแยกเกรด">{state.allocations.map(a => <p key={a.id}>#{a.id} · {loadItem(state.qcs.find(q => q.id === a.qcId)!.loadId).reference} · {a.destination === 'order' ? 'กันให้ออเดอร์' : 'รับสต็อก'} · {a.grade} · {qty(a.pieces)} แผ่น · {dateTime(a.at)}</p>)}</Section>
    </>}
    {tab === 'ประวัติ' && <Section title="ประวัติการบันทึกและแก้ไข">{data.history.map(h => <Card key={h.id} title={`ฉบับ ${h.revision} · ${operationNames[h.command.op] ?? h.command.op}`}>
      <p>{h.actor} · {dateTime(h.recorded_at)}</p><details><summary>ดูค่าก่อนและหลัง</summary>{h.changes.map((c, i) => <div key={i} style={{ overflowWrap: 'anywhere' }}><strong>{c.field}</strong><p>ก่อน: {c.before}</p><p>หลัง: {c.after}</p></div>)}</details>
    </Card>)}<p>ระบบเก็บค่าก่อนและหลังพร้อมผู้บันทึกทุกครั้ง</p></Section>}
    {tab === 'ตั้งค่า' && <>
      {qa&&<Section title="งานจากสำเนาฐาน QA">{data.copiedItems.map(i => <Card key={i.id} title={`${i.reference} · ${i.name}`} actions={button('เพิ่มลงแบบจำลอง', () => ({ op: 'import', sourceId: i.id }), <p>อ่านงานจากสำเนาฐาน QA แล้วนำมาเป็นต้นทางทดลองแยก ยอดทดลองจะไม่เขียนกลับไปสต็อกของระบบเดิม</p>)}>
        <p>พร้อมตามสำเนา {qty(i.ready)} แผ่น · ต้องกำหนดช่วงรูปแบบและเกรดที่รับก่อนยืนยันใช้</p>
      </Card>)}</Section>}
      <Section title={qa?'ตั้งค่าเงื่อนไขของงานทดลอง':'ตั้งค่าอุณหภูมิและเกรด'}><div className="pressing-cards">{data.sources.filter(s => !s.sourceId.startsWith('repair:')).map(s => <Card key={s.sourceId} title={name(s)} actions={<>
        {button(qa?'ช่วงอุณหภูมิ/ของพร้อม':'ช่วงอุณหภูมิ', f => ({ op: 'settings', sourceId: s.id, ...(qa?{rate:n(f,'rate')}:{}), clayRange: [n(f, 'clayMin'), n(f, 'clayMax')], colorRange: s.color ? [n(f, 'colorMin'), n(f, 'colorMax')] : undefined, shapeRange: [n(f, 'shapeMin'), n(f, 'shapeMax')], ...(qa&&s.synthetic ? { ready: n(f, 'ready') } : {}) }), <>
          {qa&&<NumberInput name="rate" label="อัตราแผ่นต่อ ตร.ม. ในแบบจำลอง" value={s.rate} min={0.001} step={0.001} />}
          {(['clay', 'color', 'shape'] as const).filter(k => k !== 'color' || s.color).map(k => <fieldset key={k}><legend>{({ clay: 'ดิน', color: 'สี', shape: 'รูปแบบ' })[k]}</legend><NumberInput name={k + 'Min'} label="ต่ำสุด (°C)" value={s[`${k}Range`]?.[0] ?? (qa?1000:0)} min={1} /><NumberInput name={k + 'Max'} label="สูงสุด (°C)" value={s[`${k}Range`]?.[1] ?? (qa?1200:0)} min={1} /></fieldset>)}
          {s.synthetic && <NumberInput name="ready" label="ของพร้อมสะสม (เฉพาะข้อมูลสังเคราะห์)" value={s.ready} />}
          <p>{qa?'ค่าที่กรอกใช้เฉพาะแบบจำลอง ต้องใช้ค่าที่หน้างานยืนยันก่อนพัฒนาจริง':'ใช้ค่าที่หน้างานยืนยัน ช่วงดิน สี และรูปแบบใช้ร่วมกับงานที่มีทะเบียนเดียวกัน'}</p>
        </>, 'temperature')}
        {button('เกรดที่รับ', f => ({ op: 'policy', sourceId: s.id, accepted: selectedGrades(f, 'accept_'), stockGrades: selectedGrades(f, 'stock_') }), <PolicyFields source={s} data={data} qa={qa} />, 'pressing.manage')}
      </>}><p>ดิน {s.clayRange?.join('–') || 'ยังไม่กำหนด'} · สี {s.color ? s.colorRange?.join('–') || 'ยังไม่กำหนด' : 'ไม่ใช้สี'} · รูปแบบ {s.shapeRange?.join('–') || 'ยังไม่กำหนด'} °C</p>
        <p>ออเดอร์รับ {s.accepted.join(', ') || 'ยังไม่กำหนด'} · {qa?(s.synthetic ? 'ข้อมูลสังเคราะห์' : 'อ้างอิงสำเนาจริง อ่านยอดต้นทางอย่างเดียว'):'ยอดพร้อมอ่านจากงานชุบและใบเบิกบรีส'}</p>
      </Card>)}</div></Section>
    </>}
    {editor && <FormDialog key="kiln-editor" api={async <T,>(_path: string, method?: string, body?: unknown): Promise<T> => {
      const response = await api<Data>(qa?'/kiln-qa/action':'/kiln/action', method, body); setData(response); return { id: response.revision } as T;
    }} title={editor.title} scope="finishing" path="/action" keyField="request_id" submitLabel={qa?'บันทึกทดลอง':'บันทึก'} build={f => ({ revision: editor.revision,...(!qa?{catalog_version:editor.catalogVersion}:{}), command: editor.build(f) })}
      onClose={() => setEditor(undefined)} onSaved={async () => { setMessage(qa?'บันทึกข้อมูลทดลองแล้ว':'บันทึกข้อมูลแล้ว'); }}
      onStale={async () => {
        await refresh(); setEditor(undefined);
        setError('มีข้อมูลเปลี่ยนระหว่างเปิดฟอร์ม รายการเดิมไม่ได้บันทึก กรุณาตรวจข้อมูลล่าสุดแล้วเปิดฟอร์มใหม่ เพื่อไม่เขียนทับข้อมูลของผู้อื่น');
      }}>
      {editor.children}
    </FormDialog>}
  </div>;
}
function Summary({ data }: { data: Data }) {
  return <Facts values={{ 'แผนรวม': qty(data.summary.planned), 'กันเตรียม': qty(data.summary.reserved), 'เข้าเผาใหม่': qty(data.summary.freshFired), 'ผ่านเตารวมเผาซ้ำ': qty(data.summary.throughput), 'รอคัด QC': qty(data.summary.waitingQc), 'ซ่อมยังไม่เข้าเผา': qty(data.summary.repairWaiting), 'เสีย': qty(data.summary.waste), 'พร้อมส่งยืนยัน': qty(data.summary.orderReady), 'รับสต็อกยืนยัน': qty(data.summary.stock) }} />;
}
function TemperaturePlot({ logs }: { logs: { id: number; at: string; temperature: number }[] }) {
  if (!logs.length) return null;
  const min = Math.min(...logs.map(l => Date.parse(l.at))), span = Math.max(1800000, ...logs.map(l => Date.parse(l.at) - min));
  const maxTemp = Math.max(1300, ...logs.map(l => l.temperature));
  return <figure><svg viewBox="0 0 460 150" role="img" aria-label="จุดอุณหภูมิที่บันทึกจริง ไม่เติมช่วงที่ขาด" style={{ width: '100%', maxWidth: 600 }}>
    <path d="M30 5 V125 H450" fill="none" stroke="currentColor" />
    <text x="0" y="12" fontSize="10">°C</text><text x="0" y="125" fontSize="10">0</text>
    {logs.map(l => <circle key={l.id} cx={35 + (Date.parse(l.at) - min) / span * 405} cy={120 - l.temperature / maxTemp * 110} r="4" fill="currentColor"><title>{dateTime(l.at)} · {l.temperature}°C</title></circle>)}
  </svg><figcaption>แสดงเฉพาะจุดที่บันทึกจริง ช่วงที่ขาดไม่ได้เติมค่า</figcaption></figure>;
}
