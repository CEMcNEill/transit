// System generation from real star properties, seeded per run.
//
// Real data (Kepler confirmed planets, KOI candidates) becomes fixed world slots; everything a
// telescope can't see is procedural. Generation is lazy: a system is built on first visit or
// scan, then cached in state.

import type {
  Balance,
  Deltas,
  HazardKind,
  MineableResource,
  Range,
  StarClass,
  WorldType,
} from '../content.ts';
import { rngFor, type Rng } from '../rng.ts';
import {
  planetsOf,
  starLabel,
  type Sector,
  type SectorPlanet,
  type SectorStar,
} from '../sector.ts';

/** Equilibrium temperature (K) of a zero-albedo body at 1 AU from a 1 L_sun star. */
const TEQ_AT_1AU_K = 278.6;
const DAYS_PER_YEAR = 365.25;

export type WorldOrigin = 'confirmed' | 'candidate' | 'procedural';
export type KoiResult = 'planet' | 'eclipsingBinary' | 'artifact';

export interface World {
  id: string;
  name: string;
  origin: WorldOrigin;
  koi: string | null;
  type: WorldType;
  smaAu: number;
  teqK: number;
  radiusEarth: number;
  periodDays: number | null;
  /** true: Kepler saw it transit. false: generated around a Kepler target, so it can't transit. */
  transiting: boolean | null;
  temperate: boolean;
  landable: boolean;
  landingRisk: number;
  resources: Record<MineableResource, number>;
  surveyed: boolean;
}

export interface KoiResolution {
  koi: string;
  result: KoiResult;
}

export interface SystemState {
  starIndex: number;
  starClass: StarClass;
  teffK: number;
  luminositySun: number;
  hazard: { kind: HazardKind; chance: number; damage: Range };
  worlds: World[];
  /** Candidates that turned out not to be planets in this run. */
  koiResolutions: KoiResolution[];
}

// ---------------------------------------------------------------- star physics

export function bpRpToTeff(bpRp: number, points: Range[]): number {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) throw new Error('bpRpToTeff needs points');
  if (bpRp <= first[0]) return first[1];
  if (bpRp >= last[0]) return last[1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i] as Range;
    const [x0, y0] = points[i - 1] as Range;
    if (bpRp <= x1) return y0 + ((bpRp - x0) / (x1 - x0)) * (y1 - y0);
  }
  return last[1];
}

export function starTeff(star: SectorStar, b: Balance): number {
  if (star.teff != null) return star.teff;
  if (star.bpRp != null) return Math.round(bpRpToTeff(star.bpRp, b.stars.bpRpToTeff.points));
  return b.stars.defaultTeffK;
}

export function starClassOf(teff: number, b: Balance): StarClass {
  for (const c of b.stars.classes) if (teff >= c.minTeff) return c.cls;
  return b.stars.defaultClass;
}

export function starClass(star: SectorStar, b: Balance): StarClass {
  return starClassOf(starTeff(star, b), b);
}

export function luminosity(radiusSun: number, teffK: number, b: Balance): number {
  return radiusSun ** 2 * (teffK / b.stars.solarTeffK) ** 4;
}

export function teqAt(smaAu: number, luminositySun: number): number {
  return (TEQ_AT_1AU_K * luminositySun ** 0.25) / Math.sqrt(smaAu);
}

/** Kepler's third law with stellar mass approximated by radius (main sequence, solar units). */
function smaFromPeriod(periodDays: number, massSun: number): number {
  return Math.cbrt((periodDays / DAYS_PER_YEAR) ** 2 * massSun);
}

function periodFromSma(smaAu: number, massSun: number): number {
  return Math.sqrt(smaAu ** 3 / massSun) * DAYS_PER_YEAR;
}

// ---------------------------------------------------------------- worlds

/** Log-radius skewed toward small planets, which real surveys find far more of than giants. */
export function proceduralRadius(rng: Rng, b: Balance): number {
  const [lo, hi] = b.generation.radiusEarthLogRange;
  return 10 ** (lo + (hi - lo) * rng.next() ** b.generation.radiusSkew);
}

