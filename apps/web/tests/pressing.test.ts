import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bangkokDate,
  canOpenPressing,
  createPressingRequestKey,
  entryFormValues,
  filterAndSortOrders,
  filterEntries,
  openingStockPayload,
  orderProgressStatus,
  pressingEntryPayload,
  pressingKpi,
  previewPressingEntry,
  restEndDate,
  workerName,
  tileName,
  type PressingData,
  type PressingEntry,
  type ProductionOrder,
  type TileType,
} from "../src/lib/pressing.ts";

const order: ProductionOrder = {
  id: 7, type_id: 4, purpose: "stock", customer_reference: null,
  target_pieces: 100, pressed_pieces: 0, short_pieces: 100, over_pieces: 0, has_entries: false, has_issues: false,
};
const tile: TileType = {
  id: 4, width: 10, length: 10, clay: "แดง", name: null, clay_color: null,
  pieces_per_rack: 2, rest_days: 1, destination: "kiln", pieces_per_sqm: null, active: true,
};
const catalog = { orders: [order], types: [{ ...tile, id: 3, pieces_per_rack: 1 }, tile] };

test("single dimension and unknown geometry never display a fabricated dimension", () => {
 assert.equal(tileName([{ ...tile, width: 2, length: null }], tile.id), "2 · ดินแดง");
 assert.equal(tileName([{ ...tile, width: null, length: null }], tile.id), "ไม่ระบุขนาด · ดินแดง");
});

test("new pressing entries validate rack counts using the order snapshot", () => {
 const form = entryForm();
 form.set("full_racks", "1073741824");
 assert.throws(() => pressingEntryPayload(form, "key", { ...catalog,
  orders: [{ ...order, production_pieces_per_rack: 3 }] }), /ยอดปั๊ม/);
 assert.equal(pressingEntryPayload(form, "key", { ...catalog,
  orders: [{ ...order, production_pieces_per_rack: 1 }] }).full_racks, 1073741824);
});

test("worker labels compose structured names and retain historical entry fallback", () => {
  const data: PressingData = {
    colors: [], types: [], orders: [], stock: [], issues: [],
    workers: [{ id: 19, code: "E019", prefix: "Dr.", first_name: "Jean Pierre", last_name: "de la Cruz" }],
    entries: [{ id: 1, order_id: 7, employee_id: 20, employee_name: "สมใจ เก่า", pressed_on: "2026-11-11",
      full_racks: 1, loose_pieces: 0, note: null, ready_on: "2026-11-12", pieces: 2, original_pieces: 2,
      pieces_per_rack: 2, square_meters: null, recorded_by_username: "office", recorded_at: "2026-11-11T01:00:00Z" }],
  };
  assert.equal(workerName(data, 19), "Dr. Jean Pierre de la Cruz");
  assert.equal(workerName(data, 20), "สมใจ เก่า");
  assert.equal(workerName(data, 21), "พนักงาน #21");
});

function entryForm() {
  const form = new FormData();
  form.set("order_id", "7");
  form.set("employee_id", "19");
  form.set("pressed_on", "2026-11-11");
  form.set("full_racks", "2");
  form.set("loose_pieces", "");
  form.set("note", "  ทดสอบ  ");
  return form;
}

test("the pressing menu requires pressing read permission", () => {
  assert.equal(canOpenPressing(["employees.read"]), false);
  assert.equal(canOpenPressing(["pressing.read"]), true);
});

test("entry forms send zero for blank loose pieces and retain the request key", () => {
  const form = entryForm();
  const requestId = "entry-confirmation-key";
  const expected = {
    request_id: requestId,
    order_id: 7,
    employee_id: 19,
    pressed_on: "2026-11-11",
    full_racks: 2,
    loose_pieces: 0,
    note: "ทดสอบ",
  };
  assert.deepEqual(pressingEntryPayload(form, requestId, catalog), expected);
  assert.deepEqual(pressingEntryPayload(form, requestId, catalog), expected);
});

test("entry forms reject malformed and out-of-range numbers before sending", () => {
  for (const value of ["", "-1", "2.5", "2e2", "2147483648"]) {
    const form = entryForm();
    form.set("full_racks", value);
    assert.throws(() => pressingEntryPayload(form, "key", catalog), /จำนวนไม้เต็ม/);
  }
});

test("new entries reject a zero total", () => {
  const form = entryForm();
  form.set("full_racks", "0");
  assert.throws(() => pressingEntryPayload(form, "key", catalog), /ยอดปั๊ม/);
});

test("new entries validate the computed total using the selected order's tile type", () => {
  const form = entryForm();
  form.set("full_racks", "1073741823");
  form.set("loose_pieces", "1");
  assert.equal(pressingEntryPayload(form, "key", catalog).loose_pieces, 1);
  form.set("loose_pieces", "2");
  assert.throws(() => pressingEntryPayload(form, "key", catalog), /ยอดปั๊ม/);
});

