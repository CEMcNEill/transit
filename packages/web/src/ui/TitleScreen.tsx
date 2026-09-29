import { GAME_TITLE } from '@transit/core';
import { useEffect, useState } from 'react';
import { loadIndex, type SectorIndexEntry } from '../game/data';
import { downloadJson, loadSave, pickJsonFile } from '../game/persistence';
import { resumeRun, startRun } from '../game/session';
import { readTelemetry } from '../game/telemetry';
import { parseSave } from '@transit/core';

function randomSeed(): string {
  const words = [
    'quiet',
    'pale',
    'amber',
    'distant',
    'slow',
    'cold',
    'bright',
    'lone',
    'drifting',
    'faint',
  ];
  const nouns = [
    'transit',
    'signal',
    'wake',
    'light',
    'orbit',
    'harbor',
    'ember',
    'parallax',
    'shore',
    'tide',
  ];
  const r = new Uint32Array(3);
  crypto.getRandomValues(r);
  return `${words[r[0]! % words.length]}-${nouns[r[1]! % nouns.length]}-${r[2]! % 1000}`;
}

export function TitleScreen() {
  const [sectors, setSectors] = useState<SectorIndexEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sectorId, setSectorId] = useState<string>('');
  const [seed, setSeed] = useState(randomSeed);
  const [busy, setBusy] = useState(false);
  const [hasSave, setHasSave] = useState(false);

  useEffect(() => {
    loadIndex().then(
      (s) => {
        setSectors(s);
        setSectorId((cur) => cur || s[0]?.id || '');
      },
      (e: Error) => setError(e.message),
    );
    void loadSave().then((s) => setHasSave(s !== null && s.actions !== undefined));
  }, []);

  const begin = async () => {
    setBusy(true);
    try {
      await startRun(sectorId, seed.trim() || randomSeed());
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const importSave = async () => {
    const text = await pickJsonFile();
    if (!text) return;
    try {
      await resumeRun(parseSave(text));
    } catch (e) {
      setError(`Could not load that save: ${(e as Error).message}`);
    }
  };

  const selected = sectors?.find((s) => s.id === sectorId);
  return (
    <main className="title-screen">
      <h1>{GAME_TITLE}</h1>
      <p className="tagline">Cross a real corridor of the Kepler field, one jump at a time.</p>
      {error && <p className="warn">{error}</p>}
      {sectors && (
        <div className="setup">
          <label>
            Sector
            <select
              value={sectorId}
              onChange={(e) => setSectorId(e.target.value)}
              data-testid="sector-select"
            >
              {sectors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.id} ·{' '}
                  {s.meta.landmarks.length
                    ? s.meta.landmarks.join(', ')
                    : `${s.meta.hostCount} hosts`}{' '}
                  · {Math.round(s.sunDistanceLy).toLocaleString('en-US')} ly
                </option>
              ))}
            </select>
          </label>
          {selected && (
            <p className="dim small">
              {selected.meta.starCount.toLocaleString('en-US')} real stars ·{' '}
              {selected.meta.hostCount} planet hosts · {selected.meta.koiCount} Kepler candidates ·{' '}
              {Math.round(selected.meta.lengthLy)} ly long · at least{' '}
              {selected.meta.shortestPathJumps} jumps
            </p>
          )}
          <label>
            Run seed
            <input
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              data-testid="seed-input"
            />
          </label>
          <div className="title-actions">
            <button
              className="primary"
              disabled={busy || !sectorId}
              onClick={() => void begin()}
              data-testid="begin"
            >
              Begin crossing
            </button>
            {hasSave && (
              <button onClick={() => void loadSave().then((s) => s && resumeRun(s))}>
                Continue run
              </button>
            )}
            <button onClick={() => void importSave()}>Import save</button>
          </div>
        </div>
      )}
      <nav className="title-links">
        <button
          className="link"
          onClick={() =>
            void readTelemetry().then((t) => downloadJson('transit-telemetry.json', t))
          }
        >
          export telemetry
        </button>
        <a href="#lab">lab: sectors &amp; balance</a>
      </nav>
    </main>
  );
}
