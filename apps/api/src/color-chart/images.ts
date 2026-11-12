import sharp from 'sharp';
import { fail } from '../auth.js';
import { one, type Db } from '../database.js';
import { COLOR_CHART_IMAGE_MAX_BYTES } from './schema.js';

export const COLOR_CHART_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const COLOR_CHART_UPLOAD_MAX_BYTES = 8 * 1024 * 1024;
const INPUT_PIXEL_LIMIT = 40_000_000;
const JPEG_SIGNATURE = Buffer.from('ffd8ff', 'hex');
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const OUTPUT_SETTINGS = [
  { dimension: 1024, quality: 80 },
  { dimension: 768, quality: 65 },
  { dimension: 512, quality: 55 },
];

function matchesSignature(input: Buffer, contentType: string): boolean {
  switch (contentType) {
    case 'image/jpeg':
      return input.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE);
    case 'image/png':
      return input.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
    case 'image/webp':
      return input.toString('ascii', 0, 4) === 'RIFF' && input.toString('ascii', 8, 12) === 'WEBP';
    default:
      return false;
  }
}

function hasPngAnimation(input: Buffer): boolean {
  // APNG declares animation before IDAT, but Sharp reads its first frame as a regular PNG.
  for (let offset = PNG_SIGNATURE.length; offset + 12 <= input.length;) {
    const type = input.toString('ascii', offset + 4, offset + 8);
    if (type === 'acTL') return true;
    if (type === 'IDAT' || type === 'IEND') return false;
    offset += 12 + input.readUInt32BE(offset);
  }
  return false;
}

export async function encodeColorChartImage(input: Buffer, contentType: string): Promise<Buffer> {
  if (!COLOR_CHART_IMAGE_TYPES.includes(contentType)) fail('รองรับเฉพาะภาพ JPEG, PNG และ WebP', 415);
  if (input.length > COLOR_CHART_UPLOAD_MAX_BYTES) fail('ไฟล์ภาพต้องไม่เกิน 8 MiB', 413);
  if (!matchesSignature(input, contentType)) fail('ข้อมูลภาพไม่ตรงกับชนิดไฟล์');
  if (contentType === 'image/png' && hasPngAnimation(input)) fail('รองรับเฉพาะภาพนิ่ง');

  const image = sharp(input, { limitInputPixels: INPUT_PIXEL_LIMIT, failOn: 'warning' });
  const metadata = await image.metadata().catch(() => fail('ไม่สามารถเปิดไฟล์ภาพได้'));
  if (metadata.mediaType !== contentType) fail('ข้อมูลภาพไม่ตรงกับชนิดไฟล์');
  if ((metadata.pages ?? 1) > 1) fail('รองรับเฉพาะภาพนิ่ง');

  for (const { dimension, quality } of OUTPUT_SETTINGS) {
    const encoded = await image.clone().autoOrient()
      .resize(dimension, dimension, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality, alphaQuality: 80 }).toBuffer()
      .catch(() => fail('ไม่สามารถเปิดไฟล์ภาพได้'));
    if (encoded.length <= COLOR_CHART_IMAGE_MAX_BYTES) return encoded;
  }
  return fail('ภาพตัวอย่างต้องมีขนาดไม่เกิน 256 KiB');
}

export async function readColorChartImage(db: Db, id: number): Promise<Buffer> {
  const row = await one(db, 'SELECT image_bytes FROM color_chart_images WHERE entry_id=$1', [id]);
  if (!row) fail('ไม่พบภาพตัวอย่าง', 404);
  return row.image_bytes;
}

export async function saveColorChartImage(db: Db, id: number, image: Buffer): Promise<void> {
  const row = await one(db, `INSERT INTO color_chart_images(entry_id,image_bytes)
    SELECT id,$2 FROM color_chart_entries WHERE id=$1
    ON CONFLICT (entry_id) DO UPDATE SET image_bytes=EXCLUDED.image_bytes
    RETURNING entry_id`, [id, image]);
  if (!row) fail('ไม่พบรายการชาร์ตสี', 404);
}

export async function removeColorChartImage(db: Db, id: number): Promise<boolean> {
  const entry = await one(db, 'SELECT id FROM color_chart_entries WHERE id=$1', [id]);
  if (!entry) fail('ไม่พบรายการชาร์ตสี', 404);
  const removed = await db.query('DELETE FROM color_chart_images WHERE entry_id=$1', [id]);
  return removed.rowCount === 1;
}
