# NOTES — Transit build log

## Milestone 0 — Scaffold (done 2026-09-29)

### What works

- **Layout:** matches the spec. `pipeline/` (uv project, module stubs for
  `config/fetch/stars/sectors/validate/cli`), `packages/core`, `packages/web`,
  `content/{balance.json,events/,schemas/}`. `raw/` and `data/` are gitignored.
- **Web:** the Vite + React 18 app renders a dark title screen reading "Transit". Checked with a
  headless Firefox screenshot of `make dev`. `npm run build` produces a static SPA of about 141 kB
  of JS (46 kB gzipped).
- **Determinism rule:** ESLint's `no-restricted-properties`, `no-restricted-syntax` and
  `no-restricted-globals` are scoped to `packages/core/src/**`. They ban `Math.random`,
  `Date.now`, `new Date()`, `performance.now`, `crypto.getRandomValues`, `crypto.randomUUID`,
  `window` and `document`. `packages/core/test/determinism-lint.test.ts` lints probe snippets
  through the ESLint API and asserts that core rejects them and web does not.
- **Content validation:** `content/balance.json` is validated against
  `content/schemas/balance.schema.json` with Ajv (strict mode) in Vitest.
- **Pipeline:** `config.py` holds the spec's corridor bands, landmarks, parallax cut and
  pc→ly constant, and reads jump ranges (12 / 30 ly) from `content/balance.json`. pytest checks
  pc→ly against astropy. `conftest.py` skips `@pytest.mark.network` tests unless
  `RUN_NETWORK_TESTS=1`, and I verified both modes. `transit-pipeline <fetch|bake|validate|all>`
  exists and exits 2 ("not implemented until Milestone 1").
- **Makefile:** `setup`, `data`, `test`, `sim`, `dev`, `build`, `e2e`, `clean-data`. `sim` and
  `e2e` print a "comes in M2/M3" message and exit 2. `clean-data` removes only `data/sectors`.

### Acceptance

`make setup && make test` passed (exit 0) in a fresh copy. The copy held only
`git ls-files -co --exclude-standard`, so no `node_modules`, `.venv` or `raw/`. Results: ESLint
and Prettier clean, ruff clean, both workspaces typecheck, Vitest 8/8, pytest 4 passed and 1
skipped (the network gate).

### Pinned versions

| Package                                                        | Version                          |
| -------------------------------------------------------------- | -------------------------------- |
| typescript                                                     | 6.0.3                            |
| vite / @vitejs/plugin-react                                    | 8.3.1 / 6.1.1                    |
| react, react-dom                                               | 18.3.1                           |
| @types/react / @types/react-dom                                | 18.3.31 / 18.3.7                 |
| vitest                                                         | 5.0.2                            |
| eslint / @eslint/js / typescript-eslint                        | 10.11.0 / 10.0.1 / 8.71.0        |
| eslint-plugin-react-hooks / globals                            | 7.1.1 / 17.12.0                  |
| prettier                                                       | 3.9.9                            |
| ajv / yaml                                                     | 8.20.0 / 2.9.1                   |
| @types/node                                                    | 22.20.4                          |
| Python                                                         | 3.12 (uv-managed; 3.12.8 local)  |
| astropy / astroquery                                           | 8.0.1 / 0.4.11                   |
| numpy / pandas / pyarrow                                       | 2.5.3 / 3.0.6 / 25.0.1           |
| requests / pytest / ruff                                       | 2.34.2 / 9.1.1 / 0.16.9          |
| Deferred to M3: pixi.js, zustand, idb-keyval, @playwright/test | 8.21.0 / 5.0.15 / 6.3.0 / 1.63.0 |

### Deviations and decisions

- **TypeScript is 6.0.3, not the latest (7.0.2).** typescript-eslint 8.71 declares
  `typescript <6.1.0`.
- **React is 18.3.1 as the spec requires, not the latest (19.x).**
- **Some dependencies are deferred.** PixiJS, Zustand, idb-keyval and Playwright are installed in
  M3 when first used, so `make setup` stays light and doesn't download browsers early.
- **Extra dev tools.** Added `ruff` (Python lint/format) and `hatchling` (build backend) to the
  pipeline. The spec's Python stack doesn't list them, but they are dev-only.
- **Balance keys.** `balance.json` holds only `jump.startingRangeLy` (12) and `jump.maxRangeLy`
  (30), the values M1 needs. The spec's `maxJumpRangeLy (30)` for neighbor lists lives here as
  `jump.maxRangeLy` so the pipeline and game share one source. M2 extends the schema.
- **Extra targets.** `make build` and `make lint` were added alongside the spec's targets.
- **Git.** The repo is `git init`ed but has no commits yet.
