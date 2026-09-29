// Plays full runs with a bot and summarizes them. Pure: no I/O, no clock.

import type { Action } from '../actions.ts';
import type { Content } from '../content.ts';
import { newGame, reduce, type Ctx } from '../reducer.ts';
import { rngFor } from '../rng.ts';
import type { Sector } from '../sector.ts';
import type { GameState } from '../state.ts';
import type { BotDef } from './bots.ts';

export interface RunResult {
  bot: string;
  sectorId: string;
  seed: string;
  outcome: 'won' | 'lost' | 'timeout';
  cause: string | null;
  detail: string | null;
  jumps: number;
  turns: number;
  steps: number;
  payoffTurns: number[];
  /** [turn, fuel, lifeSupport, hull] sampled after every turn-advancing action. */
  samples: [number, number, number, number][];
  data: number;
  firsts: string[];
  events: number;
  koisResolved: number;
}

export const MAX_STEPS = 3000;

export function playRun(
  bot: BotDef,
  sector: Sector,
  content: Content,
  seed: string,
): { result: RunResult; state: GameState; actions: Action[] } {
  const ctx: Ctx = { sector, content };
  let s = newGame(seed, sector, content);
  const actions: Action[] = [];
  const samples: RunResult['samples'] = [[0, s.ship.fuel, s.ship.lifeSupport, s.ship.hull]];
  let steps = 0;
  while (s.status.kind === 'active' && steps < MAX_STEPS) {
    const rng = rngFor(seed, 'bot', bot.name, steps);
    const a = bot.play(s, ctx, rng);
    const turn = s.turn;
    s = reduce(s, a, ctx);
    actions.push(a);
    steps += 1;
    if (s.turn !== turn) samples.push([s.turn, s.ship.fuel, s.ship.lifeSupport, s.ship.hull]);
  }
  const st = s.status;
  return {
    state: s,
    actions,
    result: {
      bot: bot.name,
      sectorId: sector.id,
      seed,
      outcome: st.kind === 'active' ? 'timeout' : st.kind,
      cause: st.kind === 'lost' ? st.cause : null,
      detail: st.kind === 'lost' ? st.detail : null,
      jumps: s.stats.jumps,
      turns: s.turn,
      steps,
      payoffTurns: s.stats.payoffTurns,
      samples,
      data: s.ship.data,
      firsts: s.firsts,
      events: s.stats.events,
      koisResolved: s.stats.koisResolved,
    },
  };
}

// ---------------------------------------------------------------- aggregation

export interface BotSummary {
  bot: string;
  runs: number;
  winRate: number;
  medianJumps: number;
  medianJumpsWon: number | null;
  medianTurns: number;
  causes: Record<string, number>;
  /** Share of turns on which at least one reward clock paid off. */
  payoffTurnShare: number;
  /** Mean gap in turns between consecutive payoffs. */
  meanPayoffGap: number;
  maxPayoffGap: number;
  /** Mean [fuel, lifeSupport, hull] of runs still going, at turn 0, 10, 20, ... */
  curve: { turn: number; alive: number; fuel: number; lifeSupport: number; hull: number }[];
  medianData: number;
  eventsPerRun: number;
}

function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const a = [...xs].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? (a[m] as number) : ((a[m - 1] as number) + (a[m] as number)) / 2;
}

export function summarize(bot: string, results: RunResult[], curveStep = 10): BotSummary {
  const won = results.filter((r) => r.outcome === 'won');
  const causes: Record<string, number> = {};
  for (const r of results) {
    const key =
      r.outcome === 'won' ? 'won' : r.outcome === 'timeout' ? 'timeout' : `${r.cause}:${r.detail}`;
    causes[key] = (causes[key] ?? 0) + 1;
  }
  let turnsTotal = 0;
  let payoffTurnsTotal = 0;
  const gaps: number[] = [];
  for (const r of results) {
    turnsTotal += r.turns;
    payoffTurnsTotal += r.payoffTurns.length;
    let prev = 0;
    for (const t of r.payoffTurns) {
      gaps.push(t - prev);
      prev = t;
    }
    if (r.turns > prev) gaps.push(r.turns - prev);
  }
  const maxTurn = results.reduce((m, r) => Math.max(m, r.turns), 0);
  const curve: BotSummary['curve'] = [];
  for (let t = 0; t <= maxTurn; t += curveStep) {
    const at = results
      .map((r) => r.samples.find((x) => x[0] >= t && x[0] < t + curveStep))
      .filter((x): x is [number, number, number, number] => x !== undefined);
    if (at.length < Math.max(3, results.length * 0.05)) break;
    const mean = (i: 1 | 2 | 3) => at.reduce((a, x) => a + x[i], 0) / at.length;
    curve.push({ turn: t, alive: at.length, fuel: mean(1), lifeSupport: mean(2), hull: mean(3) });
  }
  return {
    bot,
    runs: results.length,
    winRate: won.length / results.length,
    medianJumps: median(results.map((r) => r.jumps)),
    medianJumpsWon: won.length ? median(won.map((r) => r.jumps)) : null,
    medianTurns: median(results.map((r) => r.turns)),
    causes,
    payoffTurnShare: turnsTotal ? payoffTurnsTotal / turnsTotal : 0,
    meanPayoffGap: gaps.length ? gaps.reduce((a, g) => a + g, 0) / gaps.length : 0,
    maxPayoffGap: gaps.reduce((m, g) => Math.max(m, g), 0),
    curve,
    medianData: median(results.map((r) => r.data)),
    eventsPerRun: results.reduce((a, r) => a + r.events, 0) / results.length,
  };
}
