import { useCallback, useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { finishingTileName, type FinishingTile } from "../../lib/finishing";
import { bangkokDate, formInteger, formText } from "../../lib/pressing";
import type { Api, SessionUser } from "../../lib/types";
import type { PressingWorker } from "../../lib/pressing";
import { Field } from "../fields";
import { FormDialog } from "../pressing/shared";

type Order = { id: number; customer_reference: string; type_id: number; clay: string; color_name: string | null;
  product_id?: number | null; product_code?: string | null; product_name?: string | null;
  requires_mesh?: boolean; allocated_pieces?: number; waiting_mesh_pieces?: number;
  customer_pieces: number; ready_pieces: number; missing_pieces: number };
export type Issue = { id: number; type_id: number; clay: string; order_id: number; customer_reference: string; destination: "color" | "kiln";
  color_name: string | null; finishing_ready: boolean; customer_pieces: number | null; net_pieces: number; unglazed_pieces: number };
type Batch = { id: number; issue_id: number; worked_on: string; pieces: number; pressing_waste: number; glazing_waste: number;
  good_pieces: number; pieces_per_sqm: number | null; workers: string[]; customer_reference: string; color_name: string };
export type Source = { issue_id: number; batch_id: number | null; type_id: number; clay: string; customer_reference: string; color_name: string | null;
  clay_min: number | null; clay_max: number | null; color_min: number | null; color_max: number | null; ready_on: string;
  waiting_pieces: number; firing_pieces: number; awaiting_qc_pieces: number; completed_pieces: number };
type Load = { id: number; order_id: number; issue_id: number; batch_id: number | null; type_id: number; clay: string; color_name: string | null;
  pieces: number; unsorted_pieces: number };
export type Round = { id: number; kiln: string; temperature: number; started_on: string; finished_on: string | null; loads: Load[] };
type Qc = { id: number; round_id: number; sorted_on: string; good_pieces: number; waste_pieces: number; allocated_pieces: number;
  product_id?: number | null; product_code?: string | null; product_name?: string | null; production_clay_color?: string | null;
  unallocated_pieces: number; stocked_pieces: number; stock_available: number; orders: number[]; type_id: number;
  clay: string; color_name: string | null; voided_at: string | null; loads: { id: number; order_id: number; pieces: number }[];
  allocations: { id: number; order_id: number; pieces: number; voided_at: string | null }[] };
export type Data = {
  types: FinishingTile[]; orders: Order[]; issues: Issue[]; glazing: Batch[]; rounds: Round[]; sources: Source[];
  qc: Qc[]; workers: PressingWorker[];
};
type Editor = Pick<ComponentProps<typeof FormDialog>, "title" | "path" | "build" | "children" | "intent">;
type Common = "types" | "orders";

export interface FinishingActions {
  refresh: () => Promise<void>;
  tileName: (id: number, clay: string) => string;
  orderName: (id: number) => string;
  can: (permission: string) => boolean;
  open: (title: string, path: string, build: Editor["build"], children: ReactNode, intent?: Editor["intent"]) => void;
  reverse: (label: string, path: string, key: string, id: number) => ReactNode;
}

export function NumberField({ name, label, min = 1, max, defaultValue, required = true }: {
  name: string; label: string; min?: number; max?: number; defaultValue?: number; required?: boolean;
}) {
  return <Field {...{ name, label, min, max, defaultValue, required }} type="number" step={1} />;
}

export function DateField({ name, label, min }: { name: string; label: string; min?: string }) {
  return <Field name={name} label={label} type="date" min={min} defaultValue={bangkokDate()} required />;
}

export function action(label: string, onClick: () => void, intent: "primary" | "success" | "warning" | "destructive" | "secondary" = "secondary") {
  return <button className={`button ${intent}`} onClick={onClick}>{label}</button>;
}

export const number = formInteger;

export default function FinishingPage<K extends keyof Data>({ api, user, resources, children }: {
  api: Api; user: SessionUser; resources: readonly K[];
  children: (data: Pick<Data, K | Common>, actions: FinishingActions) => ReactNode;
}) {
  const [data, setData] = useState<Pick<Data, K | Common>>();
  const [editor, setEditor] = useState<Editor>();
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    const version = ++latest.current;
    setError("");
    try {
      const keys = ["types", "orders", ...resources] as const;
      const lists = await Promise.all(keys.map(async key =>
        [key, (await api<{ items: Data[typeof key] }>(`/finishing/${key}`)).items]));
      if (latest.current === version) setData(Object.fromEntries(lists) as Pick<Data, K | Common>);
    } catch (cause) {
      if (latest.current === version) setError(cause instanceof Error ? cause.message : "โหลดข้อมูลงานผลิตไม่สำเร็จ");
    }
  }, [api, resources]);

  useEffect(() => {
    const onFocus = () => void refresh();
    void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      latest.current++;
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const open: FinishingActions["open"] = (title, path, build, children, intent = "success") => {
    setStatus("");
    setEditor({ title, path, build, children, intent });
  };
  const actions: FinishingActions = {
    refresh,
    tileName: (id, clay) => finishingTileName(data?.types ?? [], id, clay),
    orderName: id => {
      const order = data?.orders.find(item => item.id === id);
      return order ? `ออเดอร์ ${order.customer_reference} · ใบสั่ง #${id}` : `ใบสั่ง #${id}`;
    },
    can: permission => user.permissions.includes(`finishing.${permission}`),
    open,
    reverse: (label, path, key, id) => action(label, () =>
      open(label, path, form => ({ [key]: id, reason: formText(form, "reason") }),
        <><p>รายการ #{id}</p><Field name="reason" label="เหตุผล" required /></>, "warning"), "warning"),
  };

  return <div className="pressing-panel">
    <div className="pressing-navigation">
      {action("โหลดรายการใหม่", () => void refresh(), "secondary")}
    </div>
    {error && <p className="error-banner" role="alert">{error}</p>}
    <p role="status">{status || (!data && !error ? "กำลังโหลดข้อมูลงานผลิต…" : "")}</p>
    {data && children(data, actions)}
    {editor && <FormDialog {...editor} api={api} scope="finishing" keyField="request_id"
      submitLabel="ยืนยันบันทึก" onClose={() => setEditor(undefined)} onStale={refresh} onSaved={async () => {
        setStatus("บันทึกแล้ว");
        await refresh();
      }} />}
  </div>;
}
