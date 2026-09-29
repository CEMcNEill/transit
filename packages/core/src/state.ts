// Game state. Plain JSON data only: saves are {runSeed, sectorId, contentVersion, actions} and
// loading replays the actions, so state must serialize identically on every replay.

import type { Cargo, ClockPayoff, Deltas, EventTrigger } from './content.ts';
import type { SystemState } from './generate/system.ts';

export interface Ship {
  fuel: number;
  lifeSupport: number;
  hull: number;
  materials: number;
  data: number;
  cargo: Cargo;
}

export type ClockKind =
  'recycler' | 'sensor-sweep' | 'analysis' | 'spectrum' | 'stay-yield' | 'decode' | 'delayed';

export interface Clock {
  id: number;
  kind: ClockKind;
  label: string;
  turnsRemaining: number;
  /** Recurring clocks reset to this many turns after paying off. */
  every: number | null;
  /** Clocks bound to a star are cancelled when the ship leaves it. */
  starIndex: number | null;
  payoff: ClockPayoff;
}

export type LossCause = 'hull' | 'lifeSupport' | 'stranded';

export type RunStatus =
  { kind: 'active' } | { kind: 'won' } | { kind: 'lost'; cause: LossCause; detail: string };

export type LogKind = 'info' | 'good' | 'bad' | 'event' | 'clock' | 'first' | 'real';

export interface LogEntry {
  turn: number;
  kind: LogKind;
  text: string;
}

export interface PendingEvent {
  eventId: string;
  trigger: EventTrigger;
  starIndex: number;
  worldId: string | null;
}

export interface RunStats {
  jumps: number;
  lyTraveled: number;
  landings: number;
  mines: number;
  surveys: number;
  stays: number;
  repairs: number;
  events: number;
  clockPayoffs: number;
  /** Turns on which at least one clock paid off. */
  payoffTurns: number[];
  koisResolved: number;
  koisConfirmed: number;
}

export interface GameState {
  runSeed: string;
  sectorId: string;
  contentVersion: string;
  turn: number;
  ship: Ship;
  position: number;
  landedOn: string | null;
  jumpRangeLy: number;
  /** Sorted star indices. */
  visited: number[];
  /** Sorted star indices seen by sensors. */
  revealed: number[];
  /** Generated systems, keyed by star index. */
  systems: Record<string, SystemState>;
  /** Resource caches placed by decoded signals, keyed by star index. */
  caches: Record<string, Deltas>;
  /** Position of the front along the sector's x axis (ly). Stars with x < frontX are behind it. */
  frontX: number;
  clocks: Clock[];
  nextClockId: number;
  stayStreak: number;
  pendingEvent: PendingEvent | null;
  eventsSeen: string[];
  firsts: string[];
  lastDamage: string | null;
  status: RunStatus;
  log: LogEntry[];
  stats: RunStats;
}
