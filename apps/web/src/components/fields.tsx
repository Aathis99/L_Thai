import type { InputHTMLAttributes } from 'react';

export function Brand() {
  return <div className="brand"><span className="brand-mark" aria-hidden="true">L</span><div>LTHAI<span>FACTORY MANAGEMENT</span></div></div>;
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> & { label: string };
export function Field({ label, required, type = 'text', ...props }: FieldProps) {
  return <label className="field"><span>{label}{required && <b> *</b>}</span><input type={type} required={required} maxLength={type === 'password' ? 128 : 120} {...props} /></label>;
}

export function SelectField({ name, label, value, options, empty = 'ไม่ระบุ' }: {
  name: string; label: string; value?: number | null; options: { id: number; name: string }[]; empty?: string | null;
}) {
  return <label className="field"><span>{label}</span><select name={name} defaultValue={value ?? ''} required={empty === null}>
    {empty !== null && <option value="">{empty}</option>}
    {options.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
  </select></label>;
}

export function StatusField({ active = 1 }: { active?: number }) {
  return <label className="check-line"><input name="active" type="checkbox" defaultChecked={Boolean(active)} /><span>เปิดใช้งาน</span></label>;
}

export function Badge({ active, archived = 0 }: { active: number; archived?: number }) {
  return <span className={`badge ${archived ? 'neutral' : active ? 'good' : 'muted-badge'}`}><i />{archived ? 'ลบแล้ว' : active ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}</span>;
}
