import { useState } from 'react';
import { Field } from '../fields';
import { Choice, Check } from '../pressing/shared';
import { type Data, type Source, type Qc, grades, outcomeNames, qty, day, nowLocal, fieldNumber, fieldText } from './types';

export function NumberInput({ name, label, value = 0, min = 0, step = 1 }: { name: string; label: string; value?: number; min?: number; step?: number }) {
  return <Field name={name} label={label} type="number" min={min} step={step} defaultValue={value} required />;
}
export function TimeInput({ value = nowLocal() }: { value?: string }) { return <Field name="at" label="วันเวลาที่เกิดจริง (เวลาไทย)" type="datetime-local" defaultValue={value} required />; }
export function FireTimeInput({ value = nowLocal() }: { value?: string }) {
  const [date, setDate] = useState(value.slice(0, 10));
  const [hour, setHour] = useState(value.slice(11, 13));
  const [minute, setMinute] = useState(value.slice(14, 16));
  const timeOptions = (length: number) => Array.from({ length }, (_, index) => {
    const text = String(index).padStart(2, '0');
    return { value: text, label: text };
  });
  return <fieldset className="kiln-time-input">
    <legend>วันเวลาที่เกิดจริง (เวลาไทย)</legend>
    <Field name="at_date" label="วันที่" type="date" value={date} onChange={event => setDate(event.target.value)} required />
    <div className="kiln-clock-fields">
      <Choice name="at_hour" label="ชั่วโมง (00–23)" value={hour} onChange={setHour} options={timeOptions(24)} />
      <Choice name="at_minute" label="นาที (00–59)" value={minute} onChange={setMinute} options={timeOptions(60)} />
    </div>
    <button type="button" className="button secondary" onClick={() => {
      const current = nowLocal();
      setDate(current.slice(0, 10)); setHour(current.slice(11, 13)); setMinute(current.slice(14, 16));
    }}>ใช้เวลาปัจจุบัน</button>
    <p className="helper">รูปแบบ 24 ชั่วโมง เช่น 13:30 น.</p>
  </fieldset>;
}
export function PlanForm({ data, initialSource,qa=true }: { data: Data; initialSource?: string;qa?:boolean }) {
  const [sourceId, setSource] = useState(initialSource ?? data.sources[0]?.sourceId ?? '');
  const [unit, setUnit] = useState('pieces'), [input, setInput] = useState('100');
  const source = data.sources.find(s => s.sourceId === sourceId);
  const converted = unit === 'sqm' ? Number(input) * (source?.rate ?? 0) : Number(input);
  return <>
    <Choice name="sourceId" label="งานต้นทาง" value={sourceId} onChange={setSource} options={data.sources.map(s => ({ value: s.sourceId, label: `${s.reference} · ${s.name} · ${s.code} · พร้อมเหลือ ${qty(s.available)}` }))} />
    <RailFields data={data} />
    <Field name="date" label="วันที่ตั้งใจเข้าเผา" type="date" defaultValue={day()} required />
    <Choice name="unit" label="หน่วยกรอกแผน" value={unit} onChange={setUnit} options={[{ value: 'pieces', label: 'แผ่น' }, { value: 'sqm', label: 'ตร.ม.' }]} />
    <Field name="input" label="ปริมาณที่ต้องการ" type="number" min="0.001" step="any" value={input} onChange={e => setInput(e.target.value)} required />
    <p>คำนวณได้ {qty(converted)} แผ่น · อัตรา {qty(source?.rate ?? 0)} แผ่น/ตร.ม. · ของพร้อมจริง {qty(source?.available ?? 0)} แผ่น</p>
    <NumberInput key={`${sourceId}:${unit}:${input}`} name="pieces" label="ยืนยันจำนวนแผ่นเต็มในแผน" min={1} value={Math.ceil(converted)} />
    <NumberInput name="temperature" label="อุณหภูมิเป้าหมาย (°C)" value={qa?1150:0} min={1} />
    <p>แผนยังไม่กันของจริง หากมีแผนซ้ำหรือยังไม่พร้อมจะแสดงให้ตรวจอีกครั้ง</p>
  </>;
}
export function RailFields({ data, kiln = 2, rail = 1 }: { data: Data; kiln?: number; rail?: number }) {
  return <><Choice name="kilnId" label="เตา" defaultValue={kiln} options={data.state.kilns.map(k => ({ value: k.id, label: k.name }))} />
    <Choice name="rail" label="เบอร์ราง" defaultValue={rail} options={[1, 2].map(r => ({ value: r, label: `เบอร์ ${r}` }))} /></>;
}
export function DefectFields({ prefix = '', initial = [] }: { prefix?: string; initial?: Qc['defects'] }) {
  const [rows, setRows] = useState(initial.length || 0);
  return <fieldset><legend>อาการเสียหลัก เฉพาะที่พบ</legend>
    {Array.from({ length: rows }, (_, i) => <div className="pressing-actions" key={i}>
      <Field name={`${prefix}defect_name_${i}`} label={`อาการ ${i + 1}`} defaultValue={initial[i]?.name ?? ''} list={`${prefix}kiln-defects`} />
      <Field name={`${prefix}defect_pieces_${i}`} label="จำนวนแผ่น" type="number" min={0} step={1} defaultValue={initial[i]?.pieces ?? 0} />
    </div>)}
    <button type="button" className="button secondary" onClick={() => setRows(n => n + 1)}>เพิ่มอาการที่พบ</button>
    <datalist id={`${prefix}kiln-defects`}>{['ร้าว', 'หัก', 'งอ', 'ฟอง', 'รู', 'เคลือบไหล', 'สีเพี้ยน', 'หน้าเป็นรอย'].map(n => <option key={n} value={n} />)}</datalist>
    <p>จำนวนอาการหลักรวมต้องตรงยอดเสีย หนึ่งแผ่นนับหลักหนึ่งอาการ อื่น ๆ ใส่หมายเหตุ</p>
  </fieldset>;
}
export function QcFields({ initial, prefix = '' }: { initial?: Qc; prefix?: string }) {
  return <><div className="pressing-cards">{Object.entries(outcomeNames).filter(([key])=>!['A-','B'].includes(key)||(initial?.counts[key as keyof Qc['counts']]??0)>0).map(([key, label]) => <NumberInput key={key} name={prefix + key} label={label + (['A-','B'].includes(key)?' (ข้อมูลเดิม)':'') + ' (แผ่น)'} value={initial?.counts[key as keyof Qc['counts']] ?? 0} />)}</div>
    <DefectFields prefix={prefix} initial={initial?.defects} /></>;
}
export function readQc(f: FormData, prefix = '') {
  const counts = Object.fromEntries(Object.keys(outcomeNames).map(k => [k, fieldNumber(f, prefix + k)]));
  const defects = [...f.keys()].filter(k => k.startsWith(prefix + 'defect_name_')).map(k => {
    const index = k.slice((prefix + 'defect_name_').length);
    return { name: fieldText(f, k), pieces: fieldNumber(f, prefix + 'defect_pieces_' + index) };
  }).filter(d => d.name || d.pieces);
  return { counts, defects };
}
export function PolicyFields({ source, data,qa=true }: { source: Source; data: Data;qa?:boolean }) {
  return <><p>{qa?'กำหนดให้ชัดตามงานทดลองนี้ ไม่ใช่นโยบายเกรดของโรงงานโดยอัตโนมัติ':'ยืนยันเกรดที่ออเดอร์นี้ยอมรับ และเกรดที่โรงงานรับเข้าสต็อก การเปลี่ยนเกรดสต็อกใช้ร่วมกันทุกงาน'}</p>
    <fieldset><legend>ออเดอร์นี้ยอมรับเกรด</legend>{grades.filter(g=>qa||g==='A+').map(g => <Check key={g} name={'accept_' + g} label={g} defaultChecked={source.accepted.includes(g)} />)}</fieldset>
    <fieldset><legend>เกรดที่ยืนยันรับสต็อกได้</legend>{grades.filter(g=>qa||g==='A+').map(g => <Check key={g} name={'stock_' + g} label={g} defaultChecked={data.state.stockGrades.includes(g)} />)}</fieldset></>;
}
