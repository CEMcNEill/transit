import { describe, expect, it } from 'vitest';
import { createRng, fnv1a, rngFor, seedFor } from '../src/rng.ts';

describe('rng', () => {
  it('is deterministic per seed and differs across seeds', () => {
    const a = Array.from(
      { length: 5 },
      (() => {
        const r = createRng('x');
        return () => r.next();
      })(),
    );
    const b = Array.from(
      { length: 5 },
      (() => {
        const r = createRng('x');
        return () => r.next();
      })(),
    );
    expect(a).toEqual(b);
    expect(createRng('y').next()).not.toEqual(createRng('x').next());
  });

  it('seedFor distinguishes numeric and string parts and ordering', () => {
    expect(seedFor('run', 'KIC 1', 'planet', 2)).toBe(seedFor('run', 'KIC 1', 'planet', 2));
    expect(seedFor('run', 1)).not.toBe(seedFor('run', '1'));
    expect(seedFor('run', 'a', 'b')).not.toBe(seedFor('run', 'ab'));
    expect(rngFor('r', 'a').next()).toBe(rngFor('r', 'a').next());
  });

  it('produces values in range with a sane distribution', () => {
    const r = createRng('dist');
    let sum = 0;
    for (let i = 0; i < 10000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
    }
    expect(sum / 10000).toBeCloseTo(0.5, 1);
    for (let i = 0; i < 1000; i++) {
      const n = r.int(2, 4);
      expect([2, 3, 4]).toContain(n);
    }
    const counts = [0, 0];
    for (let i = 0; i < 4000; i++) counts[r.weightedIndex([1, 3])]! += 1;
    expect(counts[1]! / 4000).toBeCloseTo(0.75, 1);
  });

  it('fnv1a matches known vectors', () => {
    expect(fnv1a('')).toBe(0x811c9dc5);
    expect(fnv1a('a')).toBe(0xe40c292c);
  });
});
