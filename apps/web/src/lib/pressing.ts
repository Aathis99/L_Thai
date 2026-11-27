import { formatEmployeeName, type EmployeeNameParts } from "./employee-names.ts";
import type { CatalogState } from "./tile-catalog.ts";

export type Destination = "color" | "kiln";
export type Allocation = "general" | "order";

export interface TileType {
  id: number;
  width: number | null;
  length: number | null;
  body_id?: number | null;
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
  customer_pieces?: number | null;
  allowance_pieces?: number | null;
  allowance_percent?: number | null;
  color_name?: string | null;
  target_square_meters?: number | null;
  production_clay?: string | null;
  clay_name_snapshot?:string|null;
  clay_color_name_snapshot?:string|null;
  production_clay_color?: string | null;
  production_pieces_per_rack?: number | null;
  production_rest_days?: number | null;
  production_destination?: Destination | null;
  pieces_per_sqm?: number | null;
  product_id?: number | null;
  product_name?: string | null;
  product_code?: string | null;
  product_snapshot?: { name?: string; product_code?: string; shape?: string | null; size_1?: number; size_2?: number | null;
    size_unit?: string; thickness_mm?: number | null; mounting_type?: string | null } | null;
  requires_mesh?: boolean;
  pressed_pieces: number;
  short_pieces: number;
  over_pieces: number;
  has_entries: boolean;
  has_issues: boolean;
}

export interface PressingWorker extends EmployeeNameParts {
  id: number;
  code: string;
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
  rest_days?: number;
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
  transferable_pieces: number;
  source_clay: string | null;
}

export interface IssueLine {
  id: number;
  source_id: number;
  pieces: number;
  allocation: Allocation;
}

