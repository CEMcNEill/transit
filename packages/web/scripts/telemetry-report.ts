// Summarize a telemetry export: per-run outcome, turns, and median turn time.
//   node scripts/telemetry-report.ts transit-telemetry.json

import { readFileSync } from 'node:fs';

interface Ev {
  t: number;
  event: string;
  props: Record<string, unknown>;
}

const events = JSON.parse(
  readFileSync(process.argv[2] ?? 'transit-telemetry.json', 'utf8'),
) as Ev[];
const median = (xs: number[]) => {
  const a = [...xs].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length === 0
    ? NaN
    : a.length % 2
      ? (a[m] as number)
      : ((a[m - 1] as number) + (a[m] as number)) / 2;
};

interface Run {
  sector: string;
  seed: string;
  turnMs: number[];
  outcome: string;
  turns: number;
  startedAt: number;
  endedAt: number;
}
const runs: Run[] = [];
let cur: Run | null = null;
for (const e of events) {
  if (e.event === 'run_start') {
    cur = {
      sector: String(e.props.sectorId),
      seed: String(e.props.runSeed),
      turnMs: [],
      outcome: 'unfinished',
      turns: 0,
      startedAt: e.t,
      endedAt: e.t,
    };
    runs.push(cur);
  } else if (cur && e.event === 'turn_end') {
    cur.turnMs.push(Number(e.props.durationMs));
  } else if (cur && e.event === 'run_end') {
    cur.outcome = `${String(e.props.outcome)}${e.props.cause ? ` (${String(e.props.cause)})` : ''}`;
    cur.turns = Number(e.props.turns);
    cur.endedAt = e.t;
    cur = null;
  }
}
const all: number[] = [];
for (const r of runs) {
  all.push(...r.turnMs);
  console.log(
    `${r.sector} ${r.seed}: ${r.outcome}, ${r.turns} turns, median turn ${(median(r.turnMs) / 1000).toFixed(2)} s, run length ${((r.endedAt - r.startedAt) / 1000).toFixed(0)} s`,
  );
}
console.log(
  `all runs: ${runs.length} runs, ${all.length} turns, median turn time ${(median(all) / 1000).toFixed(2)} s`,
);
const quits = events.filter((e) => e.event === 'quit_point');
if (quits.length)
  console.log(`quit points: ${quits.map((q) => `turn ${String(q.props.turn)}`).join(', ')}`);
