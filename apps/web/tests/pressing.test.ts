import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bangkokDate,
  canOpenPressing,
  createPressingRequestKey,
  entryFormValues,
  openingStockPayload,
  pressingEntryPayload,
  type ProductionOrder,
  type TileType,
} from "../src/lib/pressing.ts";

const order: ProductionOrder = {
  id: 7, type_id: 4, purpose: "stock", customer_reference: null,
  target_pieces: 100, pressed_pieces: 0, short_pieces: 100, over_pieces: 0,
};
const tile: TileType = {
  id: 4, width: 10, length: 10, clay: "แดง", name: null, clay_color: null,
  pieces_per_rack: 2, rest_days: 1, destination: "kiln", pieces_per_sqm: null, active: true,
};
const catalog = { orders: [order], types: [{ ...tile, id: 3, pieces_per_rack: 1 }, tile] };

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
