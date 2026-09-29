// Validates content/*.json against content/schemas at test time.
// (Event YAML validation joins this in Milestone 2.)
import { Ajv } from 'ajv';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const contentDir = fileURLToPath(new URL('../../../content/', import.meta.url));
const readJson = (rel: string): unknown => JSON.parse(readFileSync(contentDir + rel, 'utf8'));

describe('content', () => {
  it('balance.json matches its schema', () => {
    const ajv = new Ajv({ allErrors: true, strict: true });
    const validate = ajv.compile(readJson('schemas/balance.schema.json') as object);
    const ok = validate(readJson('balance.json'));
    expect(validate.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });
});
