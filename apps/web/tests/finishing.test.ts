import assert from "node:assert/strict";
import { test } from "node:test";
import { finishingTileName, pendingQcLoads } from "../src/lib/finishing.ts";

test("QC accepts only the remaining loads of a finished round", () => {
  const loads = [{ id: 1, unsorted_pieces: 0 }, { id: 2, unsorted_pieces: 10 }];
  assert.deepEqual(pendingQcLoads({ finished_on: null, loads }), []);
  assert.deepEqual(pendingQcLoads({ finished_on: "2026-11-17", loads }), [loads[1]]);
});

test("glazing work labels preserve the destination product and mixed clay snapshot over current profile labels", () => {
 const types = [{ id: 1, width: 2, length: 8, clay: "สี", name: "ชื่อแบบปัจจุบัน", clay_color: "สีดินที่เปลี่ยนในทะเบียน" }];
 const label = finishingTileName(types, 1, "สี", { product_code: "QA-PAINT-1", product_name: "ลายปลายทางเดิม", production_clay_color: "น้ำเงินเดิม" });
 assert.match(label, /QA-PAINT-1 · ลายปลายทางเดิม/);
 assert.match(label, /สีที่ผสม น้ำเงินเดิม/);
 assert.doesNotMatch(label, /สีดินที่เปลี่ยนในทะเบียน/);
 assert.notEqual(label, finishingTileName(types, 1, "สี", { product_code: "QA-PAINT-2", product_name: "ลายปลายทางอื่น", production_clay_color: "น้ำเงินเดิม" }));
 assert.match(finishingTileName(types, 1, "สี"), /สีที่ผสม สีดินที่เปลี่ยนในทะเบียน/);
});
