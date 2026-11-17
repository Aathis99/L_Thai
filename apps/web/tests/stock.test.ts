import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleStockTabs } from "../src/lib/stock.ts";

test("stock tabs follow the existing read permissions independently", () => {
  assert.deepEqual(visibleStockTabs(["pressing.read", "finishing.read"]).map(tab => tab.id), ["pressed", "finished"]);
  assert.deepEqual(visibleStockTabs(["pressing.read"]).map(tab => tab.id), ["pressed"]);
  assert.deepEqual(visibleStockTabs(["finishing.read"]).map(tab => tab.id), ["finished"]);
  assert.deepEqual(visibleStockTabs(["pressing.issue", "finishing.stock"]), []);
});
