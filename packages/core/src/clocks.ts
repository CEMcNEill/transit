// The one-more-turn machinery: a registry of timed things that pay off on future turns.
//
// Every clock kind is declared here with how it behaves. The front is not a stored clock (it
// moves continuously), but nextUp() reports its arrival as a derived entry so the UI ticker
// always shows the threat alongside the rewards.

import type { ClockPayoff, Content } from './content.ts';
import type { Sector } from './sector.ts';
import type { Clock, ClockKind, GameState } from './state.ts';

export interface ClockKindInfo {
  /** Cancelled when the ship leaves the star the clock is bound to. */
  cancelOnLeave: boolean;
  /** Counts toward "a payoff on most turns" (the front never does). */
  reward: boolean;
}

export const CLOCK_KINDS: Record<ClockKind, ClockKindInfo> = {
  recycler: { cancelOnLeave: false, reward: true },
  'sensor-sweep': { cancelOnLeave: false, reward: true },
  analysis: { cancelOnLeave: false, reward: true },
  spectrum: { cancelOnLeave: false, reward: true },
  'stay-yield': { cancelOnLeave: true, reward: true },
  decode: { cancelOnLeave: false, reward: true },
  delayed: { cancelOnLeave: false, reward: true },
};

export function addClock(
  s: GameState,
  kind: ClockKind,
  label: string,
  turns: number,
  payoff: ClockPayoff,
  opts: { every?: number; starIndex?: number } = {},
): Clock {
  const clock: Clock = {
    id: s.nextClockId++,
    kind,
    label,
    turnsRemaining: turns,
    every: opts.every ?? null,
    starIndex: opts.starIndex ?? null,
    payoff,
  };
  s.clocks.push(clock);
  return clock;
}

/** Drop clocks bound to a star the ship just left. */
export function cancelOnLeave(s: GameState, leftStar: number): Clock[] {
  const cancelled = s.clocks.filter(
    (c) => CLOCK_KINDS[c.kind].cancelOnLeave && c.starIndex === leftStar,
  );
  if (cancelled.length) s.clocks = s.clocks.filter((c) => !cancelled.includes(c));
  return cancelled;
}

/** Advance every clock one turn; returns the clocks that completed this turn (in id order). */
export function tickClocks(s: GameState): Clock[] {
  const done: Clock[] = [];
  const keep: Clock[] = [];
  for (const c of s.clocks) {
    const next = { ...c, turnsRemaining: c.turnsRemaining - 1 };
    if (next.turnsRemaining > 0) {
      keep.push(next);
      continue;
    }
    done.push(next);
    if (next.every) keep.push({ ...next, turnsRemaining: next.every });
  }
  s.clocks = keep;
  return done;
}

export interface UpcomingPayoff {
  label: string;
  turns: number;
  kind: ClockKind | 'front';
  /** Short description of what it pays, for the ticker. */
  detail: string;
}

function describePayoff(p: ClockPayoff): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(p.deltas ?? {}))
    if (v) parts.push(`${v > 0 ? '+' : ''}${v} ${k}`);
  if (p.revealCache) parts.push('coordinates');
  for (const [k, v] of Object.entries(p.cargo ?? {})) parts.push(`${v} ${k}`);
  return parts.join(', ');
}

/** Turns until the front reaches the ship's current star (0 = it is already here). */
export function frontEta(s: GameState, sector: Sector, content: Content): number | null {
  const x = sector.stars[s.position]?.pos[0];
  const speed = content.balance.front.speedLyPerTurn;
  if (x === undefined || speed <= 0) return null;
  const gap = x - s.frontX;
  return gap <= 0 ? 0 : Math.ceil(gap / speed);
}

/** The next three upcoming completions, soonest first, for the UI ticker. */
export function nextUp(
  s: GameState,
  sector: Sector,
  content: Content,
  count = 3,
): UpcomingPayoff[] {
  const items: (UpcomingPayoff & { order: number })[] = s.clocks.map((c) => ({
    label: c.label,
    turns: c.turnsRemaining,
    kind: c.kind,
    detail: describePayoff(c.payoff),
    order: c.id,
  }));
  const eta = frontEta(s, sector, content);
  if (eta !== null) {
    items.push({
      label: eta === 0 ? 'The front is here' : 'Front reaches this star',
      turns: eta,
      kind: 'front',
      detail: `-${content.balance.front.hullDamagePerTurn} hull per turn behind it`,
      order: -1,
    });
  }
  items.sort((a, b) => a.turns - b.turns || a.order - b.order);
  return items.slice(0, count).map(({ order: _order, ...rest }) => rest);
}
