"use client";

import { useCallback, useEffect, useState } from "react";
import Auth from "./auth";
import CategoryPanel from "./category/panel";
import KilnArea from "./kiln-prototype/area";
import GlazingPage from "./finishing/glazing";
import Dialog, { type DialogState } from "./dialog";
import ThemeToggle from "./theme-toggle";
import { Brand } from "./fields";
import PressingPanel from "./pressing/panel";
import RecordTable from "./record-table";
import StockPanel from "./stock/panel";
import RawClayPanel from "./raw-clay/panel";
import { visibleCategoryTabs } from "../lib/category";
import { canOpenPressing } from "../lib/pressing";
import { visibleStockTabs, type StockTab } from "../lib/stock";
import {
  allowed,
  emptyRecords,
  labels,
  subtitles,
  views,
  type Api,
  type Records,
  type SessionUser,
  type View,
} from "../lib/types";

type WorkspaceView = View | "pressing" | "category" | "glazing" | "firing" | "qc" | "stock" | "raw-clay";
const workspaceViews: WorkspaceView[] = [...views, "category", "raw-clay", "stock", "pressing", "glazing", "firing", "qc"];

const navGroups: { id: string; title: string; views: WorkspaceView[] }[] = [
  { id: "production", title: "สายการผลิต", views: ["raw-clay", "pressing", "glazing", "firing", "qc", "stock"] },
  { id: "master", title: "ข้อมูลหลัก", views: ["category"] },
  { id: "people", title: "บุคลากรและระบบ", views: ["employees", "positions", "roles", "users", "audit"] },
];

function NavIcon({ name, size = 18 }: { name: WorkspaceView | "factory" | "logout" | "search" | "active"; size?: number }) {
  const props = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (name) {
    case "raw-clay":
      return <svg {...props}><path d="M3 17h18l-2-9H5l-2 9Z" /><path d="M8 8V6a4 4 0 0 1 8 0v2" /><path d="M2 20h20" /></svg>;
    case "pressing":
      return <svg {...props}><rect x="4" y="4" width="16" height="6" rx="1" /><path d="M12 10v4" /><rect x="3" y="14" width="18" height="6" rx="1" /></svg>;
    case "glazing":
      return <svg {...props}><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" /></svg>;
    case "firing":
      return <svg {...props}><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z" /></svg>;
    case "qc":
      return <svg {...props}><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>;
    case "stock":
      return <svg {...props}><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" /></svg>;
    case "category":
      return <svg {...props}><path d="M12 2 2 7l10 5 10-5-10-5Z" /><path d="m2 17 10 5 10-5" /><path d="m2 12 10 5 10-5" /></svg>;
    case "employees":
      return <svg {...props}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>;
    case "positions":
      return <svg {...props}><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></svg>;
    case "roles":
      return <svg {...props}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>;
    case "users":
      return <svg {...props}><circle cx="12" cy="8" r="4" /><path d="M20 21a8 8 0 0 0-16 0" /></svg>;
    case "audit":
      return <svg {...props}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>;
    case "factory":
      return <svg {...props}><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="8" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /><rect x="13" y="13" width="8" height="8" rx="1.5" /></svg>;
    case "logout":
      return <svg {...props}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>;
    case "search":
      return <svg {...props}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>;
    case "active":
      return <svg {...props}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>;
  }
}

function canOpenView(user: SessionUser, view: WorkspaceView) {
  if (view === "raw-clay") return user.permissions.includes("raw_clay.read");
  if (view === "pressing") return canOpenPressing(user.permissions);
  if (view === "category") return visibleCategoryTabs(user.permissions).length > 0;
  if (view === "glazing" || view === "firing" || view === "qc") return user.permissions.includes("finishing.read");
  if (view === "stock") return visibleStockTabs(user.permissions).length > 0;
  return allowed(user, view);
}

