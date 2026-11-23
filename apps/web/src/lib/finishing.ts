export type FinishingTile = { id: number; width: number | null; length: number | null; clay: string; name: string | null; clay_color?: string | null };
export type FinishingProduct = { product_code?: string | null; product_name?: string | null; production_clay_color?: string | null };

export function finishingProductName(product: FinishingProduct): string {
  return [product.product_code, product.product_name, product.production_clay_color ? `สีที่ผสม ${product.production_clay_color}` : null].filter(Boolean).join(" · ");
}

export function pendingQcLoads<T extends { unsorted_pieces: number }>(round: {
  finished_on: string | null; loads: readonly T[];
}): T[] {
  return round.finished_on ? round.loads.filter(load => load.unsorted_pieces > 0) : [];
}

export function finishingTileName(types: readonly FinishingTile[], id: number, clay: string, product?: FinishingProduct) {
  const tile = types.find(item => item.id === id);
  const dimensions = tile && ([tile.width, tile.length].filter(value => value !== null).join(" × ") || "ไม่ระบุขนาด");
  const profileColor = product && "production_clay_color" in product ? null : tile?.clay_color;
  const profile = tile ? `${dimensions} ดิน${clay}${profileColor ? ` · สีที่ผสม ${profileColor}` : ""}${tile.name ? ` · ${tile.name}` : ""}` : `ประเภท #${id} · ดิน${clay}`;
  return [product ? finishingProductName(product) : null, profile].filter(Boolean).join(" · ");
}
