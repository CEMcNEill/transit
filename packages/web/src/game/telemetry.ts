// Local-only gameplay telemetry. Events append to a log in IndexedDB; export as JSON.
// track() is the single seam: a PostHog (or other) client can be added via setTelemetrySink.

import { clear, createStore, entries, set } from 'idb-keyval';

// Each flushed batch is its own record, so appending costs O(batch), not O(history).
const store = createStore('transit-telemetry', 'batches');
let batchSeq = 0;
const sessionId = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

export interface TelemetryEvent {
  t: number;
  event: string;
  props: Record<string, unknown>;
}

type Sink = (event: string, props: Record<string, unknown>) => void;
let sink: Sink | null = null;
let queue: TelemetryEvent[] = [];
let flushing: Promise<void> | null = null;

export function setTelemetrySink(fn: Sink | null): void {
  sink = fn;
}

export function track(event: string, props: Record<string, unknown> = {}): void {
  queue.push({ t: Date.now(), event, props });
  sink?.(event, props);
  void flush();
}

async function flush(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    while (queue.length) {
      const batch = queue;
      queue = [];
      try {
        const key = `${sessionId}-${String(batchSeq++).padStart(8, '0')}`;
        await set(key, batch, store);
      } catch {
        // Telemetry must never break the game.
      }
    }
  })();
  await flushing;
  flushing = null;
}

export async function readTelemetry(): Promise<TelemetryEvent[]> {
  await flush();
  const all = await entries<string, TelemetryEvent[]>(store);
  return all.flatMap(([, batch]) => batch).sort((a, b) => a.t - b.t);
}

export async function clearTelemetry(): Promise<void> {
  await clear(store);
}
