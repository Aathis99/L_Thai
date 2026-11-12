"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { canManageColorChart, filterColorChart, type ColorChartItem } from "../../lib/color-chart";
import type { Api, SessionUser } from "../../lib/types";

const chartPath = "/color-chart";
type Change =
  | { kind: "save"; fields: Pick<ColorChartItem, "name" | "note"> }
  | { kind: "delete" | "upload-image" | "delete-image" };

function ChartImage({ item, version, thumbnail = false }: { item: ColorChartItem; version: number; thumbnail?: boolean }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const className = thumbnail ? "chart-thumbnail" : "chart-preview";
  if (!item.has_image) return <span className={`${className} chart-placeholder`}>ยังไม่มีภาพ</span>;
  if (failed) {
    return (
      <button type="button" className={`${className} chart-placeholder chart-image-retry`}
        aria-label={`ลองโหลดภาพใหม่ ${item.name}`} onClick={() => {
          setAttempt((current) => current + 1);
          setFailed(false);
        }}>
        ลองโหลดภาพใหม่
      </button>
    );
  }
  const cacheKey = attempt ? `?v=${version}&retry=${attempt}` : version ? `?v=${version}` : "";
  return (
    <img
      className={className}
      src={`/api${chartPath}/${item.id}/image${cacheKey}`}
      alt={thumbnail ? "" : `ภาพตัวอย่าง ${item.name}`}
      loading={thumbnail ? "lazy" : undefined}
      onError={() => setFailed(true)}
    />
  );
}

function ChartDialog({ api, item, canManage, version, refreshError, onRetryRefresh, onClose, onChanged }: {
  api: Api;
  item?: ColorChartItem;
  canManage: boolean;
  version: number;
  refreshError: string;
  onRetryRefresh: () => void;
  onClose: () => void;
  onChanged: (id: number, change: Change) => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const titleId = useId();
  const [editing, setEditing] = useState(!item);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const path = item ? `${chartPath}/${item.id}` : chartPath;

  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  async function change(action: Change, method: string, suffix = "", data?: unknown) {
    if (!canManage || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const body = action.kind === "save" ? action.fields : data;
      const result = await api<{ id: number }>(`${path}${suffix}`, method, body);
      await onChanged(result.id, action);
      setEditing(false);
      setMessage(action.kind === "upload-image" ? "บันทึกภาพแล้ว" : action.kind === "delete-image" ? "ลบภาพแล้ว" : "บันทึกรายการแล้ว");
    } catch (cause) {
      setError(cause instanceof TypeError ? "เชื่อมต่อไม่สำเร็จ กรุณาตรวจสอบรายการก่อนลองอีกครั้ง" :
        cause instanceof Error ? cause.message : "ไม่สามารถทำรายการได้");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const fields = {
      name: String(data.get("name") ?? "").trim(),
      note: String(data.get("note") ?? "").trim() || null,
    };
    void change({ kind: "save", fields }, item ? "PUT" : "POST");
  }

  function remove() {
    if (item && window.confirm(`ลบรายการ “${item.name}” และภาพตัวอย่างของรายการนี้หรือไม่?`)) {
      void change({ kind: "delete" }, "DELETE");
    }
  }

  return (
    <dialog ref={ref} className="chart-dialog" aria-labelledby={titleId} onCancel={(event) => {
      event.preventDefault();
      if (!inFlight.current) onClose();
    }}>
      <div className="modal-head">
        <h2 id={titleId}>{item ? `รายการลำดับ ${item.display_order}` : "เพิ่มรายการชาร์ตสี"}</h2>
        <button type="button" className="icon-button" aria-label="ปิด" disabled={busy} onClick={onClose}>×</button>
      </div>
      <div className="modal-body">
        {error && <p className="error-banner" role="alert">{error}</p>}
        {message && <p className="chart-status" role="status">{message}</p>}
        {refreshError && item && (
          <div className="error-banner" role="alert">
            {refreshError}
            <button type="button" className="quiet" disabled={busy} onClick={onRetryRefresh}>ลองใหม่</button>
          </div>
        )}
        {editing && canManage ? (
          <form onSubmit={save}>
            <label className="field">
              <span>ชื่อสีกระเบื้อง</span>
              <input name="name" defaultValue={item?.name} required maxLength={120} disabled={busy} />
            </label>
            <label className="field">
              <span>หมายเหตุ</span>
              <textarea name="note" defaultValue={item?.note ?? ""} rows={4} maxLength={1000} disabled={busy} />
            </label>
            {!item && <p className="chart-status">เพิ่มภาพตัวอย่างได้หลังบันทึกชื่อ</p>}
            <div className="chart-actions">
              <button type="submit" className="button primary" disabled={busy}>{busy ? "กำลังบันทึก…" : "บันทึก"}</button>
              <button type="button" className="button secondary" disabled={busy} onClick={() => {
                setError("");
                if (item) setEditing(false);
                else onClose();
              }}>ยกเลิก</button>
            </div>
          </form>
        ) : item && (
          <>
            <h3>{item.name}</h3>
            <ChartImage key={version} item={item} version={version} />
            {item.note && (
              <div className="chart-note">
                <strong>หมายเหตุ</strong>
                <p>{item.note}</p>
              </div>
            )}
            {canManage && (
              <>
                <div className="chart-actions">
                  <input ref={fileInput} type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    if (file) void change({ kind: "upload-image" }, "PUT", "/image", file);
                  }} />
                  <button type="button" className="button secondary" disabled={busy} onClick={() => fileInput.current?.click()}>
                    {item.has_image ? "เปลี่ยนภาพ" : "เพิ่มภาพ"}
                  </button>
                  {item.has_image && (
                    <button type="button" className="button secondary danger" disabled={busy} onClick={() => void change({ kind: "delete-image" }, "DELETE", "/image")}>
                      ลบภาพ
                    </button>
                  )}
                </div>
                <p className="chart-status">JPEG, PNG หรือ WebP ขนาดไม่เกิน 8 MiB</p>
              </>
            )}
          </>
        )}
      </div>
      {item && canManage && !editing && (
        <div className="modal-foot">
          <button type="button" className="button secondary" disabled={busy} onClick={() => {
            setError("");
            setMessage("");
            setEditing(true);
          }}>แก้ชื่อและหมายเหตุ</button>
          <button type="button" className="button secondary danger" disabled={busy} onClick={remove}>ลบรายการ</button>
        </div>
      )}
    </dialog>
  );
}

