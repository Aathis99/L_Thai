import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleCategoryTabs } from "../src/lib/category.ts";

test("category tabs follow the agreed order", () => {
  assert.deepEqual(visibleCategoryTabs(["finishing.read", "color_chart.read", "pressing.read"]).map(tab => tab.label),
    ["ทะเบียนกระเบื้อง", "ทะเบียนประเภทดิน", "ชาร์ตสี", "ช่วงอุณหภูมิ"]);
});

test("the category offers only the pages a user can read", () => {
  assert.deepEqual(visibleCategoryTabs(["color_chart.read"]).map(tab => tab.id), ["color-chart"]);
  assert.deepEqual(visibleCategoryTabs(["finishing.read", "pressing.manage"]).map(tab => tab.id), ["ranges"]);
  assert.deepEqual(visibleCategoryTabs(["finishing.temperature", "color_chart.manage", "pressing.manage"]), []);
});
