// Read-only views of state for bots and UI.

import type { Action } from './actions.ts';
import { findEvent, optionViews, type OptionView } from './events/engine.ts';
import { starClass, type World } from './generate/system.ts';
import { canMine, jumpCost, jumpTargets, mineYield, systemAt, type Ctx } from './reducer.ts';
import type { Sector } from './sector.ts';
import type { GameState } from './state.ts';

export function legalActions(s: GameState, ctx: Ctx): Action[] {
  if (s.status.kind !== 'active') return [];
  if (s.pendingEvent) {
    const ev = findEvent(ctx.content, s.pendingEvent.eventId);
    return optionViews(s, ev)
      .filter((o) => o.affordable)
      .map((o) => ({ type: 'chooseEvent', optionId: o.id }));
  }
  const out: Action[] = [];
  for (const t of jumpTargets(s, ctx)) {
    if (jumpCost(ctx.content, t.distance).fuel <= s.ship.fuel)
      out.push({ type: 'jump', target: t.index });
  }
  const sys = systemAt(s, s.position);
  for (const w of sys?.worlds ?? []) {
    if (!w.surveyed) out.push({ type: 'survey', worldId: w.id });
    if (w.landable && s.landedOn !== w.id) out.push({ type: 'land', worldId: w.id });
    if (canMine(s, w) && Object.values(mineYield(s, ctx, w)).some((v) => v > 0))
      out.push({ type: 'mine', worldId: w.id });
  }
  out.push({ type: 'stay' });
  const b = ctx.content.balance;
  if (s.ship.materials >= b.repair.materialsPerAction && s.ship.hull < b.ship.max.hull)
    out.push({ type: 'repair' });
  return out;
}

export interface JumpPreview {
  target: number;
  distanceLy: number;
  fuel: number;
  lifeSupport: number;
  affordable: boolean;
  /** Known before arrival: star-class hazard, and whether the front will be behind you. */
  hazard: { kind: string; chance: number };
  behindFront: boolean;
  visited: boolean;
  progressLy: number;
}

export function jumpPreview(s: GameState, ctx: Ctx, target: number): JumpPreview | null {
  const t = jumpTargets(s, ctx).find((x) => x.index === target);
  const star = ctx.sector.stars[target];
  const here = ctx.sector.stars[s.position];
  if (!t || !star || !here) return null;
  const cost = jumpCost(ctx.content, t.distance);
  const b = ctx.content.balance;
  // The star's spectrum is in the catalog, so its class hazard is known before arrival.
  const hz = b.stars.hazard[starClass(star, b)];
  return {
    target,
    distanceLy: t.distance,
    fuel: cost.fuel,
    lifeSupport: cost.lifeSupport + b.lifeSupport.perTurn,
    affordable: cost.fuel <= s.ship.fuel,
    hazard: { kind: hz.kind, chance: hz.chance },
    behindFront: star.pos[0] < s.frontX + b.front.speedLyPerTurn,
    visited: s.visited.includes(target),
    progressLy: goalDistance(ctx, s.position) - goalDistance(ctx, target),
  };
}

export function goalDistance(ctx: Ctx, from: number): number {
  const a = ctx.sector.stars[from]?.pos;
  const g = ctx.sector.stars[ctx.sector.goal.starIndex]?.pos;
  if (!a || !g) return Infinity;
  return Math.hypot(a[0] - g[0], a[1] - g[1], a[2] - g[2]);
}

/** Distance from the front to the ship along the corridor (negative = behind it). */
export function frontDistance(s: GameState, ctx: Ctx): number {
  return (ctx.sector.stars[s.position]?.pos[0] ?? 0) - s.frontX;
}

export interface EventView {
  id: string;
  title: string;
  text: string;
  options: OptionView[];
}

export function pendingEventView(s: GameState, ctx: Ctx): EventView | null {
  if (!s.pendingEvent) return null;
  const ev = findEvent(ctx.content, s.pendingEvent.eventId);
  return { id: ev.id, title: ev.title, text: ev.text, options: optionViews(s, ev) };
}

export function landedWorld(s: GameState): World | null {
  if (!s.landedOn) return null;
  return systemAt(s, s.position)?.worlds.find((w) => w.id === s.landedOn) ?? null;
}

const hopCache = new WeakMap<Sector, Map<number, Int32Array>>();

/** Fewest jumps from every star to the goal with the given jump range (-1 = unreachable). */
export function hopsToGoal(sector: Sector, rangeLy: number): Int32Array {
  let byRange = hopCache.get(sector);
  if (!byRange) hopCache.set(sector, (byRange = new Map()));
  const cached = byRange.get(rangeLy);
  if (cached) return cached;
  const hops = new Int32Array(sector.stars.length).fill(-1);
  const goal = sector.goal.starIndex;
  hops[goal] = 0;
  const queue = [goal];
  for (let q = 0; q < queue.length; q++) {
    const u = queue[q] as number;
    for (const [v, d] of sector.neighbors[u] ?? []) {
      if (d > rangeLy) break;
      if (hops[v] === -1) {
        hops[v] = (hops[u] as number) + 1;
        queue.push(v);
      }
    }
  }
  byRange.set(rangeLy, hops);
  return hops;
}
