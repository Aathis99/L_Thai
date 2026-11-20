export type FinishingTile = { id: number; width: number | null; length: number | null; clay: string; name: string | null; clay_color?: string | null };

export function pendingQcLoads<T extends { unsorted_pieces: number }>(round: {
  finished_on: string | null; loads: readonly T[];
}): T[] {
  return round.finished_on ? round.loads.filter(load => load.unsorted_pieces > 0) : [];
}

export function finishingTileName(types: readonly FinishingTile[], id: number, clay: string) {
  const tile = types.find(item => item.id === id);
  const dimensions = tile && ([tile.width, tile.length].filter(value => value !== null).join(" × ") || "ไม่ระบุขนาด");
  return tile ? `${dimensions} ดิน${clay}${tile.clay_color ? ` · สีที่ผสม ${tile.clay_color}` : ""}${tile.name ? ` · ${tile.name}` : ""}` : `ประเภท #${id} · ดิน${clay}`;
}
