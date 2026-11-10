"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { editorPayload, type EditableView } from "../lib/model";
import {
  labels,
  type Account,
  type Api,
  type EditableRecord,
  type Employee,
  type Records,
  type Role,
} from "../lib/types";
import { Field, SelectField, StatusField } from "./fields";

export type DialogState =
  | { kind: "editor"; view: EditableView; item?: EditableRecord }
  | { kind: "delete"; view: EditableView; item: EditableRecord }
  | { kind: "password" };

export default function Dialog({
  state,
  records,
  permissions,
  api,
  onClose,
  onSaved,
  onPasswordChanged,
}: {
  state: DialogState;
  records: Records;
  permissions: Record<string, string>;
  api: Api;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
  onPasswordChanged: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const title =
    state.kind === "password"
      ? "เปลี่ยนรหัสผ่าน"
      : state.kind === "delete"
        ? "ยืนยันการลบ"
        : `${state.item ? "แก้ไข" : "เพิ่ม"}${state.view === "roles" ? "บทบาท" : labels[state.view]}`;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      if (state.kind === "password") {
        if (form.get("password") !== form.get("confirm"))
          throw new Error("รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน");
        await api("/password", "POST", {
          current: form.get("current"),
          password: form.get("password"),
        });
        onPasswordChanged();
      } else if (state.kind === "delete") {
        await api(`/${state.view}/${state.item.id}`, "DELETE");
        await onSaved("ลบรายการเรียบร้อยแล้ว");
      } else {
        await api(
          `/${state.view}${state.item ? `/${state.item.id}` : ""}`,
          state.item ? "PUT" : "POST",
          editorPayload(state.view, form, Boolean(state.item)),
        );
        await onSaved("บันทึกข้อมูลเรียบร้อยแล้ว");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ไม่สามารถทำรายการได้");
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={ref}
      aria-labelledby="modal-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form onSubmit={submit}>
        <div className="modal-head">
          <div>
            <p className="eyebrow">LTHAI WORKSPACE</p>
            <h2 id="modal-title">{title}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="ปิด"
            onClick={onClose}
            disabled={busy}
          >
            ×
          </button>
        </div>
        <div className="modal-body">
          {state.kind === "password" ? (
            <>
              <Field
                name="current"
                label="รหัสผ่านเดิม"
                type="password"
                required
                autoComplete="current-password"
              />
              <Field
                name="password"
                label="รหัสผ่านใหม่"
                type="password"
                required
                minLength={12}
                autoComplete="new-password"
                placeholder="อย่างน้อย 12 ตัวอักษร"
              />
              <Field
                name="confirm"
                label="ยืนยันรหัสผ่านใหม่"
                type="password"
                required
                minLength={12}
                autoComplete="new-password"
              />
              <p className="helper">เปลี่ยนแล้วต้องเข้าสู่ระบบใหม่ทุกอุปกรณ์</p>
            </>
          ) : state.kind === "delete" ? (
            <>
              <p>
                ต้องการลบ <strong>{state.item.name}</strong> ใช่หรือไม่?
              </p>
              <p className="helper">
                {state.view === "employees"
                  ? "จะเก็บทะเบียนไว้ใน “รายการที่ลบแล้ว” และปิดบัญชีที่เชื่อมโยง เพื่อไม่ให้ข้อมูลอ้างอิงสูญหาย"
                  : state.view === "users"
                    ? "บัญชีนี้จะเข้าสู่ระบบไม่ได้อีก ประวัติการทำรายการยังคงอยู่"
                    : "หากยังมีรายการอ้างอิงอยู่ ระบบจะไม่อนุญาตให้ลบ"}
              </p>
            </>
          ) : (
            <EditorFields
              view={state.view}
              item={state.item}
              records={records}
              permissions={permissions}
            />
          )}
          <p className="form-error" role="alert">
            {error}
          </p>
        </div>
        <div className="modal-foot">
          <button
            type="button"
            className="button secondary"
            onClick={onClose}
            disabled={busy}
          >
            ยกเลิก
          </button>
          <button
            className={`button ${state.kind === "delete" ? "destructive" : "primary"}`}
            disabled={busy}
          >
            {busy
              ? "กำลังดำเนินการ…"
              : state.kind === "delete"
                ? "ยืนยันลบ"
                : state.kind === "password"
                  ? "เปลี่ยนรหัสผ่าน"
                  : "บันทึกข้อมูล"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function EditorFields({
  view,
  item,
  records,
  permissions,
}: {
  view: EditableView;
  item?: EditableRecord;
  records: Records;
  permissions: Record<string, string>;
}) {
  if (view === "employees") {
    const employee = item as Employee | undefined;
    return (
      <>
        <div className="form-grid">
          <Field
            name="code"
            label="รหัสพนักงาน"
            defaultValue={employee?.code}
            required
          />
          <Field
            name="name"
            label="ชื่อ–นามสกุล"
            defaultValue={employee?.name}
            required
          />
          <Field
            name="department"
            label="แผนก"
            defaultValue={employee?.department}
          />
          <SelectField
            name="position_id"
            label="ตำแหน่งงาน"
            value={employee?.position_id}
            options={records.positions}
          />
          <Field
            name="phone"
            label="เบอร์โทร"
            defaultValue={employee?.phone}
            type="tel"
          />
          <Field
            name="social_security_number"
            label="เลขประกันสังคม"
            defaultValue={employee?.social_security_number}
            placeholder="13 หลัก หรือเว้นว่าง"
          />
          <Field
            name="taxpayer_id"
            label="เลขประจำตัวประชาชนผู้เสียภาษีอากร"
            defaultValue={employee?.taxpayer_id}
            placeholder="13 หลัก หรือเว้นว่าง"
          />
        </div>
        <StatusField active={employee?.active} />
        <p className="helper">
          ทะเบียนพนักงานไม่ใช่บัญชีเข้าสู่ระบบ
          สร้างบัญชีแยกได้ที่เมนูบัญชีผู้ใช้
        </p>
      </>
    );
  }
  if (view === "positions")
    return (
      <>
        <Field
          name="name"
          label="ชื่อตำแหน่งงาน"
          defaultValue={item?.name}
          required
        />
        <p className="helper">
          ตำแหน่งบอกหน้าที่ในโรงงาน ไม่ได้กำหนดสิทธิ์การใช้งานโปรแกรม
        </p>
      </>
    );
  if (view === "users") {
    const account = item as Account | undefined;
    const employees = records.employees
      .filter((employee) => !employee.archived)
      .map((employee) => ({
        id: employee.id,
        name: `${employee.code} · ${employee.name}`,
      }));
    if (
      account?.employee_id &&
      !employees.some((employee) => employee.id === account.employee_id)
    )
      employees.push({
        id: account.employee_id,
        name: `พนักงาน #${account.employee_id}`,
      });
    return (
      <>
        <div className="form-grid">
          <Field
            name="username"
            label="ชื่อผู้ใช้"
            defaultValue={account?.username}
            required
            autoComplete="off"
          />
          <Field
            name="name"
            label="ชื่อที่แสดง"
            defaultValue={account?.name}
            required
          />
          <SelectField
            name="role_id"
            label="บทบาทสิทธิ์"
            value={
              account?.role_id ??
              records.roles.find((role) => role.id !== 1)?.id ??
              1
            }
            options={records.roles}
            empty={null}
          />
          <SelectField
            name="employee_id"
            label="เชื่อมโยงกับพนักงาน"
            value={account?.employee_id}
            options={employees}
            empty="ไม่เชื่อมโยง"
          />
          <Field
            name="password"
            label={
              item ? "ตั้งรหัสผ่านใหม่ (เว้นว่างเพื่อใช้เดิม)" : "รหัสผ่าน"
            }
            type="password"
            required={!item}
            minLength={12}
            autoComplete="new-password"
            placeholder="อย่างน้อย 12 ตัวอักษร"
          />
        </div>
        <StatusField active={account?.active} />
        <p className="helper">
          เมื่อปิดบัญชีหรือเปลี่ยนรหัสผ่าน เซสชันเดิมของบัญชีนี้จะสิ้นสุดทันที
        </p>
      </>
    );
  }
  const role = item as Role | undefined;
  return (
    <>
      <Field name="name" label="ชื่อบทบาท" defaultValue={role?.name} required />
      <p className="field-caption">สิทธิ์ที่อนุญาต</p>
      <div className="permission-grid">
        {Object.entries(permissions).map(([permission, label]) => (
          <label className="check-line" key={permission}>
            <input
              type="checkbox"
              name="permissions"
              value={permission}
              defaultChecked={role?.permissions.includes(permission)}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
      <p className="helper">
        เลือกเฉพาะสิทธิ์ที่ต้องใช้ การเปลี่ยนแปลงมีผลกับทุกบัญชีในบทบาทนี้ทันที
      </p>
    </>
  );
}