export function worldType(radiusEarth: number, teqK: number, rng: Rng, b: Balance): WorldType {
  const w = b.generation.worldTypes;
  if (radiusEarth >= w.giantRadiusEarth) return 'gas-giant';
  if (radiusEarth >= w.iceGiantRadiusEarth)
    return teqK < w.iceGiantMaxTeqK ? 'ice-giant' : 'gas-giant';
  const big = radiusEarth >= w.superEarthRadiusEarth;
  if (teqK >= w.lavaMinTeqK) return 'lava';
  if (teqK >= w.desertMinTeqK) return big ? 'super-earth' : 'desert';
  if (teqK >= w.temperateMinTeqK) {
    if (rng.chance(w.oceanChanceTemperate)) return 'ocean';
    return big ? 'super-earth' : 'rocky';
  }
  return 'ice';
}

export function isTemperate(teqK: number, b: Balance): boolean {
  const w = b.generation.worldTypes;
  return teqK >= w.temperateMinTeqK && teqK < w.desertMinTeqK;
}

const METAL_TYPES: ReadonlySet<WorldType> = new Set([
  'rocky',
  'desert',
  'lava',
  'super-earth',
  'belt',
]);

function rollResources(
  type: WorldType,
  temperate: boolean,
  mh: number | null,
  rng: Rng,
  b: Balance,
): Record<MineableResource, number> {
  const ranges = b.generation.resources[type];
  const out: Record<MineableResource, number> = { fuel: 0, materials: 0, lifeSupport: 0 };
  for (const res of ['fuel', 'materials', 'lifeSupport'] as const) {
    const r = ranges[res];
    if (r) out[res] = rng.int(r[0], r[1]);
  }
  if (METAL_TYPES.has(type)) {
    const richness = Math.max(0.3, 1 + b.generation.metallicityRichness * (mh ?? 0));
    out.materials = Math.round(out.materials * richness);
  }
  if (temperate && type !== 'ocean') {
    const [lo, hi] = b.generation.temperateLifeSupport;
    out.lifeSupport += rng.int(lo, hi);
  }
  return out;
}

