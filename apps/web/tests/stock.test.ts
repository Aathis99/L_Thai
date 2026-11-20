import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleStockTabs, finishedStockTotals } from "../src/lib/stock.ts";

test("stock tabs follow the existing read permissions independently", () => {
  assert.deepEqual(visibleStockTabs(["pressing.read", "finishing.read"]).map(tab => tab.id), ["pressed", "finished"]);
  assert.deepEqual(visibleStockTabs(["pressing.read"]).map(tab => tab.id), ["pressed"]);
  assert.deepEqual(visibleStockTabs(["finishing.read"]).map(tab => tab.id), ["finished"]);
  assert.deepEqual(visibleStockTabs(["pressing.issue", "finishing.stock"]), []);
});

test('finished stock keeps grades and unnamed colors separate and excludes reversed receipts',()=>{
 const base={type_id:1,clay:'ขาว',color_id:2,color_name:'ฟ้า'};
 const totals=finishedStockTotals([{...base,grade:'A+',pieces:10},{...base,grade:'A-',pieces:5},{...base,grade:'A+',pieces:2},
  {...base,grade:null,pieces:7},{...base,grade:'A+',pieces:100,voided_at:'2026-11-20'},
  {...base,color_id:null,color_name:'เขียว',grade:'A+',pieces:3},{...base,color_id:null,color_name:'แดง',grade:'A+',pieces:4}]);
 assert.deepEqual(totals.map(x=>[x.color_name,x.grade,x.pieces]),[['ฟ้า','A+',12],['ฟ้า','A-',5],['ฟ้า',null,7],['เขียว','A+',3],['แดง','A+',4]]);
});