test("entry edits reject a zero total", () => {
  const form = entryForm();
  form.set("full_racks", "0");
  assert.throws(() => entryFormValues(form, 1), /ยอดปั๊ม/);
});

test("entry edits validate the computed total using the entry's saved pieces per rack", () => {
  const form = entryForm();
  form.set("full_racks", "2147483647");
  assert.equal(entryFormValues(form, 1).full_racks, 2147483647);
  assert.throws(() => entryFormValues(form, 2), /ยอดปั๊ม/);
});

test("request keys use secure random bytes without requiring randomUUID", () => {
  const random = {
    getRandomValues(bytes: Uint8Array) {
      return bytes.fill(42);
    },
  };
  assert.equal(createPressingRequestKey(random), "2a".repeat(16));
});

test("date defaults roll over at midnight in Bangkok", () => {
  assert.equal(bangkokDate(new Date("2026-11-10T16:59:59Z")), "2026-11-10");
  assert.equal(bangkokDate(new Date("2026-11-10T17:00:00Z")), "2026-11-11");
});

test("opening balances require the verified source reference and reuse it on re-entry", () => {
  function openingForm(reference: string) {
    const form = new FormData();
    form.set("source_key", reference);
    form.set("type_id", "4");
    form.set("as_of", "2026-11-11");
    form.set("pieces", "100");
    return form;
  }
  assert.deepEqual(openingStockPayload(openingForm("  นับ-2026-11-11-A  ")), {
    source_key: "นับ-2026-11-11-A",
    type_id: 4,
    as_of: "2026-11-11",
    pieces: 100,
    ready_on: null,
    ready_confirmed: false,
  });
  assert.equal(openingStockPayload(openingForm("นับ-2026-11-11-A")).source_key, "นับ-2026-11-11-A");
  assert.throws(() => openingStockPayload(openingForm(" ")), /รหัสอ้างอิงยอดตรวจนับ/);
});

test("orderProgressStatus classifies short, complete, and over orders", () => {
  assert.equal(orderProgressStatus({ ...order, short_pieces: 10, over_pieces: 0 }), "short");
  assert.equal(orderProgressStatus({ ...order, short_pieces: 0, over_pieces: 0 }), "complete");
  assert.equal(orderProgressStatus({ ...order, short_pieces: 0, over_pieces: 5 }), "over");
});

test("pressingKpi aggregates incomplete orders, today pressed pieces, and purpose split", () => {
  const orders: ProductionOrder[] = [
    { ...order, id: 1, purpose: "customer", target_pieces: 100, pressed_pieces: 40, short_pieces: 60, over_pieces: 0 },
    { ...order, id: 2, purpose: "customer", target_pieces: 200, pressed_pieces: 200, short_pieces: 0, over_pieces: 0 },
    { ...order, id: 3, purpose: "stock", target_pieces: 50, pressed_pieces: 10, short_pieces: 40, over_pieces: 0 },
  ];
  const entries: PressingEntry[] = [
    { id: 1, order_id: 1, employee_id: 1, employee_name: "สมชาย", pressed_on: "2026-11-27", full_racks: 20, loose_pieces: 0,
      note: null, ready_on: "2026-11-28", pieces: 40, original_pieces: 40, pieces_per_rack: 2, square_meters: null,
      recorded_by_username: "u", recorded_at: "2026-11-27T01:00:00Z" },
    { id: 2, order_id: 2, employee_id: 2, employee_name: "วิไล", pressed_on: "2026-11-26", full_racks: 100, loose_pieces: 0,
      note: null, ready_on: "2026-11-27", pieces: 200, original_pieces: 200, pieces_per_rack: 2, square_meters: null,
      recorded_by_username: "u", recorded_at: "2026-11-26T01:00:00Z" },
    { id: 3, order_id: 3, employee_id: 1, employee_name: "สมชาย", pressed_on: "2026-11-27", full_racks: 5, loose_pieces: 0,
      note: null, ready_on: "2026-11-28", pieces: 10, original_pieces: 10, pieces_per_rack: 2, square_meters: null,
      recorded_by_username: "u", recorded_at: "2026-11-27T02:00:00Z" },
  ];
  assert.deepEqual(pressingKpi(orders, entries, "2026-11-27"), {
    incompleteOrders: 2,
    totalShortPieces: 100,
    todayPieces: 50,
    totalPressedPieces: 250,
    totalEntries: 3,
    totalOrders: 3,
    customerOrders: 2,
    stockOrders: 1,
  });
});

