"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PressingData } from "../../lib/pressing";
import type { Api, SessionUser } from "../../lib/types";
import Inventory from "./inventory";
import Orders from "./orders";
import Production from "./production";
import type { PressingActions } from "./shared";

const sections = [
  { id: "orders", label: "ใบสั่งผลิต", Component: Orders },
  { id: "production", label: "บันทึกยอด", Component: Production },
] as const;

export default function PressingPanel({ api, user, stockOnly = false }: { api: Api; user: SessionUser; stockOnly?: boolean }) {
  const [section, setSection] = useState<(typeof sections)[number]["id"]>("orders");
  const [data, setData] = useState<PressingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    const version = ++latest.current;
    setLoading(true);
    setError("");
    const list = async <K extends keyof PressingData>(resource: K, path: string = resource): Promise<PressingData[K]> => {
      return (await api<{ items: PressingData[K] }>(`/pressing/${path}`)).items;
    };
    try {
      const [types, orders, workers, entries, stock, issues, colors] = await Promise.all([
        list("types"), list("orders"), stockOnly ? [] : list("workers"), stockOnly ? [] : list("entries"),
        stockOnly ? list("stock") : [], stockOnly ? list("issues") : [], stockOnly ? [] : list("colors"),
      ]);
      if (latest.current === version) setData({ types, orders, workers, entries, stock, issues, colors });
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
  const Component = stockOnly ? Inventory : sections.find((item) => item.id === section)!.Component;
  return (
    <div className="pressing-panel">
      <div className="pressing-navigation">
        {!stockOnly && <nav aria-label="เมนูงานปั๊ม">
          {sections.map((item) => (
            <button key={item.id} className={`button ${section === item.id ? "tab-selected" : "secondary"}`}
              aria-pressed={section === item.id} onClick={() => {
                setMessage("");
                setSection(item.id);
              }}
            >
              {item.label}
            </button>
          ))}
        </nav>}
        <button className="button secondary" disabled={loading} onClick={() => {
          setMessage("");
          void refresh();
        }}>
          โหลดรายการใหม่
        </button>
      </div>
      <p className="pressing-status" role="status">{message || (loading ? "กำลังโหลดข้อมูลงานปั๊ม…" : "")}</p>
      {error && <p className="error-banner" role="alert">{error}</p>}
      {data && <Component data={data} actions={actions} />}
    </div>
  );
}
