import {
  useEffect, useId, useRef, useState, type FormEvent, type ReactNode,
} from "react";
import { createPressingRequestKey } from "../../lib/pressing";
import type { Api } from "../../lib/types";

export interface PressingActions {
  api: Api;
  can: (permission: string) => boolean;
  onSaved: (message: string) => Promise<void>;
}

export function Section({
  title, action, children,
}: { title: string; action?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section className="panel pressing-section" aria-labelledby={id}>
      <div className="panel-toolbar pressing-toolbar">
        <h2 id={id}>{title}</h2>
        {action}
      </div>
      <div className="pressing-section-body">{children}</div>
    </section>
  );
}

export function Card({
  title, meta, children, actions,
}: { title: ReactNode; meta?: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <article className="pressing-card">
      <div className="pressing-card-head">
        <h3>{title}</h3>
        {meta}
      </div>
      {children}
      {actions && <div className="pressing-actions">{actions}</div>}
    </article>
  );
}

export function Facts({ values }: { values: Record<string, ReactNode> }) {
  return (
    <dl className="pressing-facts">
      {Object.entries(values).map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Choice({
  label, name, options, empty, defaultValue, value, onChange,
}: {
  label: string;
  name: string;
  options: { value: string | number; label: string }[];
  empty?: string;
  defaultValue?: string | number;
  value?: string | number;
  onChange?: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select
        name={name}
        defaultValue={value === undefined ? (defaultValue ?? "") : undefined}
        value={value}
        onChange={onChange && ((event) => onChange(event.target.value))}
        required={!empty}
      >
        <option value="" disabled={!empty}>{empty ?? "กรุณาเลือก"}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

export function Check({
  label, name, required, defaultChecked, value,
}: { label: ReactNode; name: string; required?: boolean; defaultChecked?: boolean; value?: number }) {
  return (
    <label className="check-line">
      <input type="checkbox" name={name} required={required} defaultChecked={defaultChecked} value={value} />
      <span>{label}</span>
    </label>
  );
}

function Modal({
  title, onClose, busy, children,
}: { title: string; onClose: () => void; busy?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="pressing-dialog"
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="modal-head">
        <h2 id={id}>{title}</h2>
        <button type="button" className="icon-button" aria-label="ปิด" onClick={onClose} disabled={busy}>×</button>
      </div>
      {children}
    </dialog>
  );
}

type RequestBody = Record<string, unknown>;

export function FormDialog({
  api, title, path, method = "POST", keyField, submitLabel, build, onSaved, onClose, children,
}: {
  api: Api;
  title: string;
  path: string;
  method?: "POST" | "PUT" | "DELETE";
  keyField?: "request_id" | "source_key";
  submitLabel: string;
  build?: (form: FormData, key: string) => RequestBody;
  onSaved: (message: string) => Promise<void>;
  onClose: () => void;
  children: ReactNode;
}) {
  const inFlight = useRef(false);
  const key = useRef("");
  const [pending, setPending] = useState<RequestBody | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || (uncertain && !pending)) return;
    let body: RequestBody;
    try {
      if (keyField === "request_id" && !key.current) key.current = createPressingRequestKey();
      body = pending ?? build?.(new FormData(event.currentTarget), key.current) ?? {};
      if (keyField === "request_id") body.request_id = key.current;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "กรุณาตรวจข้อมูลที่กรอก");
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ id: number }>(`/pressing${path}`, method, body);
      if (!Number.isInteger(result?.id)) throw new Error("รูปแบบคำตอบไม่ถูกต้อง");
    } catch (cause) {
      const status = (cause as { status?: number } | null)?.status;
      const unknown = status === undefined || status === 408 || status >= 500;
      setUncertain(unknown);
      setPending(unknown && keyField ? body : null);
      if (!unknown && pending) key.current = "";
      setError(
        unknown
          ? keyField
            ? "ยังไม่ทราบผลการบันทึก ลองส่งข้อมูลเดิมอีกครั้งเมื่อเชื่อมต่อได้"
            : "ยังไม่ทราบผลการบันทึก ปิดหน้าต่างแล้วโหลดรายการใหม่เพื่อตรวจสอบ"
          : cause instanceof Error ? cause.message : "ไม่สามารถทำรายการได้",
      );
      inFlight.current = false;
      setBusy(false);
      return;
    }
    onClose();
    await onSaved("บันทึกข้อมูลเรียบร้อยแล้ว");
  }

  return (
    <Modal title={title} onClose={onClose} busy={busy}>
      <form onSubmit={(event) => void submit(event)}>
        <div className="modal-body">
          {error && <p className="error-banner" role="alert">{error}</p>}
          <fieldset className="pressing-fieldset" disabled={busy || uncertain}>{children}</fieldset>
        </div>
        <div className="modal-foot">
          <button type="button" className="button secondary" disabled={busy} onClick={onClose}>
            {uncertain ? "ปิด" : "ยกเลิก"}
          </button>
          <button type="submit" className="button primary" disabled={busy || (uncertain && !pending)}>
            {busy ? "กำลังบันทึก…" : pending ? "ลองส่งอีกครั้ง" : submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function HistoryDialog<T extends { id: number }>({
  api, title, path, onClose, render,
}: {
  api: Api; title: string; path: string; onClose: () => void; render: (item: T) => ReactNode;
}) {
  const [items, setItems] = useState<T[] | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void api<{ items: T[] }>(`/pressing${path}`).then(
      (result) => { if (active) setItems(result.items); },
      () => { if (active) setError("โหลดประวัติไม่สำเร็จ"); },
    );
    return () => { active = false; };
  }, [api, path, attempt]);
  return (
    <Modal title={title} onClose={onClose}>
      <div className="modal-body">
        {error ? (
          <div className="error-banner" role="alert">
            {error}
            <button className="quiet" onClick={() => {
              setError("");
              setAttempt((current) => current + 1);
            }}>ลองใหม่</button>
          </div>
        ) : items === null ? (
          <p role="status">กำลังโหลดประวัติ…</p>
        ) : items.length ? (
          <div className="pressing-stack">
            {items.map((item) => <div key={item.id}>{render(item)}</div>)}
          </div>
        ) : (
          <p>ยังไม่มีประวัติ</p>
        )}
      </div>
      <div className="modal-foot">
        <button className="button secondary" onClick={onClose}>ปิดประวัติ</button>
      </div>
    </Modal>
  );
}
