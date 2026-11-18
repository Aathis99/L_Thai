import type { InputHTMLAttributes } from "react";

export function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark" aria-hidden="true">
        L
      </span>
      <div>
        LTHAI<span>FACTORY MANAGEMENT</span>
      </div>
    </div>
  );
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> & { label: string };
export function Field({
  label,
  required,
  type = "text",
  ...props
}: FieldProps) {
  return (
    <label className="field">
      <span>
        {label}
        {required && <b> *</b>}
      </span>
      <input
        type={type}
        required={required}
        maxLength={type === "password" ? 128 : 120}
        {...props}
      />
    </label>
  );
}

export function DigitField({
  name,
  label,
  defaultValue,
  digits,
}: Pick<FieldProps, "name" | "label" | "defaultValue"> & { digits: number }) {
  return (
    <Field
      name={name}
      label={label}
      defaultValue={defaultValue}
      inputMode="numeric"
      maxLength={digits}
      pattern={`[0-9]{${digits}}`}
      title={`กรอกตัวเลข ${digits} หลัก หรือเว้นว่าง`}
      placeholder={`${digits} หลัก หรือเว้นว่าง`}
      onInput={(event) => {
        const input = event.currentTarget;
        const caret = input.selectionStart ?? input.value.length;
        const position = input.value.slice(0, caret).replace(/[^0-9]/g, "").length;
        input.value = input.value.replace(/[^0-9]/g, "").slice(0, digits);
        input.setSelectionRange(position, position);
      }}
      onPaste={(event) => {
        event.preventDefault();
        const input = event.currentTarget;
        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? start;
        const available = Math.max(0, digits - (input.value.length - (end - start)));
        const pastedDigits = event.clipboardData.getData("text").replace(/[^0-9]/g, "").slice(0, available);
        input.setRangeText(pastedDigits, start, end, "end");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }}
    />
  );
}

export function SelectField({
  name,
  label,
  value,
  options,
  empty = "ไม่ระบุ",
}: {
  name: string;
  label: string;
  value?: number | null;
  options: { id: number; name: string }[];
  empty?: string | null;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select name={name} defaultValue={value ?? ""} required={empty === null}>
        {empty !== null && <option value="">{empty}</option>}
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function StatusField({ active = 1 }: { active?: number }) {
  return (
    <label className="check-line">
      <input name="active" type="checkbox" defaultChecked={Boolean(active)} />
      <span>เปิดใช้งาน</span>
    </label>
  );
}

export function Badge({
  active,
  archived = 0,
}: {
  active: number;
  archived?: number;
}) {
  return (
    <span
      className={`badge ${archived ? "neutral" : active ? "good" : "muted-badge"}`}
    >
      <i />
      {archived ? "ลบแล้ว" : active ? "เปิดใช้งาน" : "ปิดใช้งาน"}
    </span>
  );
}
