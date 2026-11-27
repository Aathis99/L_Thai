"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { count, pressingKpi, type PressingData } from "../../lib/pressing";
import type { CatalogState } from "../../lib/tile-catalog";
import type { Api, SessionUser } from "../../lib/types";
import Inventory from "./inventory";
import Orders from "./orders";
import Production, { RecordEntryDialog } from "./production";
import type { PressingActions } from "./shared";

const sections = [
  { id: "orders", label: "ใบสั่งผลิต" },
  { id: "production", label: "บันทึกยอด" },
] as const;

function PressingKpiStrip({ data }: { data: PressingData }) {
  const kpi = pressingKpi(data.orders, data.entries);
  return (
    <section className="clay-kpi-grid" aria-label="สรุปงานปั๊ม">
      <article className="clay-kpi-card">
        <div>
          <div className="clay-kpi-label">ใบสั่งที่ยังไม่ครบยอด</div>
          <div className="clay-kpi-value">
            {count(kpi.incompleteOrders)}
            <span className="clay-kpi-unit">ใบ</span>
          </div>
          <div className={`clay-kpi-sub${kpi.incompleteOrders > 0 ? " warn" : ""}`}>
            {kpi.incompleteOrders > 0
              ? `ยอดขาดรวม ${count(kpi.totalShortPieces)} แผ่น`
              : "ครบตามสั่งทุกใบแล้ว"}
          </div>
        </div>
        <span className="clay-kpi-icon warn" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
        </span>
      </article>
      <article className="clay-kpi-card">
        <div>
          <div className="clay-kpi-label">ยอดปั๊มวันนี้</div>
          <div className="clay-kpi-value">
            {count(kpi.todayPieces)}
            <span className="clay-kpi-unit">แผ่น</span>
          </div>
          <div className="clay-kpi-sub">
            สะสมทั้งหมด {count(kpi.totalPressedPieces)} แผ่น · {count(kpi.totalEntries)} รายการ
          </div>
        </div>
        <span className="clay-kpi-icon clay" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="4" width="16" height="6" rx="1" />
            <path d="M12 10v4" />
            <rect x="3" y="14" width="18" height="6" rx="1" />
          </svg>
        </span>
      </article>
      <article className="clay-kpi-card">
        <div>
          <div className="clay-kpi-label">ใบสั่งผลิตทั้งหมด</div>
          <div className="clay-kpi-value">
            {count(kpi.totalOrders)}
            <span className="clay-kpi-unit">ใบ</span>
          </div>
          <div className="clay-kpi-sub">
            ออเดอร์ลูกค้า {count(kpi.customerOrders)} · เก็บสต็อก {count(kpi.stockOrders)}
          </div>
        </div>
        <span className="clay-kpi-icon good" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 11l3 3L22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
        </span>
      </article>
    </section>
  );
}

export default function PressingPanel({ api, user, stockOnly = false }: { api: Api; user: SessionUser; stockOnly?: boolean }) {
  const [section, setSection] = useState<(typeof sections)[number]["id"]>("orders");
  const [data, setData] = useState<PressingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [quickRecordOrderId, setQuickRecordOrderId] = useState<number | null>(null);
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    const version = ++latest.current;
    setLoading(true);
    setError("");
    const list = async <K extends keyof PressingData>(resource: K, path: string = resource): Promise<PressingData[K]> => {
      return (await api<{ items: PressingData[K] }>(`/pressing/${path}`)).items;
    };
    try {
      const [types, orders, workers, entries, stock, issues, colors, catalog] = await Promise.all([
        list("types"), list("orders"), stockOnly ? [] : list("workers"), stockOnly ? [] : list("entries"),
        stockOnly ? list("stock") : [], stockOnly ? list("issues") : [], stockOnly ? [] : list("colors"),
        stockOnly ? undefined : api<CatalogState>("/catalog/state"),
      ]);
      if (latest.current === version) setData({ types, orders, workers, entries, stock, issues, colors, catalog });
    } catch (cause) {
      if (latest.current === version) {
        setError(cause instanceof TypeError ? "เชื่อมต่อเพื่อโหลดข้อมูลงานปั๊มไม่สำเร็จ" :
          cause instanceof Error ? cause.message : "โหลดข้อมูลงานปั๊มไม่สำเร็จ");
      }
    } finally {
      if (latest.current === version) setLoading(false);
    }
  }, [api, stockOnly]);

  useEffect(() => {
    const onFocus = () => void refresh();
    void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      latest.current++;
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const actions: PressingActions = {
    api,
    refresh,
    can: (permission) => user.permissions.includes(permission),
    onSaved: async (text) => {
      setMessage(text);
      await refresh();
    },
  };

  return (
    <div className="pressing-panel">
      {!stockOnly && data && <PressingKpiStrip data={data} />}
      <div className="pressing-navigation">
        {!stockOnly && (
          <nav aria-label="เมนูงานปั๊ม">
            {sections.map((item) => (
              <button
                key={item.id}
                className={`button ${section === item.id ? "tab-selected" : "secondary"}`}
                aria-pressed={section === item.id}
                onClick={() => {
                  setMessage("");
                  setSection(item.id);
                }}
              >
                {item.label}
              </button>
            ))}
          </nav>
        )}
        <button
          className="button secondary"
          disabled={loading}
          onClick={() => {
            setMessage("");
            void refresh();
          }}
        >
          โหลดล่าสุด
        </button>
      </div>
      {message && <p className="success-banner" role="status">{message}</p>}
      {loading && !data && <p role="status">กำลังโหลดข้อมูลงานปั๊ม…</p>}
      {error && <p className="error-banner" role="alert">{error}</p>}
      {data && (
        stockOnly ? (
          <Inventory data={data} actions={actions} />
        ) : section === "orders" ? (
          <Orders
            data={data}
            actions={actions}
            onQuickRecord={(orderId) => setQuickRecordOrderId(orderId)}
          />
        ) : (
          <Production
            data={data}
            actions={actions}
            onGoOrders={() => {
              setMessage("");
              setSection("orders");
            }}
          />
        )
      )}
      {!stockOnly && data && quickRecordOrderId !== null && actions.can("pressing.record") && (
        <RecordEntryDialog
          api={actions.api}
          data={data}
          initialOrderId={quickRecordOrderId}
          onSaved={actions.onSaved}
          onClose={() => setQuickRecordOrderId(null)}
        />
      )}
    </div>
  );
}
