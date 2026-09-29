// One line of "what now" guidance for the current moment. Plain heuristics, never binding.

import { frontEta, jumpCost, mineYield, systemAt, type Ctx, type GameState } from '@transit/core';
import type { NumberedJump } from './jumps';

export interface Advice {
  tone: 'calm' | 'warn' | 'urgent';
  text: string;
}

export function advise(s: GameState, ctx: Ctx, jumps: NumberedJump[]): Advice {
  const b = ctx.content.balance;
  const sys = systemAt(s, s.position);
  const worlds = sys?.worlds ?? [];
  const eta = frontEta(s, ctx.sector, ctx.content);
  const cheapest = jumps.filter((j) => j.toward).reduce((m, j) => Math.min(m, j.fuel), Infinity);
  const fuelHere = worlds.some((w) => w.resources.fuel > 0 && (w.surveyed || !w.landable));
  const skim = worlds.find((w) => !w.landable && mineYield(s, ctx, w).fuel > 0);

  if (eta !== null && eta <= 1)
    return { tone: 'urgent', text: 'The front is about to reach this star. Jump now.' };
  if (s.ship.lifeSupport <= 4)
    return {
      tone: 'urgent',
      text: 'Life support is nearly gone. Mine an ocean or temperate world, or hope for a recycler cycle.',
    };
  if (s.ship.fuel < Math.max(cheapest, jumpCost(ctx.content, 8).fuel) * 1.5) {
    if (skim)
      return {
        tone: 'warn',
        text: `Fuel is low. Skim ${skim.name.split(' ').pop()} (the gas giant) for fuel.`,
      };
    if (fuelHere)
      return { tone: 'warn', text: 'Fuel is low. Land on a world with fuel and mine it.' };
    if (worlds.some((w) => !w.surveyed))
      return { tone: 'warn', text: 'Fuel is low. Survey the worlds here (free) to find fuel.' };
    return {
      tone: 'warn',
      text: 'Fuel is low and there is none here. Make a short jump to a new star and look there.',
    };
  }
  if (s.ship.hull < 40 && s.ship.materials >= b.repair.materialsPerAction)
    return {
      tone: 'warn',
      text: `Hull is weak. Repair costs ${b.repair.materialsPerAction} materials and a turn.`,
    };
  if (eta !== null && eta <= 3)
    return { tone: 'warn', text: `The front arrives in ${eta} turns. Keep moving.` };
  if (worlds.some((w) => !w.surveyed))
    return {
      tone: 'calm',
      text: 'Survey worlds (free, no turn) to see what they hold, or pick a jump.',
    };
  return { tone: 'calm', text: 'Pick a jump. ▲ marks jumps that bring you closer to the goal.' };
}
