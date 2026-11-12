export type Destination = "color" | "kiln";
export type Allocation = "general" | "order";

export interface TileType {
  id: number;
  width: number;
  length: number;
  clay: string;
  name: string | null;
  clay_color: string | null;
  pieces_per_rack: number;
  rest_days: number;
  destination: Destination;
  pieces_per_sqm: number | null;
  active: boolean;
}

export interface ProductionOrder {
  id: number;
  type_id: number;
  purpose: "customer" | "stock";
  customer_reference: string | null;
  target_pieces: number;
  pressed_pieces: number;
  short_pieces: number;
  over_pieces: number;
}

export interface PressingWorker {
  id: number;
  code: string;
  name: string;
}

export interface EntryValues {
  pressed_on: string;
  employee_id: number;
  full_racks: number;
  loose_pieces: number;
  note: string | null;
  ready_on: string;
}

export interface PressingEntry extends EntryValues {
  id: number;
  order_id: number;
  employee_name: string;
  pieces: number;
  original_pieces: number;
  pieces_per_rack: number;
  square_meters: number | null;
  recorded_by_username: string;
  recorded_at: string;
}

export interface StockSource {
  id: number;
  type_id: number;
  entry_id: number | null;
  order_id: number | null;
  pressed_on: string | null;
  as_of: string | null;
  ready_on: string | null;
  ready: boolean;
  destination: Destination;
  remaining_pieces: number;
  general_pieces: number;
  restricted_pieces: number;
}

export interface IssueLine {
  id: number;
  source_id: number;
  pieces: number;
  allocation: Allocation;
}

export interface StockIssue {
  id: number;
  type_id: number;
  order_id: number | null;
  destination: Destination;
  pooled: boolean;
  issued_by_username: string;
  issued_at: string;
  lines: IssueLine[];
}

export interface EntryCorrection {
  id: number;
  kind: "edit" | "adjustment";
  previous_pieces: number;
  corrected_pieces: number;
  previous_values: EntryValues | null;
  corrected_values: EntryValues | null;
  reason: string | null;
  corrected_by_username: string;
  corrected_at: string;
}

export interface IssueReversal {
  id: number;
  reason: string;
  reversed_by_username: string;
  reversed_at: string;
  lines: {
    issue_line_id: number;
    source_id: number;
    allocation: Allocation;
    pieces: number;
    previous_pieces: number;
  }[];
}

export interface SortResult {
  id: number;
  type_id: number;
  revision: number;
  is_current: boolean;
  sorted_on: string;
  good_pieces: number;
  waste_pieces: number;
  issue_ids: number[];
  employee_id: number | null;
  correction_reason: string | null;
  submitted_by_username: string;
  submitted_at: string;
}

export interface KilnJob {
  id: number;
  reference: string;
  fired_on: string;
  good_pieces: number;
  waste_pieces: number;
  results: SortResult[];
}

export interface PressingData {
  types: TileType[];
  orders: ProductionOrder[];
  workers: PressingWorker[];
  entries: PressingEntry[];
  stock: StockSource[];
  issues: StockIssue[];
  jobs: KilnJob[];
}

export const destinations = { color: "งานสี", kiln: "เข้าเตา" };
export const allocations = { general: "ยอดทั่วไป", order: "ยอดผูกใบสั่ง" };
export const orderPurposes = { customer: "ออเดอร์ลูกค้า", stock: "เก็บสต็อก" };

const businessCalendar = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Bangkok",
  calendar: "gregory",
});
const timestampFormat = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  dateStyle: "short",
  timeStyle: "short",
});
const countFormat = new Intl.NumberFormat("th-TH");

export function bangkokDate(now = new Date()): string {
  return businessCalendar.format(now);
}

export function timestamp(value: string): string {
  return timestampFormat.format(new Date(value));
}

export function count(value: number): string {
  return countFormat.format(value);
}

export function tileName(types: readonly TileType[], id: number): string {
  const tile = types.find((item) => item.id === id);
  if (!tile) return `ประเภท #${id}`;
  const description = `${tile.width} × ${tile.length} · ดิน${tile.clay}`;
  return tile.name ? `${tile.name} · ${description}` : description;
}

export function orderName(order: ProductionOrder): string {
  return `ใบสั่ง #${order.id} · ${order.customer_reference ?? orderPurposes[order.purpose]}`;
}

export function workerName(data: PressingData, id: number): string {
  return data.workers.find((worker) => worker.id === id)?.name
    ?? data.entries.find((entry) => entry.employee_id === id)?.employee_name
    ?? `พนักงาน #${id}`;
}

export function canOpenPressing(permissions: readonly string[]): boolean {
  return permissions.includes("pressing.read");
}

export function createPressingRequestKey(
  random: { getRandomValues(bytes: Uint8Array): Uint8Array } = globalThis.crypto,
): string {
  return Array.from(random.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function formText(form: FormData, field: string): string {
  const value = form.get(field);
  return typeof value === "string" ? value.trim() : "";
}

const maxPressingInteger = 2147483647;

export function formInteger(
  form: FormData,
  field: string,
  label: string,
  minimum = 1,
  blankIsZero = false,
): number {
  const text = formText(form, field);
  if (text === "" && blankIsZero) return 0;
  const value = Number(text);
  if (!/^\d+$/.test(text) || value < minimum || value > maxPressingInteger) {
    throw new Error(`กรุณาระบุ${label}เป็นจำนวนเต็มที่ถูกต้อง`);
  }
  return value;
}

export function entryFormValues(form: FormData, piecesPerRack: number) {
  const fullRacks = formInteger(form, "full_racks", "จำนวนไม้เต็ม", 0);
  const loosePieces = formInteger(form, "loose_pieces", "จำนวนแผ่นเศษ", 0, true);
  const pieces = fullRacks * piecesPerRack + loosePieces;
  if (pieces < 1 || pieces > maxPressingInteger) {
    throw new Error("ยอดปั๊มรวมต้องอยู่ระหว่าง 1 ถึง 2,147,483,647 แผ่น");
  }
  return {
    pressed_on: formText(form, "pressed_on"),
    employee_id: formInteger(form, "employee_id", "ผู้ปั๊ม"),
    full_racks: fullRacks,
    loose_pieces: loosePieces,
    note: formText(form, "note") || null,
  };
}

export function pressingEntryPayload(form: FormData, requestId: string, data: Pick<PressingData, "orders" | "types">) {
  const orderId = formInteger(form, "order_id", "ใบสั่งผลิต");
  const order = data.orders.find((item) => item.id === orderId);
  const tile = data.types.find((item) => item.id === order?.type_id);
  if (!tile) throw new Error("ไม่พบประเภทกระเบื้องของใบสั่งผลิตที่เลือก");
  return {
    request_id: requestId,
    order_id: orderId,
    ...entryFormValues(form, tile.pieces_per_rack),
  };
}

export function openingStockPayload(form: FormData) {
  const sourceKey = formText(form, "source_key");
  if (!sourceKey) throw new Error("กรุณาระบุรหัสอ้างอิงยอดตรวจนับ");
  return {
    source_key: sourceKey,
    type_id: formInteger(form, "type_id", "ประเภทกระเบื้อง"),
    as_of: formText(form, "as_of"),
    pieces: formInteger(form, "pieces", "จำนวนแผ่นตั้งต้น"),
    ready_on: formText(form, "ready_on") || null,
    ready_confirmed: form.has("ready_confirmed"),
  };
}
