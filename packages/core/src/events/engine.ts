// Event eligibility, rolling, and option views. Event text and numbers live in
// content/events/*.yaml; this module only interprets them.

import type { Content, EventDef, EventOption, EventTrigger } from '../content.ts';
import type { SystemState } from '../generate/system.ts';
import { rngFor } from '../rng.ts';
import type { GameState } from '../state.ts';

export interface EventContext {
  trigger: EventTrigger;
  system: SystemState;
  firstVisit: boolean;
  landedWorldType: string | null;
}

export function eligible(ev: EventDef, s: GameState, ctx: EventContext): boolean {
  if (ev.trigger !== ctx.trigger) return false;
  const t = ev.tags ?? {};
  if (t.once && s.eventsSeen.includes(ev.id)) return false;
  if (t.firstVisit !== undefined && t.firstVisit !== ctx.firstVisit) return false;
  if (t.minTurn !== undefined && s.turn < t.minTurn) return false;
  if (t.starClass && !t.starClass.includes(ctx.system.starClass)) return false;
  if (t.starHazard && !t.starHazard.includes(ctx.system.hazard.kind)) return false;
  if (t.temperateWorld !== undefined) {
    const has = ctx.system.worlds.some((w) => w.temperate);
    if (has !== t.temperateWorld) return false;
  }
  if (t.worldTypes) {
    const types =
      ctx.trigger === 'landing'
        ? ctx.landedWorldType
          ? [ctx.landedWorldType]
          : []
        : ctx.system.worlds.map((w) => w.type);
    if (!types.some((x) => (t.worldTypes as string[]).includes(x))) return false;
  }
  return true;
}

/** Maybe pick an event for this moment. Deterministic in (run, trigger, turn, star). */
export function rollEvent(s: GameState, content: Content, ctx: EventContext): EventDef | null {
  const chance = {
    arrival: content.balance.events.arrivalChance,
    landing: content.balance.events.landingChance,
    stay: content.balance.events.stayChance,
  }[ctx.trigger];
  const rng = rngFor(s.runSeed, 'event-roll', ctx.trigger, s.turn, ctx.system.starIndex);
  if (!rng.chance(chance)) return null;
  const pool = content.events.filter((e) => eligible(e, s, ctx));
  if (pool.length === 0) return null;
  return pool[rng.weightedIndex(pool.map((e) => e.weight))] ?? null;
}

export function findEvent(content: Content, id: string): EventDef {
  const ev = content.events.find((e) => e.id === id);
  if (!ev) throw new Error(`unknown event ${id}`);
  return ev;
}

export function canAfford(s: GameState, option: EventOption): boolean {
  for (const [k, v] of Object.entries(option.cost ?? {})) {
    if ((s.ship[k as keyof typeof option.cost & keyof GameState['ship']] as number) < (v ?? 0))
      return false;
  }
  return true;
}

export interface OptionView {
  id: string;
  label: string;
  cost: EventOption['cost'];
  chance: number | null;
  affordable: boolean;
}

export function optionViews(s: GameState, ev: EventDef): OptionView[] {
  return ev.options.map((o) => ({
    id: o.id,
    label: o.label,
    cost: o.cost,
    chance: o.chance ?? null,
    affordable: canAfford(s, o),
  }));
}
