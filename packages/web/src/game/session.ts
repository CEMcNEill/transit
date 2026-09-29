// The running game: sector, state, and action log. A tiny external store (React reads it with
// useSyncExternalStore); UI-only state lives in Zustand (ui.ts). Every action autosaves.

import {
  defaultContent,
  makeSave,
  newGame,
  reduce,
  replay,
  type Action,
  type Ctx,
  type GameState,
  type SaveFile,
} from '@transit/core';
import { useSyncExternalStore } from 'react';
import { loadSector } from './data';
import { clearSave, writeSave } from './persistence';
import { track } from './telemetry';

export interface Session {
  ctx: Ctx;
  state: GameState;
  actions: Action[];
  /** Star indices in the order the ship visited them (for drawing the route). */
  route: number[];
}

let session: Session | null = null;
const listeners = new Set<() => void>();
let turnStartedAt = 0;

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useSession(): Session | null {
  return useSyncExternalStore(subscribe, () => session);
}

export function getSession(): Session | null {
  return session;
}

function routeOf(ctx: Ctx, actions: Action[]): number[] {
  const route = [ctx.sector.start.starIndex];
  for (const a of actions) if (a.type === 'jump') route.push(a.target);
  return route;
}

function persist(s: Session): void {
  void writeSave(makeSave(s.state.runSeed, s.ctx, s.actions));
}

export async function startRun(sectorId: string, runSeed: string): Promise<void> {
  const sector = await loadSector(sectorId);
  const ctx: Ctx = { sector, content: defaultContent };
  const state = newGame(runSeed, sector, defaultContent);
  session = { ctx, state, actions: [], route: routeOf(ctx, []) };
  persist(session);
  turnStartedAt = Date.now();
  track('run_start', { sectorId, runSeed, contentVersion: defaultContent.version });
  track('turn_start', { turn: 0 });
  emit();
}

export async function resumeRun(save: SaveFile): Promise<void> {
  const sector = await loadSector(save.sectorId);
  const ctx: Ctx = { sector, content: defaultContent };
  const state = replay(save, ctx);
  session = { ctx, state, actions: [...save.actions], route: routeOf(ctx, save.actions) };
  turnStartedAt = Date.now();
  track('run_resume', { sectorId: save.sectorId, turn: state.turn, actions: save.actions.length });
  emit();
}

export function dispatch(action: Action): void {
  if (!session) return;
  const before = session.state;
  const state = reduce(before, action, session.ctx);
  const actions = [...session.actions, action];
  session = {
    ...session,
    state,
    actions,
    route: action.type === 'jump' ? [...session.route, action.target] : session.route,
  };
  persist(session);
  track('action', { type: action.type, turn: before.turn });
  if (state.turn !== before.turn) {
    const now = Date.now();
    track('turn_end', { turn: before.turn, durationMs: now - turnStartedAt, action: action.type });
    turnStartedAt = now;
    track('turn_start', { turn: state.turn });
  }
  if (state.status.kind !== 'active') {
    track('run_end', {
      sectorId: session.ctx.sector.id,
      outcome: state.status.kind,
      cause: state.status.kind === 'lost' ? state.status.cause : null,
      turns: state.turn,
      jumps: state.stats.jumps,
    });
  }
  emit();
}

export async function endSession(): Promise<void> {
  if (session && session.state.status.kind === 'active') {
    track('run_abandon', { sectorId: session.ctx.sector.id, turn: session.state.turn });
  }
  session = null;
  await clearSave();
  emit();
}

export function currentSave(): SaveFile | null {
  return session ? makeSave(session.state.runSeed, session.ctx, session.actions) : null;
}

/** Record where players stop: fired when the page is hidden or closed mid-run. */
export function installQuitTracking(): void {
  const onHide = () => {
    if (session && session.state.status.kind === 'active') {
      track('quit_point', {
        sectorId: session.ctx.sector.id,
        turn: session.state.turn,
        msIntoTurn: Date.now() - turnStartedAt,
        pendingEvent: session.state.pendingEvent?.eventId ?? null,
      });
    }
  };
  window.addEventListener('pagehide', onHide);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') onHide();
  });
}
