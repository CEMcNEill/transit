// make sim: headless bot runs over every baked sector, printing a balance report.
//   node scripts/sim.ts [--runs 500] [--sectors s01,s02] [--bots greedy,random]
// Writes data/sim/report.json and data/sim/report.md.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { defaultContent } from '../src/content.ts';
import type { Sector } from '../src/sector.ts';
import { BOTS } from '../src/sim/bots.ts';
import { playRun, summarize, type BotSummary, type RunResult } from '../src/sim/runner.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const sectorsDir = join(root, 'data/sectors');
const outDir = join(root, 'data/sim');

const { values } = parseArgs({
  options: {
    runs: { type: 'string', default: '500' },
    sectors: { type: 'string' },
    bots: { type: 'string' },
    quiet: { type: 'boolean', default: false },
  },
});
const runs = Number(values.runs);
const index = JSON.parse(readFileSync(join(sectorsDir, 'index.json'), 'utf8')) as {
  sectors: { id: string; file: string }[];
};
const wantSectors = values.sectors?.split(',');
const sectors: Sector[] = index.sectors
  .filter((e) => !wantSectors || wantSectors.includes(e.id))
  .map((e) => JSON.parse(readFileSync(join(sectorsDir, e.file), 'utf8')) as Sector);
const bots = BOTS.filter((b) => !values.bots || values.bots.split(',').includes(b.name));
const content = defaultContent;

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const t0 = performance.now();
const all: Record<string, RunResult[]> = {};
const perSector: Record<string, Record<string, number>> = {};
for (const bot of bots) {
  all[bot.name] = [];
  for (const sector of sectors) {
    const results: RunResult[] = [];
    for (let i = 0; i < runs; i++) results.push(playRun(bot, sector, content, `sim-${i}`).result);
    all[bot.name]?.push(...results);
    (perSector[sector.id] ??= {})[bot.name] =
      results.filter((r) => r.outcome === 'won').length / runs;
  }
}
const elapsed = (performance.now() - t0) / 1000;
const summaries: BotSummary[] = bots.map((b) => summarize(b.name, all[b.name] ?? []));

const lines: string[] = [];
lines.push(
  `Content ${content.version} · ${runs} runs per bot per sector · ${sectors.length} sectors · ${elapsed.toFixed(1)}s`,
);
lines.push('');
lines.push(
  '| Bot | Win rate | Median jumps (all / won) | Median turns | Payoff on % of turns | Mean / max gap between payoffs | Events per run | Median data |',
);
lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
for (const s of summaries) {
  lines.push(
    `| ${s.bot} | ${pct(s.winRate)} | ${s.medianJumps} / ${s.medianJumpsWon ?? '—'} | ${s.medianTurns} | ${pct(s.payoffTurnShare)} | ${s.meanPayoffGap.toFixed(2)} / ${s.maxPayoffGap} | ${s.eventsPerRun.toFixed(1)} | ${s.medianData} |`,
  );
}
lines.push('');
lines.push('Outcomes:');
lines.push('');
for (const s of summaries) {
  const causes = Object.entries(s.causes)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${pct(v / s.runs)}`)
    .join(', ');
  lines.push(`- ${s.bot}: ${causes}`);
}
lines.push('');
lines.push(`| Sector | ${bots.map((b) => b.name).join(' | ')} |`);
lines.push(`| --- | ${bots.map(() => '---').join(' | ')} |`);
for (const sector of sectors) {
  lines.push(
    `| ${sector.id} | ${bots.map((b) => pct(perSector[sector.id]?.[b.name] ?? 0)).join(' | ')} |`,
  );
}
lines.push('');
lines.push('Resource curves (mean of runs still going: fuel / life support / hull):');
lines.push('');
for (const s of summaries) {
  const pts = s.curve.map(
    (c) =>
      `t${c.turn}: ${c.fuel.toFixed(0)}/${c.lifeSupport.toFixed(0)}/${c.hull.toFixed(0)} (${c.alive})`,
  );
  lines.push(`- ${s.bot}: ${pts.join(' · ')}`);
}
const report = lines.join('\n');
if (!values.quiet) console.log(report);
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'report.md'), report + '\n');
writeFileSync(
  join(outDir, 'report.json'),
  JSON.stringify({ content: content.version, runs, summaries, perSector }, null, 1),
);
