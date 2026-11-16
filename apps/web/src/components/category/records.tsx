import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import type { Api, SessionUser } from "../../lib/types";

export type CategoryRecordsProps<T> = {
  api: Api;
  user: SessionUser;
  data: T;
  onSaved: (text: string) => Promise<void>;
};

export function CategoryRecords<T>({ api, user, load, Component }: {
  api: Api;
  user: SessionUser;
  load: (api: Api) => Promise<T>;
  Component: ComponentType<CategoryRecordsProps<T>>;
}) {
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const latest = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++latest.current;
    setLoading(true);
    setError("");
    try {
      const result = await load(api);
      if (latest.current === version) setData(result);
    } catch (cause) {
      if (latest.current === version) {
        setError(cause instanceof Error ? cause.message : "โหลดข้อมูลหมวดหมู่ไม่สำเร็จ");
      }
    } finally {
      if (latest.current === version) setLoading(false);
    }
  }, [api, load]);

  useEffect(() => {
    const onFocus = () => void refresh();
    void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      latest.current++;
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  return <>
    <div className="pressing-actions">
      <button className="button secondary" onClick={() => {
        setMessage("");
        void refresh();
      }} disabled={loading}>โหลดรายการใหม่</button>
    </div>
    <p className="pressing-status" role="status">{message || (loading ? "กำลังโหลดข้อมูล…" : "")}</p>
    {error && <p className="error-banner" role="alert">{error}</p>}
    {data !== undefined && <Component api={api} user={user} data={data} onSaved={async text => {
      setMessage(text);
      await refresh();
    }} />}
  </>;
}
