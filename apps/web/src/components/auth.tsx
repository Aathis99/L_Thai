"use client";

import { useState, type FormEvent } from "react";
import { Brand, Field } from "./fields";
import type { Api } from "../lib/types";

export default function Auth({
  setup,
  api,
  onLogin,
}: {
  setup: boolean;
  api: Api;
  onLogin: (created: boolean) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    setError("");
    if (setup && data.password !== data.confirm) {
      setError("รหัสผ่านทั้งสองช่องไม่ตรงกัน");
      return;
    }
    setBusy(true);
    try {
      if (setup)
        await api("/setup", "POST", {
          name: data.name,
          username: data.username,
          password: data.password,
        });
      await api("/login", "POST", {
        username: data.username,
        password: data.password,
      });
      await onLogin(setup);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "ไม่สามารถเข้าสู่ระบบได้",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth">
      <section className="auth-story">
        <Brand />
        <div className="story-copy">
          <p className="eyebrow">ระบบจัดการโรงงานกระเบื้อง</p>
          <h1>
            ทุกคน ทุกขั้นตอน
            <br />
            เชื่อมงานไว้ที่เดียว
          </h1>
          <p>
            วางรากฐานข้อมูลพนักงานและสิทธิ์การทำงาน
            <br />
            เพื่อเติบโตไปพร้อมกับโรงงานของคุณ
          </p>
          <div className="tile-art" aria-hidden="true">
            {Array.from({ length: 6 }, (_, i) => (
              <i key={i} />
            ))}
          </div>
        </div>
        <div className="story-foot">
          <span className="dot" /> LThai Factory{" "}
          <span>ระบบภายใน · ระยะที่ 1</span>
        </div>
      </section>
      <section className="auth-form">
        <div className="login-box w-full max-w-[360px]">
          <span className="section-tag">PEOPLE &amp; ACCESS</span>
          <h2>{setup ? "เริ่มต้นระบบของคุณ" : "ยินดีต้อนรับกลับ"}</h2>
          <p className="text-factory-muted">
            {setup
              ? "สร้างบัญชีผู้ดูแลคนแรก เพื่อเริ่มจัดการข้อมูลโรงงาน"
              : "เข้าสู่ระบบเพื่อจัดการข้อมูลและทำงานต่อ"}
          </p>
          <form onSubmit={submit}>
            {setup && (
              <Field
                name="name"
                label="ชื่อผู้ดูแล"
                required
                autoComplete="name"
              />
            )}
            <Field
              name="username"
              label="ชื่อผู้ใช้"
              required
              autoComplete="username"
              placeholder="เช่น admin หรือรหัสพนักงาน"
            />
            <Field
              name="password"
              label="รหัสผ่าน"
              type="password"
              required
              minLength={setup ? 12 : undefined}
              autoComplete={setup ? "new-password" : "current-password"}
              placeholder={
                setup ? "อย่างน้อย 12 ตัวอักษร" : "กรอกรหัสผ่านของคุณ"
              }
            />
            {setup && (
              <Field
                name="confirm"
                label="ยืนยันรหัสผ่าน"
                type="password"
                required
                minLength={12}
                autoComplete="new-password"
              />
            )}
            <p className="form-error" role="alert">
              {error}
            </p>
            <button className="button primary w-full justify-between" disabled={busy}>
              {busy
                ? "กำลังดำเนินการ…"
                : setup
                  ? "สร้างผู้ดูแลและเริ่มใช้งาน"
                  : "เข้าสู่ระบบ"}
              <span aria-hidden="true">→</span>
            </button>
          </form>
          <div className="auth-note">
            {setup
              ? "คุณเป็นผู้ตั้งรหัสผ่านเอง ระบบไม่มีรหัสผ่านเริ่มต้น"
              : "หากลืมรหัสผ่าน ให้ติดต่อผู้ดูแลระบบของโรงงาน"}
          </div>
        </div>
        <div className="auth-version">
          LThai Workspace <span>เวอร์ชัน 0.1</span>
        </div>
      </section>
    </main>
  );
}