function workspaceLabel(view: WorkspaceView | null) {
  if (view === "raw-clay") return "รับดินและวัตถุดิบ";
  if (view === "pressing") return "งานปั๊ม";
  if (view === "category") return "หมวดหมู่";
  if (view === "glazing") return "งานชุบเคลือบ";
  if (view === "firing") return "งานเตา";
  if (view === "qc") return "ตรวจสอบคุณภาพ(QC)";
  if (view === "stock") return "สต็อก";
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
  const [stockTab, setStockTab] = useState<StockTab>();
  const [qcRound, setQcRound] = useState<number>();
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

  async function navigate(next: WorkspaceView, options?: { stockTab?: StockTab; roundId?: number }) {
    if (next === "stock") setStockTab(options?.stockTab);
    if (next === "qc") setQcRound(options?.roundId);
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
  const showCategory = canOpenView(user, "category");
  const showFinishing = canOpenView(user, "glazing");
  const showStock = canOpenView(user, "stock");
  const showFactoryNav = showPressing || showCategory || showFinishing || showStock || canOpenView(user, "raw-clay");
  const recordView = view === "pressing" || view === "category" || view === "glazing" ||
    view === "firing" || view === "qc" || view === "stock" || view === "raw-clay" ? null : view;
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
              <NavIcon name="factory" size={18} />
            </span>
            <div>
              โรงงานกระเบื้อง<small>ระบบการผลิตและข้อมูลหลัก</small>
            </div>
            <span className="live-dot" />
          </div>
          <nav
            aria-label="เมนูหลัก"
            className={showFactoryNav ? "nav-has-factory" : undefined}
          >
            {navGroups.map((group) => {
              const items = group.views.filter((candidate) => canOpenView(user, candidate));
              if (!items.length) return null;
              return (
                <div key={group.id} className="nav-group">
                  <div className="nav-group-title">{group.title}</div>
                  {items.map((candidate) => (
                    <button
                      key={candidate}
                      onClick={() => void navigate(candidate)}
                      className={`nav-item ${view === candidate ? "selected" : ""}`}
                      aria-current={view === candidate ? "page" : undefined}
                      aria-label={candidate === "pressing" ? "งานปั๊ม" : undefined}
                    >
                      <span aria-hidden="true">
                        <NavIcon name={candidate} />
                      </span>
                      {workspaceLabel(candidate)}
                      {candidate === "employees" && <small>{current.length}</small>}
                    </button>
                  ))}
                </div>
              );
            })}
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
              <NavIcon name="logout" size={18} />
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
              <ThemeToggle />
            </div>
          </header>
          <main className="main">
            <div className="page-head">
              <div>
                {(recordView || !view) && <p className="eyebrow">PEOPLE &amp; ACCESS</p>}
                <h1>{workspaceLabel(view)}</h1>
                {view !== "stock" && view !== "glazing" && view !== "firing" && view !== "qc" && view !== "raw-clay" && <p>
                  {view === "pressing"
                    ? "ใบสั่งผลิตและยอดปั๊ม"
                    : view === "category"
                      ? "ข้อมูลอ้างอิงสำหรับการผลิต"
                      : view
                        ? subtitles[view]
                        : "บัญชีนี้ยังไม่ได้รับสิทธิ์เข้าถึงเมนู กรุณาติดต่อผู้ดูแลระบบ"}
                </p>}
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
                    <NavIcon name="employees" size={20} />
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
                    <NavIcon name="active" size={20} />
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
                    <NavIcon name="positions" size={20} />
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
            {view === "category" && showCategory && (
              <CategoryPanel api={api} user={user} />
            )}
            {view === "glazing" && showFinishing && <GlazingPage api={api} user={user} />}
            {(view==='firing'||view==='qc')&&showFinishing&&<KilnArea api={api} user={user} qc={view==='qc'} qa={process.env.NEXT_PUBLIC_KILN_QA==='true'}
              initialRoundId={view==='qc'?qcRound:undefined} openQc={roundId=>void navigate('qc',{roundId})} openStock={()=>void navigate('stock',{stockTab:'finished'})}/>}
            {view === "stock" && showStock && <StockPanel api={api} user={user} initialTab={stockTab} />}
            {view === "raw-clay" && canOpenView(user, "raw-clay") && <RawClayPanel api={api} user={user} />}
            {recordView && (
              <section className="panel">
                <div className="panel-toolbar">
                  <div>
                    <h2>รายการ{labels[recordView]}</h2>
                  </div>
                  <div className="toolbar-controls">
                    <label className="search">
                      <span aria-hidden="true"><NavIcon name="search" size={16} /></span>
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
