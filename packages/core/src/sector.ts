// Types for baked sector bundles (data/sectors/<id>.json, produced by the pipeline).

export interface StarFlags {
  keplerTarget: boolean;
  host: boolean;
  koi: boolean;
  landmark: boolean;
}

export interface SectorStar {
  id: string;
  kepid: number | null;
  gaiaId: string | null;
  name: string | null;
  /** Light-years, sector-local frame: x runs from the start end toward the goal end. */
  pos: [number, number, number];
  teff: number | null;
  radius: number | null;
  mh: number | null;
  gmag: number | null;
  bpRp: number | null;
  /** Distance from the Sun in light-years. */
  distLy: number | null;
  flags: StarFlags;
}

export interface SectorPlanet {
  starIndex: number;
  koi: string;
  name: string | null;
  disposition: 'CONFIRMED' | 'CANDIDATE';
  periodDays: number | null;
  radiusEarth: number | null;
  smaAu: number | null;
  teqK: number | null;
  koiScore: number | null;
  fpFlags: {
    notTransitLike: number | null;
    stellarEclipse: number | null;
    centroidOffset: number | null;
    ephemerisMatch: number | null;
  };
}

export interface SectorMeta {
  lengthLy: number;
  radiusLy: number;
  starCount: number;
  hostCount: number;
  koiCount: number;
  landmarks: string[];
  shortestPathJumps?: number | null;
}

export interface Sector {
  id: string;
  version: number;
  meta: SectorMeta;
  start: { starIndex: number };
  goal: { starIndex: number };
  sunDirection: [number, number, number];
  sunDistanceLy: number;
  stars: SectorStar[];
  planets: SectorPlanet[];
  /** Per star: [otherIndex, distanceLy] within the max jump range, sorted by distance. */
  neighbors: [number, number][][];
}

export function starLabel(star: SectorStar): string {
  return star.name ?? star.id;
}

export function distanceBetween(sector: Sector, a: number, b: number): number {
  const p = sector.stars[a]?.pos;
  const q = sector.stars[b]?.pos;
  if (!p || !q) throw new Error(`bad star index ${a} or ${b}`);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/** Planets indexed by star, built once per sector. */
const planetIndex = new WeakMap<Sector, Map<number, SectorPlanet[]>>();

export function planetsOf(sector: Sector, starIndex: number): SectorPlanet[] {
  let idx = planetIndex.get(sector);
  if (!idx) {
    idx = new Map();
    for (const p of sector.planets) {
      const list = idx.get(p.starIndex) ?? [];
      list.push(p);
      idx.set(p.starIndex, list);
    }
    planetIndex.set(sector, idx);
  }
  return idx.get(starIndex) ?? [];
}