export interface StockIssue {
  finishing_ready?: boolean;
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

export interface PressingData {
  catalog?: CatalogState;
  colors: { id: number; name: string }[];
  types: TileType[];
  orders: ProductionOrder[];
  workers: PressingWorker[];
  entries: PressingEntry[];
  stock: StockSource[];
  issues: StockIssue[];
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
  const dimensions = [tile.width, tile.length].filter(value => value !== null).join(" × ") || "ไม่ระบุขนาด";
  const description = `${dimensions} · ดิน${tile.clay}${tile.clay_color ? ` · สีที่ผสม ${tile.clay_color}` : ""}`;
  return tile.name ? `${tile.name} · ${description}` : description;
}

export function orderName(order: ProductionOrder): string {
  return `ใบสั่ง #${order.id} · ${order.customer_reference ?? orderPurposes[order.purpose]}`;
}

export function workerName(data: PressingData, id: number): string {
  const worker = data.workers.find((worker) => worker.id === id);
  return (worker ? formatEmployeeName(worker) : undefined)
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
    ...entryFormValues(form, order?.production_pieces_per_rack ?? tile.pieces_per_rack),
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

export type OrderProgressStatus = "short" | "complete" | "over";

export const orderProgressLabels: Record<OrderProgressStatus, string> = {
  short: "ยังไม่ครบ",
  complete: "ครบตามสั่ง",
  over: "ปั๊มเกิน",
};

export function orderProgressStatus(order: Pick<ProductionOrder, "short_pieces" | "over_pieces">): OrderProgressStatus {
  if (order.short_pieces > 0) return "short";
  if (order.over_pieces > 0) return "over";
  return "complete";
}

export function pressingKpi(
  orders: readonly ProductionOrder[],
  entries: readonly PressingEntry[],
  today = bangkokDate(),
) {
  let incompleteOrders = 0;
  let totalShortPieces = 0;
  let customerOrders = 0;
  let stockOrders = 0;
  for (const order of orders) {
    if (order.short_pieces > 0) {
      incompleteOrders++;
      totalShortPieces += order.short_pieces;
    }
    if (order.purpose === "customer") customerOrders++;
    else stockOrders++;
  }
  let todayPieces = 0;
  let totalPressedPieces = 0;
  for (const entry of entries) {
    totalPressedPieces += entry.pieces;
    if (entry.pressed_on === today) todayPieces += entry.pieces;
  }
  return {
    incompleteOrders,
    totalShortPieces,
    todayPieces,
    totalPressedPieces,
    totalEntries: entries.length,
    totalOrders: orders.length,
    customerOrders,
    stockOrders,
  };
}

function normalizedText(parts: readonly (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ").toLocaleLowerCase("th");
}

export function filterAndSortOrders(
  orders: readonly ProductionOrder[],
  types: readonly TileType[],
  filters: { search: string; purpose: "" | "customer" | "stock"; status: "" | OrderProgressStatus },
): ProductionOrder[] {
  const query = filters.search.trim().toLocaleLowerCase("th");
  return orders
    .filter((order) => {
      if (filters.purpose && order.purpose !== filters.purpose) return false;
      if (filters.status && orderProgressStatus(order) !== filters.status) return false;
      if (!query) return true;
      const haystack = normalizedText([
        orderName(order),
        order.customer_reference,
        order.product_code,
        order.product_name,
        order.clay_name_snapshot,
        order.production_clay,
        order.clay_color_name_snapshot,
        order.production_clay_color,
        order.color_name,
        tileName(types, order.type_id),
      ]);
      return haystack.includes(query);
    })
    .sort((a, b) => {
      const aShort = a.short_pieces > 0 ? 0 : 1;
      const bShort = b.short_pieces > 0 ? 0 : 1;
      if (aShort !== bShort) return aShort - bShort;
      return b.id - a.id;
    });
}

export function filterEntries(
  entries: readonly PressingEntry[],
  orders: readonly ProductionOrder[],
  types: readonly TileType[],
  filters: { search: string; orderId: string; from: string; to: string },
): PressingEntry[] {
  const query = filters.search.trim().toLocaleLowerCase("th");
  const orderId = filters.orderId ? Number(filters.orderId) : null;
  const orderMap = new Map(orders.map((order) => [order.id, order]));
  return entries
    .filter((entry) => {
      if (orderId !== null && entry.order_id !== orderId) return false;
      if (filters.from && entry.pressed_on < filters.from) return false;
      if (filters.to && entry.pressed_on > filters.to) return false;
      if (!query) return true;
      const order = orderMap.get(entry.order_id);
      const haystack = normalizedText([
        `#${entry.id}`,
        entry.employee_name,
        entry.note,
        order ? orderName(order) : null,
        order?.customer_reference,
        order?.product_code,
        order?.product_name,
        order ? tileName(types, order.type_id) : null,
      ]);
      return haystack.includes(query);
    })
    .sort((a, b) => b.id - a.id);
}

export function restEndDate(pressedOn: string, restDays: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pressedOn) || !Number.isInteger(restDays) || restDays < 0) return null;
  const date = new Date(`${pressedOn}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== pressedOn) return null;
  date.setUTCDate(date.getUTCDate() + restDays);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() > 9999) return null;
  return date.toISOString().slice(0, 10);
}

function parseNonNegativeInt(value: string, blankIsZero: boolean): number | null {
  const text = value.trim();
  if (text === "") return blankIsZero ? 0 : null;
  if (!/^\d+$/.test(text)) return null;
  const parsed = Number(text);
  return parsed <= maxPressingInteger ? parsed : null;
}

export function previewPressingEntry(input: {
  order?: ProductionOrder;
  tile?: TileType;
  pressedOn: string;
  fullRacks: string;
  loosePieces: string;
  piecesPerRackOverride?: number;
  restDaysOverride?: number;
  previousPieces?: number;
}) {
  const piecesPerRack = input.piecesPerRackOverride ?? input.order?.production_pieces_per_rack ?? input.tile?.pieces_per_rack ?? null;
  const restDays = input.restDaysOverride ?? input.order?.production_rest_days ?? input.tile?.rest_days ?? null;
  const piecesPerSqm = input.order?.pieces_per_sqm ?? input.tile?.pieces_per_sqm ?? null;
  const racks = parseNonNegativeInt(input.fullRacks, false);
  const loose = parseNonNegativeInt(input.loosePieces, true);
  let pieces: number | null = null;
  if (piecesPerRack !== null && racks !== null && loose !== null) {
    const total = racks * piecesPerRack + loose;
    if (total >= 1 && total <= maxPressingInteger) pieces = total;
  }
  const readyOn = restDays !== null ? restEndDate(input.pressedOn, restDays) : null;
  const squareMeters = pieces !== null && piecesPerSqm ? pieces / piecesPerSqm : null;
  const projectedOrderPieces = input.order && pieces !== null
    ? input.order.pressed_pieces - (input.previousPieces ?? 0) + pieces
    : null;
  const projectedDiff = input.order && projectedOrderPieces !== null
    ? projectedOrderPieces - input.order.target_pieces
    : null;
  return { pieces, piecesPerRack, restDays, readyOn, squareMeters, projectedOrderPieces, projectedDiff };
}
