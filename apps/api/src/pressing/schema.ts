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
  `);
}
