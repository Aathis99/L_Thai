import type { Db } from '../database.js';

export async function migrateColorChart(db: Db): Promise<void> {
  await db.query(`CREATE TABLE IF NOT EXISTS color_chart_entries (
    id SERIAL PRIMARY KEY,
    display_order INTEGER NOT NULL UNIQUE CHECK (display_order > 0),
    name TEXT NOT NULL CHECK (name <> ''),
    normalized_name TEXT NOT NULL UNIQUE CHECK (normalized_name <> ''),
    note TEXT
  )`);
}
