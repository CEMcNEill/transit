// A read-only view of the baked sectors and the latest balance sim, for checking the data.

import { useEffect, useState } from 'react';
import { loadIndex, type SectorIndexEntry } from '../game/data';

interface SimSummary {
  bot: string;
  runs: number;
  winRate: number;
  medianJumps: number;
  medianJumpsWon: number | null;
  medianTurns: number;
  payoffTurnShare: number;
  causes: Record<string, number>;
}

export function LabScreen() {
  const [sectors, setSectors] = useState<SectorIndexEntry[]>([]);
  const [sim, setSim] = useState<{ content: string; runs: number; summaries: SimSummary[] } | null>(
    null,
  );
  useEffect(() => {
    void loadIndex().then(setSectors, () => undefined);
    void fetch('/sim/report.json')
      .then((r) => (r.ok ? r.json() : null))
      .then(setSim, () => undefined);
  }, []);
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  return (
    <main className="lab">
      <a href="#">← back</a>
      <h1>Lab</h1>
      <h2>Sectors</h2>
      <table>
        <thead>
          <tr>
            <th>Sector</th>
            <th>Stars</th>
            <th>Hosts</th>
            <th>KOIs</th>
            <th>Landmarks</th>
            <th>From Sol</th>
            <th>Length × radius</th>
            <th>Shortest path</th>
            <th>File</th>
          </tr>
        </thead>
        <tbody>
          {sectors.map((s) => (
            <tr key={s.id}>
              <td>{s.id}</td>
              <td>{s.meta.starCount}</td>
              <td>{s.meta.hostCount}</td>
              <td>{s.meta.koiCount}</td>
              <td>{s.meta.landmarks.join(', ') || '—'}</td>
              <td>{Math.round(s.sunDistanceLy).toLocaleString('en-US')} ly</td>
              <td>
                {Math.round(s.meta.lengthLy)} × {Math.round(s.meta.radiusLy)} ly
              </td>
              <td>{s.meta.shortestPathJumps} jumps</td>
              <td>{Math.round(s.bytes / 1024).toLocaleString('en-US')} KB</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Balance sim</h2>
      {sim ? (
        <>
          <p className="dim">
            content {sim.content} · {sim.runs} runs per bot per sector
          </p>
          <table>
            <thead>
              <tr>
                <th>Bot</th>
                <th>Win rate</th>
                <th>Median jumps (all / won)</th>
                <th>Median turns</th>
                <th>Payoff turns</th>
                <th>Top outcomes</th>
              </tr>
            </thead>
            <tbody>
              {sim.summaries.map((s) => (
                <tr key={s.bot}>
                  <td>{s.bot}</td>
                  <td>{pct(s.winRate)}</td>
                  <td>
                    {s.medianJumps} / {s.medianJumpsWon ?? '—'}
                  </td>
                  <td>{s.medianTurns}</td>
                  <td>{pct(s.payoffTurnShare)}</td>
                  <td className="small">
                    {Object.entries(s.causes)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 4)
                      .map(
                        ([k, v]) =>
                          `${k.split(':')[0]}${k.includes(':') ? ` (${k.split(':')[1]})` : ''} ${pct(v / s.runs)}`,
                      )
                      .join(' · ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <p className="dim">No sim report yet. Run `make sim`.</p>
      )}
    </main>
  );
}
