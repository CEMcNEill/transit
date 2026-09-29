// Compiles content/ into packages/core/src/generated/content.json.
// Validates balance.json and every content/events/*.yaml against their JSON Schemas (Ajv),
// checks cross-file rules, and stamps a content version (FNV-1a of the canonical JSON).
// Run with: node scripts/build-content.ts  (Node's built-in TypeScript stripping)

import { Ajv, type ValidateFunction } from 'ajv';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { fnv1a } from '../src/rng.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const contentDir = join(root, 'content');
const outDir = fileURLToPath(new URL('../src/generated/', import.meta.url));

const readJson = (p: string): unknown => JSON.parse(readFileSync(p, 'utf8'));

export function compileContent(): { version: string; balance: unknown; events: unknown[] } {
  // strictRequired is off: the event schema's if/then/else uses `required` on properties declared
  // in the parent schema, which strictRequired rejects.
  const ajv = new Ajv({ allErrors: true, strict: true, strictRequired: false });
  const errors: string[] = [];
  const check = (validate: ValidateFunction, data: unknown, where: string) => {
    if (!validate(data)) {
      for (const e of validate.errors ?? []) errors.push(`${where}${e.instancePath}: ${e.message}`);
    }
  };

  const balanceSchema = ajv.compile(
    readJson(join(contentDir, 'schemas/balance.schema.json')) as object,
  );
  const eventSchema = ajv.compile(
    readJson(join(contentDir, 'schemas/event.schema.json')) as object,
  );

  const balance = readJson(join(contentDir, 'balance.json')) as Record<string, unknown>;
  check(balanceSchema, balance, 'balance.json');
  delete balance.$schema;

  const files = readdirSync(join(contentDir, 'events'))
    .filter((f) => f.endsWith('.yaml'))
    .sort();
  const events: Record<string, unknown>[] = [];
  for (const f of files) {
    const ev = parse(readFileSync(join(contentDir, 'events', f), 'utf8')) as Record<
      string,
      unknown
    >;
    check(eventSchema, ev, `events/${f}`);
    if (ev.id !== basename(f, '.yaml'))
      errors.push(`events/${f}: id '${String(ev.id)}' must match file name`);
    const options = (ev.options ?? []) as { id: string }[];
    const ids = options.map((o) => o.id);
    if (new Set(ids).size !== ids.length) errors.push(`events/${f}: duplicate option ids`);
    events.push(ev);
  }
  if (errors.length) throw new Error(`content validation failed:\n  ${errors.join('\n  ')}`);

  const body = JSON.stringify({ balance, events });
  const version = fnv1a(body).toString(16).padStart(8, '0');
  return { version, balance, events };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const content = compileContent();
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'content.json'), JSON.stringify(content, null, 1) + '\n');
  console.log(`content ${content.version}: ${content.events.length} events`);
}
