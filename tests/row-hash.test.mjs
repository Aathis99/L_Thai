import assert from 'node:assert/strict';
import {test} from 'node:test';
test('row hashes ignore object column order but detect changed values and row order',async()=>{
  let hashRows;try{({hashRows}=await import('../scripts/lib/row-hash.mjs'))}catch{}
  assert.equal(typeof hashRows,'function');
  const rows=[{id:1,code:'x',meta:{b:2,a:1},at:new Date('2026-01-01T00:00:00Z')},{id:2}];
  assert.equal(hashRows(rows),hashRows([{at:'2026-01-01T00:00:00.000Z',meta:{a:1,b:2},code:'x',id:1},{id:2}]));
  assert.notEqual(hashRows(rows),hashRows([{...rows[0],code:'y'},rows[1]]));
  assert.notEqual(hashRows(rows),hashRows([...rows].reverse()));
});