export default function ColorChartPanel({ api, user }: { api: Api; user: SessionUser }) {
  const canManage = canManageColorChart(user.permissions);
  const [items, setItems] = useState<ColorChartItem[]>([]);
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<number | "new" | null>(null);
  const [imageVersions, setImageVersions] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const latest = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++latest.current;
    setLoading(true);
    setError("");
    try {
      const result = await api<{ items: ColorChartItem[] }>(chartPath);
      if (latest.current === version) setItems(result.items);
      return result.items;
    } catch (cause) {
      if (latest.current === version) setError(cause instanceof TypeError ? "เชื่อมต่อเพื่อโหลดชาร์ตสีไม่สำเร็จ" :
        cause instanceof Error ? cause.message : "โหลดชาร์ตสีไม่สำเร็จ");
      return null;
    } finally {
      if (latest.current === version) setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
    return () => { latest.current++; };
  }, [refresh]);

  const visibleItems = filterColorChart(items, query);
  const selectedItem = items.find((item) => item.id === selection);
  const savedItemAwaitingRefresh = typeof selection === "number" && !selectedItem;

  async function retryRefresh() {
    const updated = await refresh();
    if (savedItemAwaitingRefresh && updated && !updated.some((item) => item.id === selection)) {
      setSelection((current) => current === selection ? null : current);
    }
  }

  async function onChanged(id: number, change: Change) {
    if (change.kind === "save") {
      if (selection === "new") {
        const updated = await refresh();
        setSelection(!updated || updated.some((item) => item.id === id) ? id : null);
        return;
      }
      setItems((current) => current.map((item) => item.id === id ? { ...item, ...change.fields } : item));
    }
    if (change.kind === "delete") {
      setSelection(null);
      setItems((current) => current.filter((item) => item.id !== id));
    }
    if (change.kind === "upload-image" || change.kind === "delete-image") {
      setImageVersions((current) => ({ ...current, [id]: (current[id] ?? 0) + 1 }));
      setItems((current) => current.map((item) => item.id === id ? { ...item, has_image: change.kind === "upload-image" } : item));
    }
    await refresh();
  }

  return (
    <section className="panel chart-panel" aria-label="รายการชาร์ตสี">
      <div className="panel-toolbar chart-toolbar">
        <label className="search">
          <span aria-hidden="true">⌕</span>
          <input type="search" aria-label="ค้นหาชื่อสีกระเบื้อง" placeholder="ค้นหาชื่อสีกระเบื้อง…" value={query}
            onChange={(event) => setQuery(event.target.value)} />
        </label>
        {canManage && <button type="button" className="button primary" disabled={savedItemAwaitingRefresh} onClick={() => setSelection("new")}>เพิ่มรายการ</button>}
      </div>
      {error && (
        <div className="error-banner chart-load-error" role="alert">
          {savedItemAwaitingRefresh ? "บันทึกรายการแล้ว แต่โหลดรายการใหม่ไม่สำเร็จ" : error}
          <button type="button" className="quiet" onClick={() => void retryRefresh()}>ลองใหม่</button>
        </div>
      )}
      {loading && <p className="result-summary" role="status">กำลังโหลดชาร์ตสี…</p>}
      {visibleItems.length > 0 ? (
        <table className="chart-table">
          <thead><tr><th scope="col">ลำดับ</th><th scope="col">ภาพ</th><th scope="col">ชื่อสีกระเบื้อง</th></tr></thead>
          <tbody>
            {visibleItems.map((item) => (
              <tr key={item.id}>
                <td>{item.display_order}</td>
                <td><ChartImage key={imageVersions[item.id] ?? 0} item={item} version={imageVersions[item.id] ?? 0} thumbnail /></td>
                <td>
                  <button type="button" className="chart-entry" onClick={() => setSelection(item.id)}>{item.name}</button>
                  {item.note && <div><span className="badge muted-badge">มีหมายเหตุ</span></div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : !loading && !error && (
        <p className="result-summary">{query.trim() ? "ไม่พบชื่อสีกระเบื้องที่ค้นหา" : "ยังไม่มีรายการชาร์ตสี"}</p>
      )}
      {(selectedItem || (selection === "new" && canManage)) && (
        <ChartDialog key={selection} api={api} item={selectedItem} version={selectedItem ? imageVersions[selectedItem.id] ?? 0 : 0}
          canManage={canManage} refreshError={error} onRetryRefresh={() => void retryRefresh()}
          onClose={() => setSelection(null)} onChanged={onChanged} />
      )}
    </section>
  );
}
