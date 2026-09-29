// UI-only state (never part of the game state or saves).

import { create } from 'zustand';

interface UiState {
  hovered: number | null;
  hoverAt: { x: number; y: number } | null;
  selected: number | null;
  showLog: boolean;
  setHover(i: number | null, at: { x: number; y: number } | null): void;
  select(i: number | null): void;
  toggleLog(): void;
}

export const useUi = create<UiState>((set) => ({
  hovered: null,
  hoverAt: null,
  selected: null,
  showLog: true,
  setHover: (hovered, hoverAt) => set({ hovered, hoverAt }),
  select: (selected) => set({ selected }),
  toggleLog: () => set((s) => ({ showLog: !s.showLog })),
}));
