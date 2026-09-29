import { useEffect, useState } from 'react';
import { loadSave } from './game/persistence';
import { installQuitTracking, resumeRun, startRun, useSession } from './game/session';
import { GameScreen } from './ui/GameScreen';
import { LabScreen } from './ui/LabScreen';
import { TitleScreen } from './ui/TitleScreen';

function useHash(): string {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

export function App() {
  const session = useSession();
  const hash = useHash();
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    installQuitTracking();
    // Continue an autosaved run; otherwise ?sector=&seed= starts one (used by the smoke test).
    void (async () => {
      try {
        const save = await loadSave();
        const params = new URLSearchParams(window.location.search);
        if (save) await resumeRun(save);
        else if (params.get('sector') && params.get('seed'))
          await startRun(params.get('sector') as string, params.get('seed') as string);
      } catch (e) {
        console.error(e);
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  if (hash === '#lab') return <LabScreen />;
  if (booting) return <main className="title-screen dim">Loading…</main>;
  if (session) return <GameScreen session={session} />;
  return <TitleScreen />;
}
