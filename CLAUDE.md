# CLAUDE.md — Transit

Transit is a turn-based, non-violent exploration roguelike set among the real stars of the Kepler
field. The full build spec is `TRANSIT_BUILD_SPEC.md`; progress, measurements and deviations are in
`NOTES.md`. Read both before starting work.

Design goals: **wonder** at the real scale of space, and the **"one more turn"** pull of classic
Civilization. When the spec doesn't decide something, pick the option that serves those two goals
better.

Current scope: Phase 0 (sector data pipeline) and Phase 1 (core loop prototype) only. Out of
scope, so don't build it: the Observatory and light-curve game, sonification, the KOI betting UI,
beacons/uplink/outposts, aliens, the research tree, Atlas/meta-progression, landmark story events,
art, audio, cinematics, 3D, and deployment. Leave clean seams for these.

## Ground rules

1. **One milestone at a time.** At the end of each milestone, run its acceptance checks and update
   `NOTES.md` (what works, measurements, deviations and why). Then STOP and report. Don't start
   the next milestone until told.
2. This file restates the ground rules and repo conventions so they carry across sessions. Keep
   it current.
3. **Cache every remote download in `raw/`.** Never re-fetch a cached file unless `--refresh` is
   passed. `raw/` is permanent and gitignored. Nothing, including `make clean-data`, ever deletes it.
4. **Ask the user before any single download over 5 GB.** Check the size first with a HEAD
   request or the archive's row count.
5. **Inspect real source schemas before relying on column names.** Adapt to what the data
   actually contains and log any difference from the spec in `NOTES.md`. Never invent columns,
   URLs or values.
6. **Tests never hit the network by default.** Mark network tests `@pytest.mark.network`. They
   run only with `RUN_NETWORK_TESTS=1`.
7. **Game logic is deterministic.** `packages/core` never uses `Math.random()`, `Date.now()`,
   `new Date()`, `performance.now()` or `crypto` randomness. ESLint enforces this, and
   `packages/core/test/determinism-lint.test.ts` checks that the rule stays active. All
   randomness comes from `rng.ts` via `seedFor(runSeed, ...path)`.
8. **No magic numbers.** Balance numbers go in `content/balance.json`, which is validated by
   `content/schemas/balance.schema.json`. Event text goes in `content/events/*.yaml`. The pipeline
   also reads jump ranges from `balance.json`.

## Repo conventions

- **Layout:** `pipeline/` (Python 3.12, uv), `packages/core` (pure TS logic), `packages/web`
  (React 18 + Vite; PixiJS and Zustand arrive in M3), `content/` (balance, events, schemas),
  `raw/` (download cache), `data/sectors/` (baked bundles, gitignored).
- **Commands:** `make setup`, `make test` (lint + format check + typecheck + Vitest + pytest),
  `make data`, `make sim`, `make dev`, `make build`, `make e2e`, `make clean-data`.
- **Pinned versions:** npm installs use `--save-exact`, and `package-lock.json` is committed.
  Python deps are pinned with `==` in `pipeline/pyproject.toml`, and `uv.lock` is committed.
  `make setup` uses `npm ci` and `uv sync --frozen`.
- **TypeScript:** kept at 6.0.x because typescript-eslint 8.71 supports `<6.1`. Upgrade both
  together. Strict mode is on, including `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes`.
- **Core code:** TypeScript imports use `.ts` extensions (`erasableSyntaxOnly`), so Node 22
  runs `packages/core/scripts/*.ts` directly. Content is compiled by
  `packages/core/scripts/build-content.ts` into the gitignored `src/generated/content.json`. It
  runs automatically before typecheck, test and sim; run it by hand after editing `content/`.
- **Randomness:** no mutable RNG in state. Every roll is `rngFor(runSeed, ...context)` with a
  context unique to that decision, so replay is exact. Tests prove byte-identical replay.
- **Balance changes:** run `make sim` (or `make sim SIM_ARGS="--runs 50"` for quick checks) and
  record the result in NOTES.md.
- **Formatting:** TS/JS/JSON/CSS/MD use Prettier (100 columns, single quotes). Python uses ruff
  (100 columns).
- **Web build:** must stay a plain static Vite SPA. No server runtime and no Node APIs in
  `packages/web`, so it can deploy to Vercel and be wrapped by Tauri unchanged.
- **Visual mood (M3):** dark, quiet, sensors-style map. Thin lines and muted greens, ambers and
  pale blues. No art assets or audio.
- **Units:** game data uses light-years (1 pc = 3.2616 ly), and distances use only Gaia stars with
  `parallax_over_error >= 10`.

## Local preview (tailnet + Glance)

The user wants **everything built to be viewable on their tailnet and listed on their Glance
dashboard.** When a milestone adds something worth looking at (a new page, a sector viewer,
reports), make it reachable the same way and add or refresh its Glance entry.

- `transit-dev.service` (systemd user unit, outside the repo) runs the Vite dev server on
  `127.0.0.1:8460` with hot reload. `tailscale serve` exposes it tailnet-only on HTTPS port `8459`.
- The unit sets `TRANSIT_DEV_HOST` and `TRANSIT_HMR_CLIENT_PORT`, which `packages/web/vite.config.ts`
  reads so Vite accepts the proxied hostname. Don't hard-code the tailnet hostname in this public
  repo.
- Glance config is `~/.config/glance/glance.yml` (the "Transit (dev)" tile under Creative & media,
  plus a Restart button). The restart allowlist is in `~/.local/share/glance/restarter.py`. Back
  up either file before editing it (`*.bak-<date>-<topic>`). Glance hot-reloads its config.
