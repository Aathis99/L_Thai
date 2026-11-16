import type { Db } from '../database.js';

export async function migrateFinishing(db: Db) {
  await db.query(`
    ALTER TABLE pressing_orders
      ADD COLUMN IF NOT EXISTS customer_pieces integer CHECK (customer_pieces > 0),
      ADD COLUMN IF NOT EXISTS allowance_percent integer CHECK (allowance_percent BETWEEN 5 AND 20),
      ADD COLUMN IF NOT EXISTS allowance_pieces integer CHECK (allowance_pieces > 0),
      ADD COLUMN IF NOT EXISTS color_id integer,
      ADD COLUMN IF NOT EXISTS color_name text,
      ADD COLUMN IF NOT EXISTS pieces_per_sqm double precision,
      ADD COLUMN IF NOT EXISTS production_destination text CHECK (production_destination IN ('color','kiln')),
      ADD COLUMN IF NOT EXISTS production_clay text;

    ALTER TABLE pressing_issues ADD COLUMN IF NOT EXISTS finishing_ready boolean NOT NULL DEFAULT false;
    ALTER TABLE pressing_issues ADD COLUMN IF NOT EXISTS finishing_confirmed_pieces integer CHECK (finishing_confirmed_pieces > 0);
    ALTER TABLE pressing_issues ADD COLUMN IF NOT EXISTS finishing_clay text;
    ALTER TABLE pressing_releases ADD COLUMN IF NOT EXISTS destination_issue_id integer REFERENCES pressing_issues(id);
    ALTER TABLE pressing_stock_sources ADD COLUMN IF NOT EXISTS source_clay text;
    UPDATE pressing_stock_sources s SET source_clay=t.clay FROM pressing_types t
      WHERE t.id=s.type_id AND s.source_clay IS NULL;
    CREATE TABLE IF NOT EXISTS glazing_batches (
      id serial PRIMARY KEY,
      issue_id integer NOT NULL REFERENCES pressing_issues(id),
      worked_on date NOT NULL,
      pieces integer NOT NULL CHECK (pieces >= 0),
      pressing_waste integer NOT NULL CHECK (pressing_waste >= 0),
      glazing_waste integer NOT NULL CHECK (glazing_waste >= 0),
      good_pieces integer NOT NULL CHECK (good_pieces >= 0),
      clay text NOT NULL,
      pieces_per_sqm double precision,
      recorded_by integer NOT NULL REFERENCES users(id),
      recorded_at timestamptz NOT NULL DEFAULT now(),
      CHECK (pressing_waste::bigint + glazing_waste + good_pieces = pieces)
    );
    CREATE INDEX IF NOT EXISTS glazing_batches_issue_idx ON glazing_batches(issue_id);
    CREATE TABLE IF NOT EXISTS glazing_batch_workers (
      batch_id integer NOT NULL REFERENCES glazing_batches(id),
      employee_id integer NOT NULL REFERENCES employees(id),
      PRIMARY KEY(batch_id,employee_id)
    );
    CREATE TABLE IF NOT EXISTS finishing_requests (
      request_id text PRIMARY KEY,
      operation text NOT NULL,
      payload jsonb NOT NULL,
      result_id integer NOT NULL
    );
    CREATE OR REPLACE VIEW finishing_issues AS
      SELECT i.id,i.type_id,i.order_id,i.destination,i.finishing_ready,i.issued_at,
        o.purpose,o.customer_reference,o.customer_pieces,o.color_id,o.color_name,o.pieces_per_sqm,
        coalesce(i.finishing_clay,t.clay) AS clay,
        coalesce((SELECT sum(n.pieces) FROM pressing_net_issue_lines n WHERE n.issue_id=i.id),0)::double precision AS net_pieces,
        coalesce((SELECT sum(b.pieces) FROM glazing_batches b WHERE b.issue_id=i.id),0)::double precision AS glazed_pieces,
        i.finishing_confirmed_pieces,o.production_destination,o.production_clay
      FROM pressing_issues i JOIN pressing_types t ON t.id=i.type_id
      LEFT JOIN pressing_orders o ON o.id=i.order_id;
    CREATE TABLE IF NOT EXISTS firing_clay_ranges (
      clay text PRIMARY KEY CHECK (clay IN ('แดง','ขาว','จ้อ','สี')),
      minimum integer NOT NULL CHECK (minimum > 0),
      maximum integer NOT NULL CHECK (maximum >= minimum)
    );
    CREATE TABLE IF NOT EXISTS firing_color_ranges (
      color_id integer PRIMARY KEY,
      minimum integer NOT NULL CHECK (minimum > 0),
      maximum integer NOT NULL CHECK (maximum >= minimum)
    );
    CREATE TABLE IF NOT EXISTS firing_rounds (
      id serial PRIMARY KEY,
      kiln text NOT NULL,
      temperature integer NOT NULL CHECK (temperature > 0),
      started_on date NOT NULL,
      finished_on date CHECK (finished_on >= started_on),
      recorded_by integer NOT NULL REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS firing_loads (
      id serial PRIMARY KEY,
      round_id integer NOT NULL REFERENCES firing_rounds(id),
      issue_id integer NOT NULL REFERENCES pressing_issues(id),
      batch_id integer REFERENCES glazing_batches(id),
      type_id integer NOT NULL REFERENCES pressing_types(id),
      order_id integer NOT NULL REFERENCES pressing_orders(id),
      color_id integer,
      color_name text,
      clay text NOT NULL,
      pieces_per_sqm double precision,
      pieces integer NOT NULL CHECK (pieces >= 0)
    );
    ALTER TABLE firing_loads ADD COLUMN IF NOT EXISTS temperature_snapshot jsonb;
    CREATE INDEX IF NOT EXISTS firing_loads_round_idx ON firing_loads(round_id);
    CREATE INDEX IF NOT EXISTS firing_loads_issue_idx ON firing_loads(issue_id);
    CREATE INDEX IF NOT EXISTS firing_loads_batch_idx ON firing_loads(batch_id);
    CREATE TABLE IF NOT EXISTS firing_qc (
      id serial PRIMARY KEY,
      round_id integer NOT NULL REFERENCES firing_rounds(id),
      sorted_on date NOT NULL,
      good_pieces integer NOT NULL CHECK (good_pieces >= 0),
      waste_pieces integer NOT NULL CHECK (waste_pieces >= 0),
      recorded_by integer NOT NULL REFERENCES users(id),
      recorded_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS firing_qc_loads (
      qc_id integer NOT NULL REFERENCES firing_qc(id),
      load_id integer NOT NULL REFERENCES firing_loads(id),
      pieces integer NOT NULL CHECK (pieces > 0),
      PRIMARY KEY(qc_id,load_id)
    );
    CREATE INDEX IF NOT EXISTS firing_qc_loads_load_idx ON firing_qc_loads(load_id);
    CREATE TABLE IF NOT EXISTS firing_qc_allocations (
      id serial PRIMARY KEY,
      qc_id integer NOT NULL REFERENCES firing_qc(id),
      order_id integer NOT NULL REFERENCES pressing_orders(id),
      pieces integer NOT NULL CHECK (pieces > 0),
      recorded_by integer NOT NULL REFERENCES users(id),
      recorded_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS finished_stock_receipts (
      id serial PRIMARY KEY,
      qc_id integer NOT NULL REFERENCES firing_qc(id),
      type_id integer NOT NULL REFERENCES pressing_types(id),
      color_id integer,
      color_name text,
      pieces integer NOT NULL CHECK (pieces > 0),
      recorded_by integer NOT NULL REFERENCES users(id),
      recorded_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE firing_qc ADD COLUMN IF NOT EXISTS voided_at timestamptz;
    ALTER TABLE firing_qc_allocations ADD COLUMN IF NOT EXISTS voided_at timestamptz;
    ALTER TABLE finished_stock_receipts ADD COLUMN IF NOT EXISTS voided_at timestamptz;
    ALTER TABLE finished_stock_receipts ADD COLUMN IF NOT EXISTS clay text;
    UPDATE finished_stock_receipts r SET clay=(
      SELECT l.clay FROM firing_qc_loads x JOIN firing_loads l ON l.id=x.load_id WHERE x.qc_id=r.qc_id ORDER BY l.id LIMIT 1
    ) WHERE r.clay IS NULL;
    CREATE OR REPLACE VIEW firing_load_balances AS
      SELECT l.*,l.pieces-coalesce((SELECT sum(x.pieces) FROM firing_qc_loads x
        JOIN firing_qc q ON q.id=x.qc_id WHERE x.load_id=l.id AND q.voided_at IS NULL),0)::integer AS unsorted_pieces
      FROM firing_loads l;
    CREATE OR REPLACE VIEW finishing_order_balances AS
      SELECT o.id,o.customer_pieces,coalesce(a.pieces,0)::double precision AS ready_pieces,
        (o.customer_pieces-coalesce(a.pieces,0))::double precision AS missing_pieces
      FROM pressing_orders o LEFT JOIN (
        SELECT order_id,sum(pieces) AS pieces FROM firing_qc_allocations WHERE voided_at IS NULL GROUP BY order_id
      ) a ON a.order_id=o.id WHERE o.customer_pieces IS NOT NULL;
    CREATE OR REPLACE VIEW firing_qc_balances AS
      SELECT q.id,q.round_id,q.sorted_on,q.good_pieces,q.waste_pieces,q.recorded_by,q.recorded_at,
        coalesce(a.pieces,0)::double precision AS allocated_pieces,
        coalesce(s.pieces,0)::double precision AS stocked_pieces,
        (q.good_pieces-coalesce(a.pieces,0)-coalesce(s.pieces,0))::integer AS unallocated_pieces,
        NOT EXISTS (
          SELECT 1 FROM firing_qc_loads x JOIN firing_loads l ON l.id=x.load_id
          JOIN finishing_order_balances b ON b.id=l.order_id WHERE x.qc_id=q.id AND b.missing_pieces>0
        ) AS orders_filled,q.voided_at
      FROM firing_qc q
      LEFT JOIN (SELECT qc_id,sum(pieces) AS pieces FROM firing_qc_allocations WHERE voided_at IS NULL GROUP BY qc_id) a ON a.qc_id=q.id
      LEFT JOIN (SELECT qc_id,sum(pieces) AS pieces FROM finished_stock_receipts WHERE voided_at IS NULL GROUP BY qc_id) s ON s.qc_id=q.id;
  `);
}
