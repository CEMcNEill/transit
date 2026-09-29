import { describe, expect, it } from 'vitest';
import { compileContent } from '../scripts/build-content.ts';
import { defaultContent, type EventDef } from '../src/content.ts';
import { eligible } from '../src/events/engine.ts';
import { generateSystem } from '../src/generate/system.ts';
import { newGame, reduce, type Ctx } from '../src/reducer.ts';
import type { GameState } from '../src/state.ts';
import { makeSector } from './fixtures/sector.ts';

const content = defaultContent;
const sector = makeSector();
const ctx: Ctx = { sector, content };

describe('content', () => {
  it('compiles and validates against the schemas, and matches the generated module', () => {
    const c = compileContent();
    expect(c.events).toHaveLength(10);
    expect(c.version).toBe(content.version);
  });

  it('every event has an option that costs nothing, so a decision is always possible', () => {
    for (const ev of content.events)
      expect(
        ev.options.some((o) => !o.cost),
        ev.id,
      ).toBe(true);
  });

  it('chance options have both outcomes; plain options only success', () => {
    for (const ev of content.events)
      for (const o of ev.options) {
        if (o.chance !== undefined) expect(o.failure, `${ev.id}/${o.id}`).toBeDefined();
        else expect(o.failure, `${ev.id}/${o.id}`).toBeUndefined();
      }
  });
});

function withEvent(ev: EventDef, seed: string): GameState {
  const s = newGame(seed, sector, content);
  const rich = { ...s.ship, fuel: 30, lifeSupport: 30, materials: 20, data: 20 };
  return {
    ...s,
    turn: 5,
    ship: rich,
    pendingEvent: { eventId: ev.id, trigger: ev.trigger, starIndex: s.position, worldId: null },
  };
}

describe('events', () => {
  it('every event is eligible somewhere in a generated sector', () => {
    const systems = sector.stars.map((_, i) => generateSystem('elig', sector, i, content.balance));
    const base = newGame('elig', sector, content);
    for (const ev of content.events) {
      const found = systems.some((system) =>
        [true, false].some((firstVisit) =>
          [null, ...system.worlds.map((w) => w.type)].some((landed) =>
            eligible(
              ev,
              { ...base, turn: 10 },
              { trigger: ev.trigger, system, firstVisit, landedWorldType: landed },
            ),
          ),
        ),
      );
      expect(found, ev.id).toBe(true);
    }
  });

  it('every outcome of every option is reachable', () => {
    for (const ev of content.events)
      for (const o of ev.options) {
        const seen = new Set<string>();
        for (let i = 0; i < 400 && seen.size < (o.chance !== undefined ? 2 : 1); i++) {
          const s = reduce(
            withEvent(ev, `reach-${i}`),
            { type: 'chooseEvent', optionId: o.id },
            ctx,
          );
          const last = s.log.findLast((e) => e.kind === 'event');
          if (last?.text === o.success.log) seen.add('success');
          if (o.failure && last?.text === o.failure.log) seen.add('failure');
        }
        expect([...seen].sort(), `${ev.id}/${o.id}`).toEqual(
          o.chance !== undefined ? ['failure', 'success'] : ['success'],
        );
      }
  });

  it('unaffordable options are refused', () => {
    const ev = content.events.find((e) => e.options.some((o) => o.cost))!;
    const o = ev.options.find((x) => x.cost)!;
    const s = withEvent(ev, 'poor');
    const broke = { ...s, ship: { ...s.ship, fuel: 0, lifeSupport: 0.5, materials: 0, data: 0 } };
    expect(() => reduce(broke, { type: 'chooseEvent', optionId: o.id }, ctx)).toThrow(/afford/);
  });
});
