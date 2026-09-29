import { describe, expect, it } from 'vitest';
import type { Action } from '../src/actions.ts';
import { nextUp } from '../src/clocks.ts';
import { defaultContent } from '../src/content.ts';
import { generateSystem } from '../src/generate/system.ts';
import { newGame, reduce, type Ctx } from '../src/reducer.ts';
import { rngFor } from '../src/rng.ts';
import { makeSave, parseSave, replay } from '../src/save.ts';
import { legalActions } from '../src/selectors.ts';
import { BOTS } from '../src/sim/bots.ts';
import { playRun } from '../src/sim/runner.ts';
import type { GameState } from '../src/state.ts';
import { makeSector } from './fixtures/sector.ts';

const sector = makeSector();
const content = defaultContent;
const ctx: Ctx = { sector, content };
const bot = (name: string) => BOTS.find((b) => b.name === name)!;
/** Bots take an Rng; derive it from the core RNG so tests stay deterministic. */
const legalRng = (seed: string, step: number) => rngFor(seed, 'test-bot', step);

describe('determinism', () => {
  it('same seed gives the same systems', () => {
    for (let i = 0; i < sector.stars.length; i += 7) {
      expect(generateSystem('seed-1', sector, i, content.balance)).toEqual(
        generateSystem('seed-1', sector, i, content.balance),
      );
    }
  });

  it('different seeds give different procedural systems somewhere', () => {
    const differs = sector.stars.some(
      (_, i) =>
        JSON.stringify(generateSystem('a', sector, i, content.balance)) !==
        JSON.stringify(generateSystem('b', sector, i, content.balance)),
    );
    expect(differs).toBe(true);
  });

  it('confirmed planets are fixed slots with real values in every run', () => {
    const p = sector.planets.find((x) => x.disposition === 'CONFIRMED')!;
    for (const seed of ['a', 'b', 'c']) {
      const w = generateSystem(seed, sector, p.starIndex, content.balance).worlds.find(
        (x) => x.koi === p.koi,
      )!;
      expect(w.origin).toBe('confirmed');
      expect(w.name).toBe(p.name);
      expect(w.transiting).toBe(true);
    }
  });

  it('same seed gives the same sim outcome', () => {
    for (const b of BOTS) {
      const r1 = playRun(b, sector, content, 'det-1');
      const r2 = playRun(b, sector, content, 'det-1');
      expect(JSON.stringify(r2.state)).toBe(JSON.stringify(r1.state));
      expect(r2.result).toEqual(r1.result);
    }
  });
});

describe('saves', () => {
  it('replaying the action log reproduces byte-identical state', () => {
    for (const seed of ['save-1', 'save-2', 'save-3']) {
      for (const b of BOTS) {
        const { state, actions } = playRun(b, sector, content, seed);
        const save = parseSave(JSON.stringify(makeSave(seed, ctx, actions)));
        expect(JSON.stringify(replay(save, ctx))).toBe(JSON.stringify(state));
      }
    }
  });

  it('rejects saves from other content versions', () => {
    const save = makeSave('x', ctx, []);
    expect(() => replay({ ...save, contentVersion: 'nope' }, ctx)).toThrow(/content/);
  });
});

function checkInvariants(s: GameState): void {
  const { fuel, lifeSupport, hull, materials, data } = s.ship;
  expect(fuel).toBeGreaterThanOrEqual(0);
  expect(materials).toBeGreaterThanOrEqual(0);
  expect(data).toBeGreaterThanOrEqual(0);
  if (s.status.kind === 'active') {
    expect(lifeSupport).toBeGreaterThan(0);
    expect(hull).toBeGreaterThan(0);
  } else if (s.status.kind === 'lost') {
    if (s.status.cause === 'hull') expect(hull).toBeLessThanOrEqual(0);
    if (s.status.cause === 'lifeSupport') expect(lifeSupport).toBeLessThanOrEqual(0);
  }
  for (const c of s.clocks) expect(c.turnsRemaining).toBeGreaterThan(0);
}

describe('rules', () => {
  it('no action produces negative resources without ending the run correctly', () => {
    for (let i = 0; i < 60; i++) {
      for (const b of BOTS) {
        const seed = `inv-${i}`;
        let s = newGame(seed, sector, content);
        let steps = 0;
        while (s.status.kind === 'active' && steps < 800) {
          const legal = legalActions(s, ctx);
          expect(legal.length).toBeGreaterThan(0);
          const a = b.play(s, ctx, legalRng(seed, steps));
          s = reduce(s, a, ctx);
          checkInvariants(s);
          steps++;
        }
      }
    }
  });

  it('every legal action is accepted and illegal ones throw', () => {
    let s = newGame('legal', sector, content);
    for (let step = 0; step < 40 && s.status.kind === 'active'; step++) {
      for (const a of legalActions(s, ctx)) expect(() => reduce(s, a, ctx)).not.toThrow();
      s = reduce(s, bot('greedy').play(s, ctx, legalRng('legal', step)), ctx);
    }
    const fresh = newGame('legal', sector, content);
    expect(() => reduce(fresh, { type: 'jump', target: sector.stars.length - 1 }, ctx)).toThrow(
      /range/,
    );
    expect(() => reduce(fresh, { type: 'chooseEvent', optionId: 'x' }, ctx)).toThrow(/no event/);
  });

  it('the goal wins and the front hurts', () => {
    // Greedy should win at least sometimes on the fixture, and front damage must be possible.
    const results = Array.from(
      { length: 30 },
      (_, i) => playRun(bot('greedy'), sector, content, `w-${i}`).result,
    );
    expect(results.some((r) => r.outcome === 'won')).toBe(true);
    const waited = (() => {
      let s = newGame('front', sector, content);
      for (let i = 0; i < 40 && s.status.kind === 'active'; i++) {
        s = s.pendingEvent
          ? reduce(s, legalActions(s, ctx)[0] as Action, ctx)
          : reduce(s, { type: 'stay' }, ctx);
      }
      return s;
    })();
    expect(waited.log.some((e) => e.text.startsWith('Behind the front'))).toBe(true);
  });

  it('nextUp lists at most three upcoming items, soonest first, including the front', () => {
    const s = newGame('clocks', sector, content);
    const up = nextUp(s, sector, content);
    expect(up.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < up.length; i++)
      expect(up[i]!.turns).toBeGreaterThanOrEqual(up[i - 1]!.turns);
    const all = nextUp(s, sector, content, 99);
    expect(all.some((u) => u.kind === 'front')).toBe(true);
  });

  it('stay-yield clocks are cancelled on leaving; recurring clocks reset', () => {
    let s = newGame('stay', sector, content);
    s = { ...s, pendingEvent: null };
    s = reduce(s, { type: 'stay' }, ctx);
    if (s.pendingEvent) s = reduce(s, legalActions(s, ctx)[0] as Action, ctx);
    expect(s.clocks.some((c) => c.kind === 'stay-yield')).toBe(true);
    const jump = legalActions(s, ctx).find((a) => a.type === 'jump')!;
    s = reduce(s, jump, ctx);
    expect(s.clocks.some((c) => c.kind === 'stay-yield')).toBe(false);
    expect(s.clocks.filter((c) => c.kind === 'recycler')).toHaveLength(1);
  });
});
