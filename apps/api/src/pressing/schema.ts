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
  `);
}
