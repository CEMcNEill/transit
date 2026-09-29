// Proves the ESLint determinism rule is live for packages/core, so a regression
// in eslint.config.js can't silently let Math.random or Date.now back in.
import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const eslint = new ESLint({ cwd: repoRoot });

async function ruleIdsFor(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => m.ruleId ?? 'fatal');
}

describe('determinism lint rule', () => {
  const corePath = 'packages/core/src/__probe__.ts';

  it.each([
    'export const x = Math.random();',
    'export const x = Date.now();',
    'export const x = new Date();',
    'export const x = performance.now();',
    'export const x = crypto.getRandomValues(new Uint32Array(1));',
  ])('rejects %s in core', async (code) => {
    const ids = await ruleIdsFor(code, corePath);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => id.startsWith('no-restricted'))).toBe(true);
  });

  it('allows deterministic code in core', async () => {
    expect(await ruleIdsFor('export const x = Math.floor(1.5);', corePath)).toEqual([]);
  });

  it('does not apply to the web package', async () => {
    const ids = await ruleIdsFor('export const x = Date.now();', 'packages/web/src/__probe__.ts');
    expect(ids).toEqual([]);
  });
});
