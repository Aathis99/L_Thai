import assert from 'node:assert/strict';
import {test} from 'node:test';
import {migrate} from '../src/database.js';
import {tileFixture} from './tile-test-helpers.js';

test('clay registry seeds four identities, no pigments, and preserves edits on rerun',async t=>{
 const {pool}=await tileFixture(t);
 const types=(await pool.query('SELECT * FROM clay_types ORDER BY code')).rows;
 assert.deepEqual(types.map(x=>x.code),['COLORED','LATERITE','RED','WHITE']);
 assert.equal(types[0].base_clay_type_id,types[3].id);
 assert.equal((await pool.query('SELECT * FROM clay_colors')).rowCount,0);
 await pool.query("UPDATE clay_types SET name='ขาวชื่อใหม่',active=false WHERE code='WHITE'");
 await migrate(pool);
 const after=(await pool.query('SELECT * FROM clay_types ORDER BY code')).rows;
 assert.deepEqual(after.map(x=>x.id),types.map(x=>x.id));
 assert.equal(after[3].name,'ขาวชื่อใหม่');assert.equal(after[3].active,false);
});

test('clay migration preserves legacy pigment text and rejects unknown legacy clay atomically',async t=>{
 const {pool}=await tileFixture(t);
 const p=(await pool.query(`INSERT INTO pressing_types(width,length,clay,name,clay_color,pieces_per_rack,rest_days,destination)
 VALUES(3,3,'สี','legacy','น้ำเงินเดิม',40,0,'color') RETURNING id`)).rows[0];
 await migrate(pool);
 const row=(await pool.query('SELECT * FROM pressing_types WHERE id=$1',[p.id])).rows[0];
 assert.ok(row.clay_type_id);assert.equal(row.clay_color_id,null);assert.equal(row.clay_color,'น้ำเงินเดิม');
 assert.equal((await pool.query('SELECT * FROM clay_colors')).rowCount,0);
 const checks=(await pool.query(`SELECT conname FROM pg_constraint WHERE conrelid='pressing_types'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%clay%'`)).rows;
 for(const c of checks)await pool.query(`ALTER TABLE pressing_types DROP CONSTRAINT "${c.conname.replaceAll('"','""')}"`);
 await pool.query("UPDATE pressing_types SET clay='ไม่รู้จัก' WHERE id=$1",[p.id]);
 await assert.rejects(()=>migrate(pool),/Unknown legacy clay/);
 assert.equal((await pool.query('SELECT clay FROM pressing_types WHERE id=$1',[p.id])).rows[0].clay,'ไม่รู้จัก');
});
