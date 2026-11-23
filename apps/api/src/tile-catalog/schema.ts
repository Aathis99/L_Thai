import {all,type Db} from '../database.js';

export async function migrateTileCatalog(db:Db){
 // Replace old CHECK expressions without invalidating existing rows midway through the transaction.
 const checks=await all(db,`WITH owned AS MATERIALIZED (
  SELECT oid,conrelid,conname FROM pg_constraint WHERE connamespace=(SELECT oid FROM pg_namespace WHERE nspname=current_schema()) AND contype='c'
 ) SELECT conrelid::regclass::text AS relation,conname,pg_get_constraintdef(oid) definition FROM owned WHERE pg_get_constraintdef(oid) LIKE '%จ้อ%'`);
 const quote=(s:string)=>'"'+s.replaceAll('"','""')+'"';
 for(const c of checks){
  await db.query(`ALTER TABLE ${c.relation} DROP CONSTRAINT ${quote(c.conname)}`);
  await db.query(`ALTER TABLE ${c.relation} ADD CONSTRAINT ${quote(c.conname)} ${c.definition.replaceAll("'จ้อ'","'ศิลาแลง'")} NOT VALID`);
 }
 for(const [table,column] of [['pressing_types','clay'],['pressing_orders','production_clay'],['pressing_stock_sources','source_clay'],['pressing_issues','finishing_clay'],['glazing_batches','clay'],['firing_loads','clay'],['firing_clay_ranges','clay'],['finished_stock_receipts','clay'],['kiln_workflow_allocations','clay']])
  await db.query(`UPDATE ${table} SET ${column}='ศิลาแลง' WHERE ${column}='จ้อ'`);
 for(const c of checks)await db.query(`ALTER TABLE ${c.relation} VALIDATE CONSTRAINT ${quote(c.conname)}`);
 await db.query(`UPDATE kiln_workflow_state SET state=jsonb_set(state,'{items}',
  coalesce((SELECT jsonb_agg(CASE WHEN item->>'clay'='จ้อ' THEN jsonb_set(item,'{clay}','"ศิลาแลง"') ELSE item END)
   FROM jsonb_array_elements(state->'items') item),'[]'::jsonb)) WHERE state->'items' @> '[{"clay":"จ้อ"}]'::jsonb;
  CREATE TABLE IF NOT EXISTS tile_bodies(
   id serial PRIMARY KEY,name text NOT NULL CHECK(btrim(name)<>''),shape text,size_1 double precision CHECK(size_1>0 AND size_1<'Infinity'),
   size_2 double precision CHECK(size_2>0 AND size_2<'Infinity'),size_unit text NOT NULL DEFAULT 'in',thickness_mm double precision CHECK(thickness_mm>0 AND thickness_mm<'Infinity'));
  CREATE TABLE IF NOT EXISTS tile_products(
   id serial PRIMARY KEY,product_code text NOT NULL CHECK(btrim(product_code)<>''),name text NOT NULL CHECK(btrim(name)<>''),shape text,
   size_1 double precision CHECK(size_1>0 AND size_1<'Infinity'),size_2 double precision CHECK(size_2>0 AND size_2<'Infinity'),size_unit text NOT NULL DEFAULT 'in',
   thickness_mm double precision CHECK(thickness_mm>0 AND thickness_mm<'Infinity'),mounting_type text CHECK(mounting_type='mesh'),
   body_id integer REFERENCES tile_bodies(id),active boolean NOT NULL DEFAULT true,
   description_raw text NOT NULL DEFAULT '',notes text,source_key text UNIQUE,source_row integer,import_fingerprint text);
  ALTER TABLE pressing_types ADD COLUMN IF NOT EXISTS body_id integer REFERENCES tile_bodies(id);
  ALTER TABLE pressing_types ALTER COLUMN width DROP NOT NULL;
  ALTER TABLE pressing_types ALTER COLUMN length DROP NOT NULL;
  DROP INDEX IF EXISTS pressing_types_body_clay_color;
  CREATE UNIQUE INDEX IF NOT EXISTS pressing_types_body_clay_identity ON pressing_types(body_id,clay,(CASE WHEN clay='สี' THEN lower(coalesce(clay_color,'')) ELSE '' END)) WHERE body_id IS NOT NULL;
  ALTER TABLE pressing_orders ADD COLUMN IF NOT EXISTS product_id integer REFERENCES tile_products(id);
  ALTER TABLE pressing_orders ADD COLUMN IF NOT EXISTS product_snapshot jsonb;
  ALTER TABLE pressing_orders ADD COLUMN IF NOT EXISTS requires_mesh boolean NOT NULL DEFAULT false;
  ALTER TABLE pressing_orders ADD COLUMN IF NOT EXISTS production_clay_color text;
  ALTER TABLE pressing_orders ADD COLUMN IF NOT EXISTS production_pieces_per_rack integer;
  ALTER TABLE pressing_orders ADD COLUMN IF NOT EXISTS production_rest_days integer;
  CREATE TABLE IF NOT EXISTS tile_mesh_entries(
   id serial PRIMARY KEY,order_id integer NOT NULL REFERENCES pressing_orders(id),pieces integer NOT NULL CHECK(pieces>0),
   lines jsonb NOT NULL,recorded_by integer NOT NULL REFERENCES users(id),recorded_at timestamptz NOT NULL DEFAULT now(),
   voided_at timestamptz,voided_by integer REFERENCES users(id),reason text);
  UPDATE pressing_orders o SET production_pieces_per_rack=coalesce(o.production_pieces_per_rack,t.pieces_per_rack),
    production_rest_days=coalesce(o.production_rest_days,t.rest_days),production_clay_color=coalesce(o.production_clay_color,t.clay_color),
    pieces_per_sqm=coalesce(o.pieces_per_sqm,t.pieces_per_sqm),production_destination=coalesce(o.production_destination,t.destination),
    production_clay=coalesce(o.production_clay,t.clay) FROM pressing_types t WHERE t.id=o.type_id;
 `);
}
