// Headless bots for balance tuning. Pure functions of (state, ctx, rng).

import type { Action } from '../actions.ts';
import type { EventOption, Outcome } from '../content.ts';
import { canAfford, findEvent } from '../events/engine.ts';
import type { World } from '../generate/system.ts';
import { canMine, jumpCost, jumpTargets, mineYield, systemAt, type Ctx } from '../reducer.ts';
import type { Rng } from '../rng.ts';
import { frontDistance, hopsToGoal, legalActions } from '../selectors.ts';
import type { GameState } from '../state.ts';

export type Bot = (s: GameState, ctx: Ctx, rng: Rng) => Action;

export interface BotDef {
  name: string;
  play: Bot;
}

// ---------------------------------------------------------------- shared helpers

const VALUE = { fuel: 1, lifeSupport: 1.2, hull: 0.4, materials: 0.4, data: 0.1 } as const;

function outcomeValue(o: Outcome, hullWeight: number): number {
  let v = 0;
  for (const [k, d] of Object.entries(o.deltas ?? {})) {
    const w = k === 'hull' && (d ?? 0) < 0 ? hullWeight : VALUE[k as keyof typeof VALUE];
    v += (d ?? 0) * w;
  }
  if (o.clock) v += 3;
  if (o.passTurns) v -= 2 * o.passTurns;
  return v;
}

function optionValue(o: EventOption, hullWeight: number): number {
  let v = 0;
  for (const [k, c] of Object.entries(o.cost ?? {})) v -= (c ?? 0) * VALUE[k as keyof typeof VALUE];
  const p = o.chance ?? 1;
  v += p * outcomeValue(o.success, hullWeight);
  if (o.failure) v += (1 - p) * outcomeValue(o.failure, hullWeight);
  return v;
}

function chooseOption(s: GameState, ctx: Ctx, hullWeight: number): Action {
  const ev = findEvent(ctx.content, s.pendingEvent?.eventId ?? '');
  const best = ev.options
    .filter((o) => canAfford(s, o))
    .map((o) => ({ o, v: optionValue(o, hullWeight) }))
    .sort((a, b) => b.v - a.v)[0];
  if (!best) throw new Error(`no affordable option for ${ev.id}`);
  return { type: 'chooseEvent', optionId: best.o.id };
}

function worlds(s: GameState): World[] {
  return systemAt(s, s.position)?.worlds ?? [];
}

/** Land on or mine the best source of a resource here, if any (and if there's room for it). */
function gather(
  s: GameState,
  ctx: Ctx,
  res: 'fuel' | 'lifeSupport' | 'materials',
  maxRisk: number,
): Action | null {
  const src = worlds(s)
    .filter(
      (w) =>
        w.resources[res] > 0 && (!w.landable || w.landingRisk <= maxRisk || s.landedOn === w.id),
    )
    .sort((a, b) => b.resources[res] - a.resources[res])[0];
  if (!src) return null;
  if (canMine(s, src))
    return mineYield(s, ctx, src)[res] > 0 ? { type: 'mine', worldId: src.id } : null;
  if (src.landable && s.landedOn !== src.id) return { type: 'land', worldId: src.id };
  return null;
}

interface JumpOption {
  target: number;
  cost: number;
  /** Hops to goal saved by this jump: 1 = on a shortest path, 0 = sideways, <0 = backward. */
  progress: number;
  x: number;
}

function jumpOptions(s: GameState, ctx: Ctx): JumpOption[] {
  const hops = hopsToGoal(ctx.sector, s.jumpRangeLy);
  const here = hops[s.position] ?? -1;
  return jumpTargets(s, ctx)
    .map((t) => {
      const there = hops[t.index] ?? -1;
      return {
        target: t.index,
        cost: jumpCost(ctx.content, t.distance).fuel,
        progress: here < 0 || there < 0 ? -99 : here - there,
        x: ctx.sector.stars[t.index]?.pos[0] ?? 0,
      };
    })
    .filter((j) => j.cost <= s.ship.fuel);
}

// ---------------------------------------------------------------- bots

/** Uniformly random legal action. */
export const randomBot: Bot = (s, ctx, rng) => {
  const acts = legalActions(s, ctx);
  return rng.pick(acts);
};

/** Always takes the cheapest jump (fuel per light-year of progress); refuels only when forced. */
export const greedyBot: Bot = (s, ctx) => {
  if (s.pendingEvent) return chooseOption(s, ctx, 0.4);
  const b = ctx.content.balance;
  const opts = jumpOptions(s, ctx);
  const cheapest = opts.filter((j) => j.progress > 0).sort((a, c) => a.cost - c.cost)[0];
  const needFuel =
    !cheapest ||
    s.ship.fuel < jumpCost(ctx.content, b.jump.startingRangeLy).fuel ||
    s.ship.fuel < 0.6 * b.ship.max.fuel;
  if (needFuel) {
    // Greedy about jumps, not suicidal: top up whenever fuel is right here.
    const g = gather(s, ctx, 'fuel', 1);
    if (g) return g;
  }
  if (s.ship.lifeSupport < 6) {
    const g = gather(s, ctx, 'lifeSupport', 1);
    if (g) return g;
  }
  if (cheapest) return { type: 'jump', target: cheapest.target };
  const any = opts.sort((a, c) => c.progress - a.progress)[0];
  if (any) return { type: 'jump', target: any.target };
  return { type: 'stay' };
};

/** Surveys everything, keeps reserves high, repairs, avoids hazards, runs when the front nears. */
export const cautiousBot: Bot = (s, ctx) => {
  if (s.pendingEvent) return chooseOption(s, ctx, 1.5);
  const b = ctx.content.balance;
  const max = b.ship.max;
  const frontGap = frontDistance(s, ctx);
  const urgent = frontGap < b.front.warnDistanceLy;

  if (!urgent) {
    const unsurveyed = worlds(s).find((w) => !w.surveyed);
    if (unsurveyed) return { type: 'survey', worldId: unsurveyed.id };
    if (s.ship.hull < 60 && s.ship.materials >= b.repair.materialsPerAction)
      return { type: 'repair' };
    for (const res of ['fuel', 'lifeSupport'] as const) {
      if (s.ship[res] < 0.6 * max[res]) {
        const g = gather(s, ctx, res, 0.15);
        if (g) return g;
      }
    }
    if (s.ship.materials < b.repair.materialsPerAction * 2) {
      const g = gather(s, ctx, 'materials', 0.15);
      if (g) return g;
    }
  } else if (s.ship.fuel < jumpCost(ctx.content, 8).fuel) {
    const g = gather(s, ctx, 'fuel', 1);
    if (g) return g;
  }

  const opts = jumpOptions(s, ctx).filter((j) => j.x > s.frontX + b.front.speedLyPerTurn);
  const scored = opts
    .map((j) => {
      const sys = systemAt(s, j.target);
      const hz = sys ? sys.hazard.chance : 0;
      return { j, score: j.progress * 10 - j.cost - hz * 20 };
    })
    .sort((a, c) => c.score - a.score);
  const best = scored[0];
  if (best && best.j.progress > 0) return { type: 'jump', target: best.j.target };
  const g = gather(s, ctx, 'fuel', 1);
  if (g) return g;
  if (best) return { type: 'jump', target: best.j.target };
  const fallback = jumpOptions(s, ctx).sort((a, c) => c.progress - a.progress)[0];
  if (fallback) return { type: 'jump', target: fallback.target };
  return { type: 'stay' };
};

export const BOTS: BotDef[] = [
  { name: 'random', play: randomBot },
  { name: 'greedy', play: greedyBot },
  { name: 'cautious', play: cautiousBot },
];
