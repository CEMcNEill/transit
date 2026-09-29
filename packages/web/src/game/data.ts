// Loads baked sector bundles served from data/sectors (see vite.config.ts publicDir).

import type { Sector } from '@transit/core';

export interface SectorIndexEntry {
  id: string;
  file: string;
  bytes: number;
  sunDistanceLy: number;
  meta: Sector['meta'] & { koiStarCount?: number; gmagCut?: number | null };
}

const cache = new Map<string, Promise<Sector>>();

export async function loadIndex(): Promise<SectorIndexEntry[]> {
  const res = await fetch('/sectors/index.json');
  if (!res.ok) throw new Error('No sector data. Run `make data` first.');
  const index = (await res.json()) as { sectors: SectorIndexEntry[] };
  return index.sectors;
}

export function loadSector(id: string): Promise<Sector> {
  let p = cache.get(id);
  if (!p) {
    p = fetch(`/sectors/${id}.json`).then((r) => {
      if (!r.ok) throw new Error(`Sector ${id} not found`);
      return r.json() as Promise<Sector>;
    });
    cache.set(id, p);
  }
  return p;
}
