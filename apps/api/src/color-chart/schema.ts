import type { Db } from '../database.js';

export const COLOR_CHART_IMAGE_MAX_BYTES = 256 * 1024;

export async function migrateColorChart(db: Db): Promise<void> {
  await db.query(`CREATE TABLE IF NOT EXISTS color_chart_entries (
    id SERIAL PRIMARY KEY,
    display_order INTEGER NOT NULL UNIQUE CHECK (display_order > 0),
    name TEXT NOT NULL CHECK (name <> ''),
    normalized_name TEXT NOT NULL UNIQUE CHECK (normalized_name <> ''),
    note TEXT
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS color_chart_images (
    entry_id INTEGER PRIMARY KEY REFERENCES color_chart_entries(id) ON DELETE CASCADE,
    image_bytes BYTEA NOT NULL CHECK (octet_length(image_bytes) BETWEEN 1 AND ${COLOR_CHART_IMAGE_MAX_BYTES})
  )`);
}
