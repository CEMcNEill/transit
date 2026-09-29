import { starLabel, type SectorStar } from '@transit/core';

/** Compact star name for lists and map labels: long Gaia DR3 ids keep their last digits. */
export function shortLabel(star: SectorStar): string {
  if (star.name) return star.name;
  const m = /^Gaia DR3 (\d+)$/.exec(star.id);
  return m ? `Gaia …${(m[1] as string).slice(-7)}` : starLabel(star);
}

/** Compact any Gaia DR3 ids inside free text (log lines, clock labels). */
export function compactIds(text: string): string {
  return text.replace(/Gaia DR3 (\d{7,})/g, (_, id: string) => `Gaia …${id.slice(-7)}`);
}
