import {
  hopsToGoal,
  jumpPreview,
  jumpTargets,
  type Ctx,
  type GameState,
  type JumpPreview,
} from '@transit/core';

export interface NumberedJump extends JumpPreview {
  /** 1-based number shown on the map and in the list (keys 1–9 select it). */
  n: number;
  /** On a shortest path to the goal. */
  toward: boolean;
}

/** Jump targets in display order: toward the goal first, then cheapest fuel. */
export function orderedJumps(state: GameState, ctx: Ctx): NumberedJump[] {
  const hops = hopsToGoal(ctx.sector, state.jumpRangeLy);
  const here = hops[state.position] ?? -1;
  return jumpTargets(state, ctx)
    .map((t) => {
      const p = jumpPreview(state, ctx, t.index);
      const h = hops[t.index] ?? -1;
      return p ? { ...p, n: 0, toward: here >= 0 && h >= 0 && h < here } : null;
    })
    .filter((p): p is NumberedJump => p !== null)
    .sort((a, b) => Number(b.toward) - Number(a.toward) || a.fuel - b.fuel)
    .map((p, i) => ({ ...p, n: i + 1 }));
}
