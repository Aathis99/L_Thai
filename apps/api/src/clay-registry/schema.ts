import {all,type Db} from '../database.js';

const seeds=[['WHITE','ดินขาว','ขาว'],['COLORED','ดินสี','สี'],['RED','ดินแดง','แดง'],['LATERITE','ศิลาแลง','ศิลาแลง']] as const;
export async function migrateClayRegistry(db:Db):Promise<void>{
 const sources=[['pressing_types','clay'],['pressing_orders','production_clay'],['pressing_stock_sources','source_clay'],['pressing_issues','finishing_clay'],['glazing_batches','clay'],['firing_loads','clay'],['finished_stock_receipts','clay'],['firing_clay_ranges','clay'],['kiln_workflow_allocations','clay']] as const;
 for(const [table,column] of sources){
  const unknown=await all(db,`SELECT DISTINCT ${column} AS clay FROM ${table} WHERE ${column} IS NOT NULL AND ${column} NOT IN ('ขาว','สี','แดง','ศิลาแลง','จ้อ')`);
  if(unknown.length)throw new Error(`Unknown legacy clay in ${table}.${column}; explicit mapping required`);
 }
 await db.query(`CREATE TABLE IF NOT EXISTS clay_types(
  id serial PRIMARY KEY,code text NOT NULL UNIQUE CHECK(code IN ('WHITE','COLORED','RED','LATERITE')),
  name text NOT NULL CHECK(btrim(name)<>''),description text,active boolean NOT NULL DEFAULT true,
  base_clay_type_id integer REFERENCES clay_types(id) ON DELETE RESTRICT);
  CREATE TABLE IF NOT EXISTS clay_colors(
   id serial PRIMARY KEY,code text NOT NULL CHECK(btrim(code)<>''),name text NOT NULL CHECK(btrim(name)<>''),
   notes text,active boolean NOT NULL DEFAULT true);
  CREATE UNIQUE INDEX IF NOT EXISTS clay_colors_code_unique ON clay_colors(lower(code));`);
 // Set the base only when COLORED is first seeded; reruns must preserve registry edits.
 for(const [code,name] of seeds)await db.query(`INSERT INTO clay_types(code,name,base_clay_type_id)
  VALUES($1,$2,CASE WHEN $1='COLORED' THEN (SELECT id FROM clay_types WHERE code='WHITE') END)
  ON CONFLICT(code) DO NOTHING`,[code,name]);
 for(const table of ['pressing_types','pressing_orders'])await db.query(`ALTER TABLE ${table}
  ADD COLUMN IF NOT EXISTS clay_type_id integer REFERENCES clay_types(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS clay_color_id integer REFERENCES clay_colors(id) ON DELETE RESTRICT`);
 await db.query(`ALTER TABLE pressing_orders ADD COLUMN IF NOT EXISTS clay_name_snapshot text,
  ADD COLUMN IF NOT EXISTS clay_color_name_snapshot text;`);
 for(const [code,,legacy] of seeds){
  await db.query(`UPDATE pressing_types SET clay_type_id=(SELECT id FROM clay_types WHERE code=$1)
   WHERE clay_type_id IS NULL AND clay=$2`,[code,legacy]);
  await db.query(`UPDATE pressing_orders SET clay_type_id=(SELECT id FROM clay_types WHERE code=$1)
   WHERE clay_type_id IS NULL AND production_clay=$2`,[code,legacy]);
 }
 await db.query(`UPDATE pressing_orders SET clay_name_snapshot=coalesce(clay_name_snapshot,
  CASE production_clay WHEN 'ขาว' THEN 'ดินขาว' WHEN 'สี' THEN 'ดินสี' WHEN 'แดง' THEN 'ดินแดง' WHEN 'ศิลาแลง' THEN 'ศิลาแลง' END),
  clay_color_name_snapshot=coalesce(clay_color_name_snapshot,production_clay_color)
  WHERE clay_name_snapshot IS NULL OR (clay_color_name_snapshot IS NULL AND production_clay_color IS NOT NULL);
  CREATE UNIQUE INDEX IF NOT EXISTS pressing_types_registry_plain_identity ON pressing_types(body_id,clay_type_id)
   WHERE body_id IS NOT NULL AND clay_type_id IS NOT NULL AND clay_color_id IS NULL AND clay<>'สี';
  CREATE UNIQUE INDEX IF NOT EXISTS pressing_types_registry_color_identity ON pressing_types(body_id,clay_type_id,clay_color_id)
   WHERE body_id IS NOT NULL AND clay_type_id IS NOT NULL AND clay_color_id IS NOT NULL;`);
 await db.query(`DROP INDEX IF EXISTS pressing_types_body_clay_identity;
  CREATE UNIQUE INDEX IF NOT EXISTS pressing_types_legacy_body_clay_identity ON pressing_types(body_id,clay,lower(coalesce(clay_color,'')))
  WHERE body_id IS NOT NULL AND (clay_type_id IS NULL OR (clay='สี' AND clay_color_id IS NULL));`);
}
