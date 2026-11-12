"use client";

import { useCallback, useEffect, useState } from "react";
import Auth from "./auth";
import ColorChartPanel from "./color-chart/panel";
import Dialog, { type DialogState } from "./dialog";
import { Brand } from "./fields";
import PressingPanel from "./pressing/panel";
import RecordTable from "./record-table";
import { canOpenColorChart } from "../lib/color-chart";
import { canOpenPressing } from "../lib/pressing";
import {
  allowed,
  emptyRecords,
  labels,
  subtitles,
  symbols,
  views,
  type Api,
  type Records,
  type SessionUser,
  type View,
} from "../lib/types";

type WorkspaceView = View | "pressing" | "color-chart";
const workspaceViews: WorkspaceView[] = [...views, "pressing", "color-chart"];

function canOpenView(user: SessionUser, view: WorkspaceView) {
  if (view === "pressing") return canOpenPressing(user.permissions);
  if (view === "color-chart") return canOpenColorChart(user.permissions);
  return allowed(user, view);
}

function workspaceLabel(view: WorkspaceView | null) {
  if (view === "pressing") return "งานปั๊ม";
  if (view === "color-chart") return "ชาร์ตสี";
  return view ? labels[view] : "พื้นที่ทำงาน";
}

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export default function Workspace() {
  const [mode, setMode] = useState<"loading" | "auth" | "workspace" | "error">(
    "loading",
  );
  const [setup, setSetup] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [permissions, setPermissions] = useState<Record<string, string>>({});
  const [records, setRecords] = useState<Records>(emptyRecords);
  const [view, setView] = useState<WorkspaceView | null>("employees");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("current");
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const clearSession = useCallback(() => {
    setUser(null);
    setRecords(emptyRecords());
    setPermissions({});
    setDialog(null);
    setSetup(false);
    setMode("auth");
  }, []);

  const api: Api = useCallback(
    async <T,>(path: string, method = "GET", data?: unknown): Promise<T> => {
      const file = data instanceof File ? data : undefined;
      const response = await fetch(`/api${path}`, {
        method,
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": file ? file.type || "application/octet-stream" : "application/json" },
        body: file ?? (data === undefined ? undefined : JSON.stringify(data)),
      });
      const body = await response
        .json()
        .catch(() => ({ error: "เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง กรุณาลองใหม่" }));
      if (!response.ok) {
        if (response.status === 401) clearSession();
        throw new ApiError(
          body.error || "ไม่สามารถทำรายการได้",
          response.status,
        );
      }
      return body as T;
    },
    [clearSession],
  );

  const refresh = useCallback(async () => {
    const me = await api<{
      user: SessionUser;
      permissions: Record<string, string>;
    }>("/me");
    // Refresh identity before selecting endpoints: role edits apply to this session immediately.
    setUser(me.user);
    setPermissions(me.permissions);
    setView((previous) =>
      previous && canOpenView(me.user, previous)
        ? previous
        : (workspaceViews.find((candidate) => canOpenView(me.user, candidate)) ?? null),
    );
    const can = (permission: string) =>
      me.user.permissions.includes(permission);
    const next = emptyRecords();
    const endpoints: (keyof Records)[] = [];
    if (can("employees.read")) endpoints.push("employees");
    if (can("employees.read") || can("positions.manage"))
      endpoints.push("positions");
    if (can("users.manage")) endpoints.push("users");
    if (can("users.manage") || can("roles.manage")) endpoints.push("roles");
    if (can("audit.read")) endpoints.push("audit");
    await Promise.all(
      endpoints.map(async (key) => {
        const result = await api<{ items: Records[typeof key] }>(`/${key}`);
        // Each endpoint has its corresponding array; keep the mapping in one place.
        Object.assign(next, { [key]: result.items });
      }),
    );
    setRecords(next);
    setError("");
    setMode("workspace");
  }, [api]);

  const boot = useCallback(async () => {
    setMode("loading");
    setError("");
    try {
      const result = await api<{ required: boolean }>("/setup");
      setSetup(result.required);
      if (result.required) {
        setMode("auth");
        return;
      }
      await refresh();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) return;
      setError(cause instanceof Error ? cause.message : "ไม่สามารถเปิดระบบได้");
      setMode("error");
    }
  }, [api, refresh]);

  useEffect(() => {
    void boot();
  }, [boot]);
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), 4500);
    return () => window.clearTimeout(timer);
  }, [message]);
  useEffect(() => {
    if (mode !== "workspace") return;
    const onFocus = () => {
      void refresh().catch((cause) => {
        if (!(cause instanceof ApiError && cause.status === 401))
          setError(
            cause instanceof Error ? cause.message : "โหลดข้อมูลไม่สำเร็จ",
          );
      });
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [mode, refresh]);

  async function navigate(next: WorkspaceView) {
    setView(next);
    setQuery("");
    setFilter("current");
    setDialog(null);
    try {
      await refresh();
    } catch (cause) {
      if (!(cause instanceof ApiError && cause.status === 401))
        setError(
          cause instanceof Error ? cause.message : "โหลดข้อมูลไม่สำเร็จ",
        );
    }
  }
  async function logout() {
    try {
      await api("/logout", "POST", {});
      clearSession();
      setQuery("");
      setFilter("current");
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "ออกจากระบบไม่สำเร็จ",
      );
    }
  }
  async function saved(text: string) {
    // The write has succeeded; close its form before refreshing so a read failure cannot resubmit it.
    setDialog(null);
    setMessage(text);
    try {
      await refresh();
    } catch (cause) {
      if (!(cause instanceof ApiError && cause.status === 401))
        setError(
          cause instanceof Error
            ? cause.message
            : "บันทึกแล้ว แต่โหลดรายการใหม่ไม่สำเร็จ",
        );
    }
  }
  const toast = (
    <div id="toast" role="status" className={message ? "visible" : ""}>
      {message}
    </div>
  );
  if (mode === "loading")
    return (
      <main className="loading flex min-h-dvh items-center justify-center flex-col">
        <Brand />
        <p className="text-factory-muted" role="status">
          กำลังเปิดพื้นที่ทำงาน…
        </p>
      </main>
    );
  if (mode === "error")
    return (
      <main className="loading flex min-h-dvh items-center justify-center flex-col">
        <h1>เปิดระบบไม่สำเร็จ</h1>
        <p role="alert">{error}</p>
        <button className="button secondary" onClick={() => void boot()}>
          ลองใหม่
        </button>
      </main>
    );
  if (mode === "auth" || !user)
    return (
      <>
        <Auth
          setup={setup}
          api={api}
          onLogin={async (created) => {
            await refresh();
            if (created)
              setMessage(
                "สร้างผู้ดูแลระบบแล้ว เริ่มเพิ่มตำแหน่งและพนักงานได้เลย",
              );
          }}
        />
        {toast}
      </>
    );
  const can = (permission: string) => user.permissions.includes(permission);
  const showPressing = canOpenPressing(user.permissions);
  const showColorChart = canOpenColorChart(user.permissions);
  const showFactoryNav = showPressing || showColorChart;
  const recordView = view === "pressing" || view === "color-chart" ? null : view;
  const current = records.employees.filter((employee) => !employee.archived);
  const active = current.filter((employee) => employee.active);
  const create = () => {
    if (recordView && recordView !== "audit")
      setDialog({ kind: "editor", view: recordView });
  };
  return (
    <>
      <div className="min-h-dvh">
        <aside className="sidebar">
          <Brand />
          <div className="workspace-label">พื้นที่ทำงานของโรงงาน</div>
          <div className="factory-label">
            <span className="factory-icon" aria-hidden="true">
              ▧
            </span>
            <div>
              โรงงานกระเบื้อง<small>จัดการข้อมูลพื้นฐาน</small>
            </div>
            <span className="live-dot" />
          </div>
          <div className="nav-title">
            {showFactoryNav ? "เมนูโรงงาน" : "บุคลากรและการเข้าถึง"}
          </div>
          <nav
            aria-label="เมนูหลัก"
            className={showFactoryNav ? "nav-has-factory" : undefined}
          >
            {workspaceViews
              .filter((candidate) => canOpenView(user, candidate))
              .map((candidate) => (
                <button
                  key={candidate}
                  onClick={() => void navigate(candidate)}
                  className={`nav-item ${view === candidate ? "selected" : ""}`}
                  aria-current={view === candidate ? "page" : undefined}
                  aria-label={candidate === "pressing" ? "งานปั๊ม" : undefined}
                >
                  <span aria-hidden="true">
                    {candidate === "pressing" ? "▧" : candidate === "color-chart" ? "◈" : symbols[candidate]}
                  </span>
                  {workspaceLabel(candidate)}
                  {candidate === "employees" && <small>{current.length}</small>}
                </button>
              ))}
          </nav>
          {!showFactoryNav && (
            <div className="roadmap">
              <span>พัฒนาทีละส่วน</span>
              <strong>เริ่มจากคน พร้อมต่อยอดงาน</strong>
              <p>
                ออเดอร์และกระบวนการผลิต
                <br />
                อยู่ระหว่างเก็บข้อมูลหน้างาน
              </p>
              <div className="roadmap-line">
                <i />
              </div>
              <small>ระยะ 1 · พนักงานและสิทธิ์</small>
            </div>
          )}
          <div className="sidebar-foot">
            <span className="avatar" aria-hidden="true">
              {user.name.slice(0, 1)}
            </span>
            <div>
              <strong>{user.name}</strong>
              <small>{user.role_name}</small>
            </div>
            <button
              className="icon-button"
              onClick={() => void logout()}
              title="ออกจากระบบ"
              aria-label="ออกจากระบบ"
            >
              ↪
            </button>
          </div>
        </aside>
        <div className="main-wrap">
          <header className="topbar">
            <div>
              <span className="breadcrumb">โรงงานกระเบื้อง</span>
              <span className="slash">/</span>
              {workspaceLabel(view)}
            </div>
            <div className="topbar-right">
              <span className="local-label">
                <i /> ระบบภายใน
              </span>
              <button
                className="quiet"
                onClick={() => setDialog({ kind: "password" })}
              >
                เปลี่ยนรหัสผ่าน
              </button>
              <button
                className="quiet mobile-logout"
                onClick={() => void logout()}
              >
                ออกจากระบบ
              </button>
            </div>
          </header>
          <main className="main">
            <div className="page-head">
              <div>
                {(recordView || !view) && <p className="eyebrow">PEOPLE &amp; ACCESS</p>}
                <h1>{workspaceLabel(view)}</h1>
                <p>
                  {view === "pressing"
                    ? "ใบสั่งผลิต ยอดปั๊ม สต็อก และผลคัดหลังเผา"
                    : view === "color-chart"
                      ? "ทะเบียนชื่อสีกระเบื้อง ภาพตัวอย่าง และหมายเหตุ"
                      : view
                        ? subtitles[view]
                        : "บัญชีนี้ยังไม่ได้รับสิทธิ์เข้าถึงเมนู กรุณาติดต่อผู้ดูแลระบบ"}
                </p>
              </div>
              {recordView &&
                recordView !== "audit" &&
                (recordView === "employees"
                  ? can("employees.create")
                  : can(`${recordView}.manage`)) && (
                  <button className="button primary" onClick={create}>
                    <span aria-hidden="true">＋</span> เพิ่ม
                    {recordView === "roles" ? "บทบาท" : labels[recordView]}
                  </button>
                )}
            </div>
            {error && (
              <div className="error-banner" role="alert">
                {error}
                <button
                  className="quiet"
                  onClick={() =>
                    void refresh().catch((cause) =>
                      setError(
                        cause instanceof Error
                          ? cause.message
                          : "โหลดข้อมูลไม่สำเร็จ",
                      ),
                    )
                  }
                >
                  ลองใหม่
                </button>
              </div>
            )}
            {view === "employees" && (
              <section className="stats" aria-label="ภาพรวมพนักงาน">
                <article>
                  <span className="stat-icon sand" aria-hidden="true">
                    ♙
                  </span>
                  <div>
                    <span>พนักงานทั้งหมด</span>
                    <strong>
                      {current.length}
                      <small>คน</small>
                    </strong>
                  </div>
                  <i>ข้อมูลปัจจุบัน</i>
                </article>
                <article>
                  <span className="stat-icon mint" aria-hidden="true">
                    ✓
                  </span>
                  <div>
                    <span>กำลังปฏิบัติงาน</span>
                    <strong>
                      {active.length}
                      <small>คน</small>
                    </strong>
                  </div>
                  <i>เปิดใช้งาน</i>
                </article>
                <article>
                  <span className="stat-icon clay" aria-hidden="true">
                    ▤
                  </span>
                  <div>
                    <span>ตำแหน่งงาน</span>
                    <strong>
                      {records.positions.length}
                      <small>ตำแหน่ง</small>
                    </strong>
                  </div>
                  <i>ตำแหน่งในโรงงาน</i>
                </article>
              </section>
            )}
            {view === "users" && (
              <div className="info-banner">
                บัญชีผู้ใช้สำหรับเข้าสู่ระบบ แยกจากทะเบียนพนักงาน —
                ไม่จำเป็นต้องสร้างบัญชีให้พนักงานทุกคน
              </div>
            )}
            {view === "roles" && (
              <div className="info-banner">
                ตำแหน่งงานบอกว่าทำหน้าที่อะไร
                ส่วนบทบาทกำหนดสิทธิ์ที่ใช้ในโปรแกรม การเปลี่ยนสิทธิ์มีผลทันที
              </div>
            )}
            {view === "pressing" && showPressing && (
              <PressingPanel api={api} user={user} />
            )}
            {view === "color-chart" && showColorChart && (
              <ColorChartPanel api={api} user={user} />
            )}
            {recordView && (
              <section className="panel">
                <div className="panel-toolbar">
                  <div>
                    <h2>รายการ{labels[recordView]}</h2>
                  </div>
                  <div className="toolbar-controls">
                    <label className="search">
                      <span aria-hidden="true">⌕</span>
                      <input
                        aria-label={`ค้นหา${labels[recordView]}`}
                        placeholder={`ค้นหา${recordView === "employees" ? "ชื่อ รหัส หรือแผนก" : labels[recordView]}…`}
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                      />
                    </label>
                    {recordView === "employees" && (
                      <select
                        id="filter"
                        aria-label="กรองสถานะ"
                        value={filter}
                        onChange={(event) => setFilter(event.target.value)}
                      >
                        <option value="current">พนักงานปัจจุบัน</option>
                        <option value="active">เปิดใช้งาน</option>
                        <option value="inactive">ปิดใช้งาน</option>
                        <option value="archived">รายการที่ลบแล้ว</option>
                        <option value="all">ทั้งหมด</option>
                      </select>
                    )}
                  </div>
                </div>
                <RecordTable
                  view={recordView}
                  records={records}
                  user={user}
                  permissions={permissions}
                  query={query}
                  filter={filter}
                  onCreate={create}
                  onEdit={(item) => {
                    if (recordView !== "audit")
                      setDialog({ kind: "editor", view: recordView, item });
                  }}
                  onDelete={(item) => {
                    if (recordView !== "audit")
                      setDialog({ kind: "delete", view: recordView, item });
                  }}
                />
                <div className="panel-foot">
                  <span>ข้อมูลภายในโรงงาน · แสดงตามสิทธิ์ของคุณ</span>
                  <span>
                    {recordView === "audit"
                      ? "ประวัติล่าสุด 300 รายการ"
                      : "บันทึกการเปลี่ยนแปลงทุกครั้ง"}
                  </span>
                </div>
              </section>
            )}
            {(recordView || !view) && (
              <footer className="page-foot">
                <span>LThai Factory · พื้นฐานที่ดี เริ่มจากข้อมูลที่ชัดเจน</span>
                <span>PEOPLE &amp; ACCESS · PHASE 01</span>
              </footer>
            )}
          </main>
        </div>
      </div>
      {dialog && (
        <Dialog
          key={JSON.stringify(dialog)}
          state={dialog}
          records={records}
          permissions={permissions}
          api={api}
          onClose={() => setDialog(null)}
          onSaved={saved}
          onPasswordChanged={() => {
            clearSession();
            setMessage("เปลี่ยนรหัสผ่านแล้ว กรุณาเข้าสู่ระบบใหม่");
          }}
        />
      )}
      {toast}
    </>
  );
}
