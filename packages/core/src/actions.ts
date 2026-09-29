// Player actions. The reducer applies them; legalActions() enumerates them for bots and UI.

export type Action =
  | { type: 'jump'; target: number }
  | { type: 'survey'; worldId: string }
  | { type: 'land'; worldId: string }
  | { type: 'mine'; worldId: string }
  /** Push your luck: work the system another turn for a growing yield and a growing risk. */
  | { type: 'stay' }
  /** Spend materials to patch the hull (takes a turn). */
  | { type: 'repair' }
  | { type: 'chooseEvent'; optionId: string };

export type ActionType = Action['type'];

export class IllegalAction extends Error {
  readonly action: Action;
  constructor(action: Action, reason: string) {
    super(`${action.type}: ${reason}`);
    this.action = action;
  }
}
