import { formInteger, formText, type TileType } from "./pressing.ts";

export const clays = ["แดง", "ขาว", "ศิลาแลง", "สี"] as const;
export const sizeUnits: Record<string, string> = { in: "นิ้ว", mm: "มม.", cm: "ซม." };

export interface CatalogGeometry {
  shape: string | null;
  size_1: number;
  size_2: number | null;
  size_unit: string;
  thickness_mm: number | null;
}

export interface CatalogProduct extends CatalogGeometry {
  id: number;
  product_code: string;
  name: string;
  mounting_type: string | null;
  body_id: number | null;
  active: boolean;
}

export interface CatalogBody extends CatalogGeometry { id: number; name: string }
export interface CatalogProfile extends TileType { body_id: number | null }
export interface CatalogState { products: CatalogProduct[]; bodies: CatalogBody[]; profiles: CatalogProfile[] }

export function geometryLabel(item: CatalogGeometry): string {
  return [item.shape, `${item.size_1}${item.size_2 === null ? "" : ` × ${item.size_2}`} ${sizeUnits[item.size_unit] ?? item.size_unit}`,
    item.thickness_mm === null ? null : `หนา ${item.thickness_mm} มม.`].filter(Boolean).join(" · ");
}

export function productLabel(item: CatalogProduct): string {
  return `${item.product_code} · ${item.name} · ${geometryLabel(item)}${item.mounting_type === "mesh" ? " · ติดตาข่าย" : ""} · #${item.id}`;
}

export function profileLabel(item: TileType): string {
  return `ดิน${item.clay}${item.clay_color ? ` · สีที่ผสม ${item.clay_color}` : ""} · #${item.id}`;
}

export function productProfiles(product: CatalogProduct, profiles: readonly CatalogProfile[]): CatalogProfile[] {
  if (!product.active || product.body_id === null) return [];
  return readyProductionProfiles(profiles).filter(profile => profile.body_id === product.body_id);
}

export function readyProductionProfiles<T extends TileType>(profiles: readonly T[]): T[] {
  return profiles.filter(profile => profile.active &&
    profile.pieces_per_rack > 0 && profile.rest_days >= 0 && (profile.pieces_per_sqm ?? 0) > 0 &&
    (profile.destination === "color" || profile.destination === "kiln") &&
    (profile.clay !== "สี" || Boolean(profile.clay_color?.trim())));
}

export function catalogOrderSelection(products: readonly CatalogProduct[], profiles: readonly CatalogProfile[],
  productId: number | null, profileId: number, purpose: string) {
  if (productId === null && purpose === "stock" && readyProductionProfiles(profiles).some(profile => profile.id === profileId)) {
    return { type_id: profileId };
  }
  const product = products.find(item => item.id === productId);
  if (!product || !productProfiles(product, profiles).some(item => item.id === profileId)) {
    throw new Error("กรุณาเลือกสินค้าที่ตรวจยืนยันแบบดินปั๊มและข้อมูลผลิตครบแล้ว");
  }
  if (product.mounting_type === "mesh" && purpose !== "customer") {
    throw new Error("สินค้าติดตาข่ายต้องมีออเดอร์ลูกค้า");
  }
  return { product_id: product.id, type_id: profileId };
}

export interface MeshSource {
  key: string;
  source: string;
  allocation_id: number;
  qc_id: number;
  grade: string | null;
  available_pieces: number;
}
export interface MeshOrder {
  id: number;
  product_name: string;
  product_code?: string | null;
  customer_reference: string;
  customer_pieces: number;
  allocated_pieces: number;
  completed_pieces: number;
  waiting_pieces: number;
  ready_pieces: number;
  lines: MeshSource[];
}
export interface MeshEntry {
  id: number;
  order_id: number;
  pieces: number;
  lines: (Pick<MeshSource, "key" | "source" | "allocation_id" | "qc_id" | "grade"> & { pieces: number })[];
  recorded_at: string;
  recorded_by_username?: string;
  voided_at: string | null;
  reason?: string | null;
}
export interface MeshState { orders: MeshOrder[]; entries: MeshEntry[] }

export function meshCompletionLines(form: FormData, sources: readonly Pick<MeshSource, "key" | "available_pieces">[]) {
  const lines = sources.flatMap((source, index) => {
    const field = `line_${index}`;
    if (!formText(form, field)) return [];
    const pieces = formInteger(form, field, "จำนวนติดตาข่าย", 0);
    if (pieces > source.available_pieces) throw new Error("จำนวนติดตาข่ายเกินยอดคงเหลือของต้นทาง กรุณาโหลดรายการใหม่");
    return pieces ? [{ key: source.key, pieces }] : [];
  });
  if (!lines.length) throw new Error("กรุณาระบุจำนวนติดตาข่ายอย่างน้อยหนึ่งต้นทาง");
  return lines;
}
