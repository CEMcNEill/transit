// Saves are the run seed, sector, content version, and the action list. Loading replays.

import type { Action } from './actions.ts';
import { newGame, reduce, type Ctx } from './reducer.ts';
import type { GameState } from './state.ts';

export const SAVE_FORMAT = 1;

export interface SaveFile {
  format: typeof SAVE_FORMAT;
  runSeed: string;
  sectorId: string;
  contentVersion: string;
  actions: Action[];
}

export class SaveMismatch extends Error {}

export function makeSave(runSeed: string, ctx: Ctx, actions: Action[]): SaveFile {
  return {
    format: SAVE_FORMAT,
    runSeed,
    sectorId: ctx.sector.id,
    contentVersion: ctx.content.version,
    actions: [...actions],
  };
}

/** Rebuild state by replaying every action from a fresh game. */
export function replay(save: SaveFile, ctx: Ctx): GameState {
  if (save.sectorId !== ctx.sector.id)
    throw new SaveMismatch(`save is for sector ${save.sectorId}, not ${ctx.sector.id}`);
  if (save.contentVersion !== ctx.content.version)
    throw new SaveMismatch(
      `save was made with content ${save.contentVersion}; this build has ${ctx.content.version}`,
    );
  let s = newGame(save.runSeed, ctx.sector, ctx.content);
  for (const a of save.actions) s = reduce(s, a, ctx);
  return s;
}

export function parseSave(json: string): SaveFile {
  const v = JSON.parse(json) as Partial<SaveFile>;
  if (
    v.format !== SAVE_FORMAT ||
    typeof v.runSeed !== 'string' ||
    typeof v.sectorId !== 'string' ||
    typeof v.contentVersion !== 'string' ||
    !Array.isArray(v.actions)
  )
    throw new SaveMismatch('not a Transit save file');
  return v as SaveFile;
}
