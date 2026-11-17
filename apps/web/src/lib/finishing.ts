export type FinishingTile = { id: number; width: number; length: number; clay: string; name: string | null };

export function pendingQcLoads<T extends { unsorted_pieces: number }>(round: {
  finished_on: string | null; loads: readonly T[];
}): T[] {
  return round.finished_on ? round.loads.filter(load => load.unsorted_pieces > 0) : [];
}

export function finishingTileName(types: readonly FinishingTile[], id: number, clay: string) {
  const tile = types.find(item => item.id === id);
  return tile ? `${tile.width} × ${tile.length} ดิน${clay}${tile.name ? ` · ${tile.name}` : ""}` : `ประเภท #${id} · ดิน${clay}`;
}
