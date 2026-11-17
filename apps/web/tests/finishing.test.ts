import assert from "node:assert/strict";
import { test } from "node:test";
import { pendingQcLoads } from "../src/lib/finishing.ts";

test("QC accepts only the remaining loads of a finished round", () => {
  const loads = [{ id: 1, unsorted_pieces: 0 }, { id: 2, unsorted_pieces: 10 }];
  assert.deepEqual(pendingQcLoads({ finished_on: null, loads }), []);
  assert.deepEqual(pendingQcLoads({ finished_on: "2026-11-17", loads }), [loads[1]]);
});
