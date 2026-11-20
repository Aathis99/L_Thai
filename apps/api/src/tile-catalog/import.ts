export interface CatalogImportRow {
  source_row: number;
  product_code: string;
  name: string;
  shape: string | null;
  size_1: number;
  size_2: number | null;
  size_unit: string;
  thickness_mm: number | null;
  mounting_type: string | null;
  description_raw: string;
  notes: string | null;
}

const columns = ['product_code', 'name', 'shape', 'size_1', 'size_2', 'size_unit',
  'thickness_mm', 'mounting_type', 'description_raw', 'source_row', 'notes'] as const;

function cells(line: string): string[] {
  const values: string[] = [];
  let value = '';
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '\\' && /[\\|*_]/.test(line[index + 1] ?? '')) {
      value += line[++index];
    } else if (char === '|') {
      values.push(value.trim());
      value = '';
    } else value += char;
  }
  values.push(value.trim());
  if (line.trimStart().startsWith('|')) values.shift();
  if (line.trimEnd().endsWith('|')) values.pop();
  return values;
}

export function parseProductsMarkdown(markdown: string): CatalogImportRow[] {
  const lines = markdown.replace(/^\uFEFF/, '').split(/\r?\n/);
  const headerIndex = lines.findIndex(line => {
    const values = cells(line);
    return columns.every(column => values.includes(column));
  });
  if (headerIndex < 0) throw new Error('Product table header is missing required columns');
  const header = cells(lines[headerIndex]);
  const separator = cells(lines[headerIndex + 1] ?? '');
  if (separator.length !== header.length || !separator.every(value => /^:?-{3,}:?$/.test(value)))
    throw new Error('Product table header must have a Markdown separator');
  const rows: CatalogImportRow[] = [];
  const sourceRows = new Set<number>();
  for (let index = headerIndex + 2; index < lines.length; index++) {
    if (!lines[index].trim().startsWith('|')) break;
    const values = cells(lines[index]);
    if (values.length !== header.length) throw new Error(`Product row ${index + 1} has invalid column count`);
    const get = (column: typeof columns[number]) => values[header.indexOf(column)];
    const required = (column: typeof columns[number]) => {
      const value = get(column);
      if (!value || value.includes('\u0000')) throw new Error(`Product row ${index + 1}: ${column} is required`);
      return value;
    };
    const number = (column: typeof columns[number], optional = false) => {
      const text = get(column);
      if (optional && text === '') return null;
      const value = Number(text);
      if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(text) || !Number.isFinite(value) || value <= 0)
        throw new Error(`Product row ${index + 1}: ${column} must be a positive number`);
      return value;
    };
    const sourceRow = number('source_row')!;
    if (!Number.isSafeInteger(sourceRow) || sourceRows.has(sourceRow))
      throw new Error(`Product row ${index + 1}: duplicate or invalid source_row`);
    sourceRows.add(sourceRow);
    const mounting = get('mounting_type');
    if (mounting && mounting !== 'mesh' && mounting !== 'ติดตาข่าย')
      throw new Error(`Product row ${index + 1}: unknown mounting_type`);
    rows.push({
      source_row: sourceRow, product_code: required('product_code'), name: required('name'),
      shape: get('shape') || null, size_1: number('size_1')!, size_2: number('size_2', true),
      size_unit: required('size_unit'), thickness_mm: number('thickness_mm', true),
      mounting_type: mounting ? 'mesh' : null, description_raw: get('description_raw'), notes: get('notes') || null,
    });
  }
  if (!rows.length) throw new Error('Product table has no product rows');
  return rows;
}
import { createHash } from 'node:crypto';
import type { Db } from '../database.js';


/** The caller owns the transaction; source conflicts never overwrite catalog edits. */
export async function importProducts(db: Db, rows: CatalogImportRow[], sourceIdentity: string): Promise<{ inserted: number; unchanged: number }> {
  if (!sourceIdentity || sourceIdentity !== sourceIdentity.trim() || sourceIdentity.includes('\u0000'))
    throw new Error('A nonempty source identity without surrounding whitespace is required');
  if (!rows.length) throw new Error('Product import has no source rows');
  const fingerprints = new Map<number, string>();
  for (const row of rows) {
    if (!Number.isSafeInteger(row.source_row) || row.source_row <= 0 || fingerprints.has(row.source_row))
      throw new Error('Product import has a duplicate or invalid source_row');
    fingerprints.set(row.source_row, createHash('sha256').update(JSON.stringify(columns.map(column => row[column]))).digest('hex'));
  }
  await db.query("SELECT pg_advisory_xact_lock(hashtext('tile-products-source'),hashtext($1::text))", [sourceIdentity]);
  const existing = (await db.query(`SELECT source_row,import_fingerprint FROM tile_products
    WHERE source_key=$1 || ':' || source_row::text FOR UPDATE`, [sourceIdentity])).rows;
  if (existing.length) {
    if (existing.length !== rows.length || existing.some(row => fingerprints.get(row.source_row) !== row.import_fingerprint))
      throw new Error('Product import source conflict: content or source row set changed; review a new source identity');
    return { inserted: 0, unchanged: rows.length };
  }
  for (const row of rows) {
    await db.query(`INSERT INTO tile_products(product_code,name,shape,size_1,size_2,size_unit,
      thickness_mm,mounting_type,description_raw,source_row,notes,source_key,import_fingerprint)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [row.product_code, row.name, row.shape, row.size_1, row.size_2, row.size_unit, row.thickness_mm,
      row.mounting_type, row.description_raw, row.source_row, row.notes,
      `${sourceIdentity}:${row.source_row}`, fingerprints.get(row.source_row)]);
  }
  return { inserted: rows.length, unchanged: 0 };
}