export function resolveKoi(p: SectorPlanet, rng: Rng, b: Balance): KoiResult {
  const k = b.generation.koiResolution;
  const w = { ...k.base };
  for (const flag of [
    'notTransitLike',
    'stellarEclipse',
    'centroidOffset',
    'ephemerisMatch',
  ] as const) {
    if (p.fpFlags[flag]) {
      const m = k.flagMultipliers[flag];
      w.planet *= m.planet;
      w.eclipsingBinary *= m.eclipsingBinary;
      w.artifact *= m.artifact;
    }
  }
  if (p.koiScore != null) w.planet *= 1 + k.scoreWeight * (p.koiScore - 0.5);
  const results: KoiResult[] = ['planet', 'eclipsingBinary', 'artifact'];
  return results[rng.weightedIndex([w.planet, w.eclipsingBinary, w.artifact])] as KoiResult;
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII'];

export function koiDisplayName(koi: string): string {
  // "K07016.01" -> "KOI-7016.01"
  const m = /^K0*(\d+\.\d+)$/.exec(koi);
  return m ? `KOI-${m[1]}` : koi;
}

interface Slot {
  smaAu: number;
  radiusEarth: number;
  teqK: number;
  periodDays: number | null;
  origin: WorldOrigin;
  koi: string | null;
  realName: string | null;
  belt: boolean;
}

export function generateSystem(
  runSeed: string,
  sector: Sector,
  starIndex: number,
  b: Balance,
): SystemState {
  const star = sector.stars[starIndex];
  if (!star) throw new Error(`no star ${starIndex}`);
  const teffK = starTeff(star, b);
  const cls = starClassOf(teffK, b);
  const radiusSun = star.radius ?? b.stars.typicalRadius[cls];
  const lum = luminosity(radiusSun, teffK, b);
  const massSun = Math.max(0.08, radiusSun);
  const g = b.generation;
  const seed = (...path: (string | number)[]) => rngFor(runSeed, star.id, 'system', ...path);

  const slots: Slot[] = [];
  const koiResolutions: KoiResolution[] = [];
  for (const p of planetsOf(sector, starIndex)) {
    const rng = seed('koi', p.koi);
    if (p.disposition === 'CANDIDATE') {
      const result = resolveKoi(p, rng, b);
      if (result !== 'planet') {
        koiResolutions.push({ koi: p.koi, result });
        continue;
      }
    }
    const sma =
      p.smaAu ?? (p.periodDays != null ? smaFromPeriod(p.periodDays, massSun) : rng.range(0.05, 1));
    const radius = p.radiusEarth ?? proceduralRadius(rng, b);
    slots.push({
      smaAu: sma,
      radiusEarth: radius,
      teqK: p.teqK ?? teqAt(sma, lum),
      periodDays: p.periodDays ?? periodFromSma(sma, massSun),
      origin: p.disposition === 'CONFIRMED' ? 'confirmed' : 'candidate',
      koi: p.koi,
      realName: p.name,
      belt: false,
    });
  }

  const rng = seed('procedural');
  const count = rng.weightedIndex(g.planetCountWeights[cls]);
  const realOrbits = slots.map((s) => s.smaAu);
  let a = rng.range(...g.firstOrbitAu) * Math.sqrt(lum);
  for (let k = 0; k < count; k++) {
    // Keep procedural orbits clear of real ones; push outward until clear.
    for (let guard = 0; guard < 20; guard++) {
      const clash = realOrbits.some(
        (r) => Math.max(a, r) / Math.min(a, r) < g.realOrbitClearanceRatio,
      );
      if (!clash) break;
      a *= g.realOrbitClearanceRatio;
    }
    const belt = rng.chance(g.beltChance);
    slots.push({
      smaAu: a,
      radiusEarth: belt ? 0 : proceduralRadius(rng, b),
      teqK: teqAt(a, lum),
      periodDays: periodFromSma(a, massSun),
      origin: 'procedural',
      koi: null,
      realName: null,
      belt,
    });
    a *= rng.range(...g.orbitRatio);
  }
  slots.sort((x, y) => x.smaAu - y.smaAu);

  const label = starLabel(star);
  const worlds: World[] = slots.map((s, i) => {
    const wrng = seed('world', i, s.koi ?? 'p');
    const type: WorldType = s.belt ? 'belt' : worldType(s.radiusEarth, s.teqK, wrng, b);
    const temperate = type !== 'belt' && isTemperate(s.teqK, b);
    const landable = type !== 'gas-giant' && type !== 'ice-giant';
    const name =
      s.realName ??
      (s.koi
        ? koiDisplayName(s.koi)
        : `${label} ${ROMAN[i] ?? String(i + 1)}${s.belt ? ' belt' : ''}`);
    return {
      id: `${starIndex}:${i}`,
      name,
      origin: s.origin,
      koi: s.koi,
      type,
      smaAu: round(s.smaAu, 4),
      teqK: Math.round(s.teqK),
      radiusEarth: round(s.radiusEarth, 2),
      periodDays: s.periodDays == null ? null : round(s.periodDays, 2),
      transiting: s.origin === 'procedural' ? (star.flags.keplerTarget ? false : null) : true,
      temperate,
      landable,
      landingRisk: landable ? b.landing.risk[type as keyof Balance['landing']['risk']] : 0,
      resources: rollResources(type, temperate, star.mh, wrng, b),
      surveyed: false,
    };
  });

  return {
    starIndex,
    starClass: cls,
    teffK: Math.round(teffK),
    luminositySun: round(lum, 4),
    hazard: { ...b.stars.hazard[cls] },
    worlds,
    koiResolutions,
  };
}

export function round(x: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

/** Total of each mineable resource remaining in a system. */
export function systemResources(sys: SystemState): Deltas {
  const out = { fuel: 0, materials: 0, lifeSupport: 0 };
  for (const w of sys.worlds) {
    out.fuel += w.resources.fuel;
    out.materials += w.resources.materials;
    out.lifeSupport += w.resources.lifeSupport;
  }
  return out;
}
