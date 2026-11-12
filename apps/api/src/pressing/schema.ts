import type { Db } from '../database.js';

export async function migratePressing(db: Db): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS pressing_types (
      id SERIAL PRIMARY KEY,
      width DOUBLE PRECISION NOT NULL CHECK (width > 0 AND width < 'Infinity'),
      length DOUBLE PRECISION NOT NULL CHECK (length > 0 AND length < 'Infinity'),
      clay TEXT NOT NULL CHECK (clay IN ('แดง', 'ขาว', 'จ้อ', 'สี')),
      name TEXT,
      clay_color TEXT,
      pieces_per_rack INTEGER NOT NULL CHECK (pieces_per_rack > 0),
      rest_days INTEGER NOT NULL CHECK (rest_days >= 0),
      destination TEXT NOT NULL CHECK (destination IN ('color', 'kiln')),
      pieces_per_sqm DOUBLE PRECISION CHECK (pieces_per_sqm > 0 AND pieces_per_sqm < 'Infinity'),
      active BOOLEAN NOT NULL DEFAULT true
    );
    CREATE TABLE IF NOT EXISTS pressing_orders (
      id SERIAL PRIMARY KEY,
      type_id INTEGER NOT NULL REFERENCES pressing_types(id),
      target_pieces INTEGER NOT NULL CHECK (target_pieces > 0),
      purpose TEXT NOT NULL CHECK (purpose IN ('customer', 'stock')),
      customer_reference TEXT,
      CHECK (purpose <> 'customer' OR NULLIF(btrim(customer_reference), '') IS NOT NULL)
    );
    CREATE INDEX IF NOT EXISTS pressing_orders_type_id_idx ON pressing_orders(type_id);

    CREATE TABLE IF NOT EXISTS pressing_entries (
      id SERIAL PRIMARY KEY,
      request_id TEXT NOT NULL UNIQUE,
      order_id INTEGER NOT NULL REFERENCES pressing_orders(id),
      pressed_on DATE NOT NULL,
      employee_id INTEGER NOT NULL REFERENCES employees(id),
      full_racks INTEGER NOT NULL CHECK (full_racks >= 0),
      loose_pieces INTEGER NOT NULL CHECK (loose_pieces >= 0),
      note TEXT,
      pieces INTEGER NOT NULL CHECK (pieces > 0),
      pieces_per_rack INTEGER NOT NULL CHECK (pieces_per_rack > 0),
      rest_days INTEGER NOT NULL CHECK (rest_days >= 0),
      pieces_per_sqm DOUBLE PRECISION CHECK (pieces_per_sqm > 0 AND pieces_per_sqm < 'Infinity'),
      square_meters DOUBLE PRECISION CHECK (square_meters >= 0 AND square_meters < 'Infinity'),
      recorded_by INTEGER NOT NULL REFERENCES users(id),
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS pressing_entries_order_id_idx ON pressing_entries(order_id);

    CREATE TABLE IF NOT EXISTS pressing_stock_sources (
      id SERIAL PRIMARY KEY,
      type_id INTEGER NOT NULL REFERENCES pressing_types(id),
      entry_id INTEGER UNIQUE REFERENCES pressing_entries(id),
      source_key TEXT UNIQUE,
      as_of DATE,
      opening_pieces INTEGER CHECK (opening_pieces > 0),
      ready_on DATE,
      ready_confirmed BOOLEAN,
      destination TEXT NOT NULL CHECK (destination IN ('color', 'kiln')),
      CHECK (
        (entry_id IS NOT NULL AND source_key IS NULL AND as_of IS NULL
          AND opening_pieces IS NULL AND ready_confirmed IS NULL AND ready_on IS NOT NULL)
        OR
        (entry_id IS NULL AND source_key IS NOT NULL AND as_of IS NOT NULL
          AND opening_pieces IS NOT NULL AND ready_confirmed IS NOT NULL)
      )
    );
    CREATE INDEX IF NOT EXISTS pressing_stock_sources_type_id_idx ON pressing_stock_sources(type_id);
    ALTER TABLE pressing_stock_sources ADD COLUMN IF NOT EXISTS ready_confirmed_later BOOLEAN NOT NULL DEFAULT false
      CHECK (NOT ready_confirmed_later OR (entry_id IS NULL AND ready_on IS NULL));

    CREATE TABLE IF NOT EXISTS pressing_issues (
      id SERIAL PRIMARY KEY,
      request_id TEXT NOT NULL UNIQUE,
      request_payload JSONB NOT NULL,
      type_id INTEGER NOT NULL REFERENCES pressing_types(id),
      order_id INTEGER REFERENCES pressing_orders(id),
      destination TEXT NOT NULL CHECK (destination IN ('color', 'kiln')),
      confirmed_ready BOOLEAN NOT NULL CHECK (confirmed_ready),
      pooled BOOLEAN NOT NULL DEFAULT false,
      issued_by INTEGER NOT NULL REFERENCES users(id),
      issued_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS pressing_issue_lines (
      id SERIAL PRIMARY KEY,
      issue_id INTEGER NOT NULL REFERENCES pressing_issues(id),
      source_id INTEGER NOT NULL REFERENCES pressing_stock_sources(id),
      pieces INTEGER NOT NULL CHECK (pieces > 0),
      allocation TEXT NOT NULL CHECK (allocation IN ('general', 'order')),
      UNIQUE (issue_id, source_id, allocation)
    );
    CREATE INDEX IF NOT EXISTS pressing_issue_lines_source_id_idx ON pressing_issue_lines(source_id);
    CREATE TABLE IF NOT EXISTS pressing_releases (
      id SERIAL PRIMARY KEY,
      request_id TEXT NOT NULL UNIQUE,
      source_id INTEGER NOT NULL REFERENCES pressing_stock_sources(id),
      pieces INTEGER NOT NULL CHECK (pieces > 0),
      released_by INTEGER NOT NULL REFERENCES users(id),
      released_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS pressing_releases_source_id_idx ON pressing_releases(source_id);

    CREATE TABLE IF NOT EXISTS pressing_entry_adjustments (
      id SERIAL PRIMARY KEY,
      entry_id INTEGER NOT NULL REFERENCES pressing_entries(id),
      request_id TEXT UNIQUE,
      previous_pieces INTEGER NOT NULL CHECK (previous_pieces >= 0),
      corrected_pieces INTEGER NOT NULL CHECK (corrected_pieces >= 0),
      previous_values JSONB,
      corrected_values JSONB,
      reason TEXT,
      corrected_by INTEGER NOT NULL REFERENCES users(id),
      corrected_at TIMESTAMPTZ NOT NULL,
      CHECK ((request_id IS NULL AND previous_values IS NOT NULL AND corrected_values IS NOT NULL AND reason IS NULL)
        OR (request_id IS NOT NULL AND previous_values IS NULL AND corrected_values IS NULL
          AND reason IS NOT NULL AND btrim(reason) <> ''))
    );
    CREATE INDEX IF NOT EXISTS pressing_entry_adjustments_entry_id_idx ON pressing_entry_adjustments(entry_id,id);
    CREATE OR REPLACE VIEW pressing_effective_entries AS
      SELECT e.*, coalesce(adjustment.corrected_pieces,e.pieces) AS effective_pieces,
        coalesce(first_edit.previous_pieces,e.pieces) AS original_pieces
      FROM pressing_entries e
      LEFT JOIN LATERAL (
        SELECT corrected_pieces FROM pressing_entry_adjustments
        WHERE entry_id=e.id AND request_id IS NOT NULL ORDER BY id DESC LIMIT 1
      ) adjustment ON true
      LEFT JOIN LATERAL (
        SELECT previous_pieces FROM pressing_entry_adjustments
        WHERE entry_id=e.id AND request_id IS NULL ORDER BY id LIMIT 1
      ) first_edit ON true;

    CREATE TABLE IF NOT EXISTS pressing_issue_reversals (
      id SERIAL PRIMARY KEY,
      issue_id INTEGER NOT NULL REFERENCES pressing_issues(id),
      request_id TEXT NOT NULL UNIQUE,
      request_lines JSONB NOT NULL,
      reason TEXT NOT NULL CHECK (btrim(reason) <> ''),
      reversed_by INTEGER NOT NULL REFERENCES users(id),
      reversed_at TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS pressing_issue_reversals_issue_id_idx ON pressing_issue_reversals(issue_id);
    CREATE TABLE IF NOT EXISTS pressing_issue_reversal_lines (
      reversal_id INTEGER NOT NULL REFERENCES pressing_issue_reversals(id),
      issue_line_id INTEGER NOT NULL REFERENCES pressing_issue_lines(id),
      previous_pieces INTEGER NOT NULL CHECK (previous_pieces > 0),
      pieces INTEGER NOT NULL CHECK (pieces > 0 AND pieces <= previous_pieces),
      PRIMARY KEY (reversal_id,issue_line_id)
    );
    CREATE INDEX IF NOT EXISTS pressing_issue_reversal_lines_issue_line_id_idx
      ON pressing_issue_reversal_lines(issue_line_id);
    CREATE OR REPLACE VIEW pressing_net_issue_lines AS
      SELECT l.id,l.issue_id,l.source_id,l.allocation,
        (l.pieces - coalesce(reversed.pieces,0))::integer AS pieces
      FROM pressing_issue_lines l
      LEFT JOIN LATERAL (
        SELECT sum(pieces) AS pieces FROM pressing_issue_reversal_lines WHERE issue_line_id=l.id
      ) reversed ON true;

    CREATE TABLE IF NOT EXISTS pressing_kiln_jobs (
      id SERIAL PRIMARY KEY,
      request_id TEXT NOT NULL UNIQUE,
      reference TEXT CHECK (btrim(reference) <> ''),
      fired_on DATE NOT NULL,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
    );
    CREATE TABLE IF NOT EXISTS pressing_sort_results (
      id SERIAL PRIMARY KEY,
      request_id TEXT NOT NULL UNIQUE,
      request_payload JSONB NOT NULL,
      kiln_job_id INTEGER NOT NULL REFERENCES pressing_kiln_jobs(id),
      type_id INTEGER NOT NULL REFERENCES pressing_types(id),
      revision INTEGER NOT NULL CHECK (revision >= 1),
      sorted_on DATE NOT NULL,
      good_pieces INTEGER NOT NULL CHECK (good_pieces >= 0),
      waste_pieces INTEGER NOT NULL CHECK (waste_pieces >= 0),
      employee_id INTEGER REFERENCES employees(id),
      correction_reason TEXT,
      submitted_by INTEGER NOT NULL REFERENCES users(id),
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
      UNIQUE (kiln_job_id,type_id,revision),
      CHECK ((revision=1 AND correction_reason IS NULL) OR
        (revision>1 AND correction_reason IS NOT NULL AND btrim(correction_reason) <> ''))
    );
    CREATE INDEX IF NOT EXISTS pressing_sort_results_type_id_idx ON pressing_sort_results(type_id);
    CREATE TABLE IF NOT EXISTS pressing_sort_result_issues (
      result_id INTEGER NOT NULL REFERENCES pressing_sort_results(id),
      issue_id INTEGER NOT NULL REFERENCES pressing_issues(id),
      PRIMARY KEY (result_id,issue_id)
    );
  `);
}
