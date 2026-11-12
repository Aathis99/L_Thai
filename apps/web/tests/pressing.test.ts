import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bangkokDate,
  canOpenPressing,
  createPressingRequestKey,
  openingStockPayload,
  pressingEntryPayload,
} from "../src/lib/pressing.ts";

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
  assert.deepEqual(pressingEntryPayload(form, requestId), expected);
  assert.deepEqual(pressingEntryPayload(form, requestId), expected);
});

test("entry forms reject malformed and out-of-range numbers before sending", () => {
  for (const value of ["", "-1", "2.5", "2e2", "2147483648"]) {
    const form = entryForm();
    form.set("full_racks", value);
    assert.throws(() => pressingEntryPayload(form, "key"), /จำนวนไม้เต็ม/);
  }
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
