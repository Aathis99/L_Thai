import assert from "node:assert/strict";
import { test } from "node:test";
import { canManageColorChart, canOpenColorChart, filterColorChart, type ColorChartItem } from "../src/lib/color-chart.ts";

const items: ColorChartItem[] = [
  { id: 12, display_order: 1, name: "ดินแดง (TERRA COTTA)", note: null, has_image: false },
  { id: 5, display_order: 2, name: "ดินแดงเคลือบใส (GLOOSSY GLAZED TERRA  COTTA)", note: null, has_image: false },
  { id: 9, display_order: 6, name: "ขาวฟ้า", note: "แยกตอนเผา", has_image: true },
];

test("searches full names case-insensitively and keeps the chart order despite extra spaces", () => {
  assert.deepEqual(filterColorChart(items, "  terra  cotta ").map((item) => item.id), [12, 5]);
});

test("searches Thai names without changing the name shown to the reader", () => {
  assert.deepEqual(filterColorChart(items, "เคลือบใส").map((item) => item.name), ["ดินแดงเคลือบใส (GLOOSSY GLAZED TERRA  COTTA)"]);
});

test("an empty search keeps all entries in chart order", () => {
  assert.deepEqual(filterColorChart(items, " \t ").map((item) => item.id), [12, 5, 9]);
});

test("reading requires view permission and editing requires both permissions", () => {
  assert.equal(canOpenColorChart(["color_chart.manage"]), false);
  assert.equal(canOpenColorChart(["color_chart.read"]), true);
  assert.equal(canManageColorChart(["color_chart.read"]), false);
  assert.equal(canManageColorChart(["color_chart.manage"]), false);
  assert.equal(canManageColorChart(["color_chart.read", "color_chart.manage"]), true);
});
