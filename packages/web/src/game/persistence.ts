// Saves live in IndexedDB (idb-keyval). One active run; export/import as JSON files.

import { parseSave, type SaveFile } from '@transit/core';
import { del, get, set } from 'idb-keyval';

const SAVE_KEY = 'transit:save';

export async function loadSave(): Promise<SaveFile | null> {
  try {
    const raw = await get<string>(SAVE_KEY);
    return raw ? parseSave(raw) : null;
  } catch {
    return null;
  }
}

export async function writeSave(save: SaveFile): Promise<void> {
  await set(SAVE_KEY, JSON.stringify(save));
}

export async function clearSave(): Promise<void> {
  await del(SAVE_KEY);
}

export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function pickJsonFile(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      file.text().then(resolve, () => resolve(null));
    };
    input.click();
  });
}
