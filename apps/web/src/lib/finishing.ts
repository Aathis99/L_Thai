export type FinishingTile = { id: number; width: number; length: number; clay: string; name: string | null };

export function finishingTileName(types: readonly FinishingTile[], id: number, clay: string) {
  const tile = types.find(item => item.id === id);
  return tile ? `${tile.width} × ${tile.length} ดิน${clay}${tile.name ? ` · ${tile.name}` : ""}` : `ประเภท #${id} · ดิน${clay}`;
}
