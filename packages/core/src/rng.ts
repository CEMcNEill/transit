// Deterministic randomness. Nothing in core may use ambient randomness (ESLint enforces it).
//
// There is no mutable RNG in game state: every random decision derives a fresh stream from
// seedFor(runSeed, ...context), e.g. seedFor(run, 'KIC 8311864', 'planet', 2). The same
// (seed, context) always yields the same numbers, so replaying actions reproduces a run exactly.

export type SeedPart = string | number;

/** xmur3 string hash -> 32-bit seed generator. */
function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

/** Stable sub-seed string for a context path. Parts are joined unambiguously. */
export function seedFor(runSeed: string, ...path: SeedPart[]): string {
  return [runSeed, ...path.map((p) => (typeof p === 'number' ? `#${p}` : p))].join('␟');
}

/** 32-bit FNV-1a hash, used for content versions and short ids. */
export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform float in [lo, hi). */
  range(lo: number, hi: number): number;
  /** Uniform integer in [lo, hi] inclusive. */
  int(lo: number, hi: number): number;
  /** True with probability p. */
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  /** Index chosen with probability proportional to weights[i]. */
  weightedIndex(weights: readonly number[]): number;
}

/** sfc32 PRNG seeded from a seedFor() string. */
export function createRng(seed: string): Rng {
  const h = xmur3(seed);
  let a = h();
  let b = h();
  let c = h();
  let d = h();
  const next = (): number => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  // Discard the first outputs: sfc32 mixes poorly for a few rounds.
  for (let i = 0; i < 12; i++) next();

  const rng: Rng = {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    chance: (p) => next() < p,
    pick: (items) => {
      if (items.length === 0) throw new Error('pick from empty list');
      return items[Math.floor(next() * items.length)] as (typeof items)[number];
    },
    weightedIndex: (weights) => {
      let total = 0;
      for (const w of weights) total += Math.max(0, w);
      if (total <= 0) throw new Error('weightedIndex needs a positive weight');
      let r = next() * total;
      for (let i = 0; i < weights.length; i++) {
        r -= Math.max(0, weights[i] ?? 0);
        if (r < 0) return i;
      }
      return weights.length - 1;
    },
  };
  return rng;
}

/** Shorthand: createRng(seedFor(runSeed, ...path)). */
export function rngFor(runSeed: string, ...path: SeedPart[]): Rng {
  return createRng(seedFor(runSeed, ...path));
}