test("filterAndSortOrders places incomplete orders first newest-first and filters by query, purpose, and status", () => {
  const orders: ProductionOrder[] = [
    { ...order, id: 1, purpose: "customer", customer_reference: "OD-001", product_code: "LT-411", product_name: "หกเหลี่ยม", short_pieces: 0, over_pieces: 0 },
    { ...order, id: 2, purpose: "stock", customer_reference: "OS-002", short_pieces: 50, over_pieces: 0 },
    { ...order, id: 3, purpose: "customer", customer_reference: "OD-003", product_code: "LT-205", product_name: "สี่เหลี่ยม", short_pieces: 20, over_pieces: 0 },
    { ...order, id: 4, purpose: "customer", customer_reference: "OD-004", short_pieces: 0, over_pieces: 15 },
  ];
  const allSorted = filterAndSortOrders(orders, [tile], { search: "", purpose: "", status: "" });
  assert.deepEqual(allSorted.map((item) => item.id), [3, 2, 4, 1]);
  assert.deepEqual(
    filterAndSortOrders(orders, [tile], { search: "lt-411", purpose: "customer", status: "complete" }).map((item) => item.id),
    [1],
  );
  assert.deepEqual(
    filterAndSortOrders(orders, [tile], { search: "", purpose: "", status: "over" }).map((item) => item.id),
    [4],
  );
});

test("filterEntries returns newest first and filters by search, orderId, and pressed_on range", () => {
  const orders: ProductionOrder[] = [
    { ...order, id: 10, purpose: "customer", customer_reference: "OD-010", product_code: "LT-411" },
    { ...order, id: 11, purpose: "stock", customer_reference: "OS-011" },
  ];
  const entries: PressingEntry[] = [
    { id: 1, order_id: 10, employee_id: 1, employee_name: "สมชาย ใจดี", pressed_on: "2026-11-25", full_racks: 10, loose_pieces: 0,
      note: "รอบเช้า", ready_on: "2026-11-28", pieces: 20, original_pieces: 20, pieces_per_rack: 2, square_meters: null,
      recorded_by_username: "u", recorded_at: "2026-11-25T01:00:00Z" },
    { id: 2, order_id: 11, employee_id: 2, employee_name: "วิไล รักงาน", pressed_on: "2026-11-26", full_racks: 15, loose_pieces: 1,
      note: "เร่งด่วน", ready_on: "2026-11-29", pieces: 31, original_pieces: 31, pieces_per_rack: 2, square_meters: null,
      recorded_by_username: "u", recorded_at: "2026-11-26T01:00:00Z" },
    { id: 3, order_id: 10, employee_id: 1, employee_name: "สมชาย ใจดี", pressed_on: "2026-11-27", full_racks: 5, loose_pieces: 0,
      note: null, ready_on: "2026-11-30", pieces: 10, original_pieces: 10, pieces_per_rack: 2, square_meters: null,
      recorded_by_username: "u", recorded_at: "2026-11-27T01:00:00Z" },
  ];
  assert.deepEqual(
    filterEntries(entries, orders, [tile], { search: "", orderId: "", from: "", to: "" }).map((e) => e.id),
    [3, 2, 1],
  );
  assert.deepEqual(
    filterEntries(entries, orders, [tile], { search: "สมชาย", orderId: "10", from: "2026-11-26", to: "2026-11-27" }).map((e) => e.id),
    [3],
  );
  assert.deepEqual(
    filterEntries(entries, orders, [tile], { search: "เร่งด่วน", orderId: "", from: "", to: "" }).map((e) => e.id),
    [2],
  );
});

test("restEndDate matches API UTC date addition and rejects invalid calendar dates", () => {
  assert.equal(restEndDate("2026-11-27", 3), "2026-11-30");
  assert.equal(restEndDate("2026-02-27", 3), "2026-03-02");
  assert.equal(restEndDate("2026-02-31", 1), null);
  assert.equal(restEndDate("", 2), null);
});

test("previewPressingEntry computes pieces, readyOn, sqm, and projected order balance", () => {
  const targetOrder: ProductionOrder = {
    ...order, id: 12, target_pieces: 100, pressed_pieces: 40, short_pieces: 60, over_pieces: 0,
    production_pieces_per_rack: 24, production_rest_days: 3, pieces_per_sqm: 10,
  };
  const preview = previewPressingEntry({
    order: targetOrder,
    tile,
    pressedOn: "2026-11-27",
    fullRacks: "2",
    loosePieces: "4",
  });
  assert.deepEqual(preview, {
    pieces: 52,
    piecesPerRack: 24,
    restDays: 3,
    readyOn: "2026-11-30",
    squareMeters: 5.2,
    projectedOrderPieces: 92,
    projectedDiff: -8,
  });

  // Edit mode subtracts previousPieces before adding new pieces and respects piecesPerRackOverride
  const editPreview = previewPressingEntry({
    order: targetOrder,
    tile,
    pressedOn: "2026-11-27",
    fullRacks: "3",
    loosePieces: "",
    piecesPerRackOverride: 20,
    previousPieces: 40,
  });
  assert.deepEqual(editPreview, {
    pieces: 60,
    piecesPerRack: 20,
    restDays: 3,
    readyOn: "2026-11-30",
    squareMeters: 6,
    projectedOrderPieces: 60,
    projectedDiff: -40,
  });
});
