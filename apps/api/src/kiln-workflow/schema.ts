import type {Db} from '../database.js';
import {emptyState} from '../kiln-prototype/model.js';

export async function migrateKilnWorkflow(db:Db){
 await db.query(`
  CREATE TABLE IF NOT EXISTS kiln_workflow_state(id integer PRIMARY KEY CHECK(id=1),revision integer NOT NULL,state jsonb NOT NULL);
  CREATE TABLE IF NOT EXISTS kiln_workflow_events(
   id serial PRIMARY KEY,request_id text NOT NULL UNIQUE,payload jsonb NOT NULL,revision integer NOT NULL,
   actor text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),before_state jsonb NOT NULL,after_state jsonb NOT NULL);
  CREATE TABLE IF NOT EXISTS firing_shape_ranges(type_id integer PRIMARY KEY REFERENCES pressing_types(id),minimum integer NOT NULL CHECK(minimum>0),maximum integer NOT NULL CHECK(maximum>=minimum));
  CREATE TABLE IF NOT EXISTS kiln_order_grade_policies(order_id integer PRIMARY KEY REFERENCES pressing_orders(id),accepted jsonb NOT NULL);
  CREATE TABLE IF NOT EXISTS kiln_workflow_sources(source_id text PRIMARY KEY,order_id integer NOT NULL UNIQUE REFERENCES pressing_orders(id),type_id integer NOT NULL REFERENCES pressing_types(id));
  CREATE TABLE IF NOT EXISTS kiln_workflow_debits(
   id serial PRIMARY KEY,reservation_id integer NOT NULL,source_id text NOT NULL REFERENCES kiln_workflow_sources(source_id),
   issue_id integer NOT NULL REFERENCES pressing_issues(id),batch_id integer REFERENCES glazing_batches(id),
   pieces integer NOT NULL CHECK(pieces>0),status text NOT NULL CHECK(status IN('reserved','loaded')),
   UNIQUE NULLS NOT DISTINCT(reservation_id,issue_id,batch_id));
  CREATE INDEX IF NOT EXISTS kiln_workflow_debits_batch ON kiln_workflow_debits(batch_id);
  CREATE INDEX IF NOT EXISTS kiln_workflow_debits_issue ON kiln_workflow_debits(issue_id);
  CREATE TABLE IF NOT EXISTS kiln_workflow_allocations(
   id integer PRIMARY KEY,qc_id integer NOT NULL,order_id integer NOT NULL REFERENCES pressing_orders(id),type_id integer NOT NULL REFERENCES pressing_types(id),
   clay text NOT NULL,color_id integer,color_name text,grade text NOT NULL CHECK(grade IN('A+','A-','B')),
   destination text NOT NULL CHECK(destination IN('order','stock')),pieces integer NOT NULL CHECK(pieces>0),
   recorded_at timestamptz NOT NULL,recorded_by integer NOT NULL REFERENCES users(id));
  CREATE OR REPLACE VIEW finishing_order_balances AS
   SELECT o.id,o.customer_pieces,coalesce(a.pieces,0)::double precision AS ready_pieces,
    (o.customer_pieces-coalesce(a.pieces,0))::double precision AS missing_pieces
   FROM pressing_orders o LEFT JOIN (
    SELECT order_id,sum(pieces) AS pieces FROM (
     SELECT order_id,pieces FROM firing_qc_allocations WHERE voided_at IS NULL
     UNION ALL SELECT order_id,pieces FROM kiln_workflow_allocations WHERE destination='order'
    ) allocations GROUP BY order_id
   ) a ON a.order_id=o.id WHERE o.customer_pieces IS NOT NULL;
 `);
 await db.query('INSERT INTO kiln_workflow_state VALUES(1,0,$1) ON CONFLICT DO NOTHING',[JSON.stringify(emptyState())]);
}
