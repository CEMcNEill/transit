# Transit — Build Spec for Claude Code (Phase 0 + Phase 1)

Transit is a turn-based, non-violent exploration roguelike set among the real stars of the Kepler field. Star positions and confirmed planets are real (Gaia + NASA Exoplanet Archive); everything telescopes can't see is procedurally generated from a run seed. The player crosses a real sector of space with scarce fuel, life support, and hull. Design goals: **wonder** at real scale, and the **"one more turn"** pull of classic Civilization.

This spec covers only:
- **Phase 0: Sector data** (Python pipeline that bakes playable sectors from real data)
- **Phase 1: Core loop prototype** (deliberately plain 2D game proving the loop is fun)

Everything else (Observatory light-curve game, aliens, beacons/uplink, research tree, art, audio, 3D) is OUT OF SCOPE. Do not build it. Leave clean seams for it.

Target: local Ubuntu machine, browser game served locally. Later: Vercel + R2 (not now).

---

## Ground rules for the agent

1. Work milestone by milestone. At the end of each: run its acceptance checks, update `NOTES.md` (what works, measurements, deviations and why), then STOP and report. Don't start the next milestone until told.
2. Create a `CLAUDE.md` in M0 that restates these ground rules and the repo conventions, so they persist across sessions.
3. Cache every remote download in `raw/`, never re-fetch if cached (`--refresh` to force). `raw/` is permanent and gitignored.
4. Ask before any single download over 5 GB.
5. Inspect real source schemas before relying on column names. Adapt to reality and log differences in `NOTES.md`. Never invent columns, URLs, or values.
6. Tests never hit the network by default (`@pytest.mark.network` + `RUN_NETWORK_TESTS=1` to opt in).
7. Game logic is deterministic: no `Math.random()`, no `Date.now()` in `packages/core`. Enforce with an ESLint rule.
8. All balance numbers live in `content/balance.json`; all event text lives in `content/events/*.yaml`. No magic numbers in code.

---

## Stack

| Area | Choice |
| --- | --- |
| Pipeline | Python 3.12, `uv`, `astropy`, `astroquery`, `pandas`, `numpy`, `pyarrow`, `requests`, `pytest` |
| Game | TypeScript (strict), npm workspaces, Vite |
| Core | `packages/core`: pure TS, zero runtime deps except a YAML parser at build time |
| UI | `packages/web`: React 18, PixiJS v8 for the map canvas, Zustand for UI-only state |
| Saves | IndexedDB via `idb-keyval`; export/import JSON |
| Tests | Vitest (core), Playwright (smoke) |
| Content validation | JSON Schema (Ajv) at build time |

## Repo layout

```
transit/
  CLAUDE.md  NOTES.md  README.md  Makefile  .gitignore
  pipeline/                       # Python, uv project
    src/transit_pipeline/{config,fetch,stars,sectors,validate,cli}.py
    tests/
  packages/
    core/src/                     # pure game logic
      rng.ts  state.ts  actions.ts  reducer.ts  generate/  events/  clocks.ts  save.ts  sim/
    core/test/
    web/src/                      # React + Pixi UI
  content/
    balance.json
    events/*.yaml
    schemas/*.schema.json
  raw/                            # cached downloads (gitignored)
  data/sectors/                   # baked sector bundles (gitignored, served by Vite)
```

Makefile targets: `setup`, `data`, `test`, `sim`, `dev`, `e2e`, `clean-data` (never deletes `raw/`).

---

## Milestone 0 — Scaffold

- Layout above, uv project, npm workspaces, Vite app that renders "Transit", ESLint (with the no-Math.random rule), Prettier, Makefile, CLAUDE.md, README with setup/run.
- Accept: on a clean clone, `make setup && make test` passes.

---

## Milestone 1 — Sector data (Phase 0)

### Sources

| Need | Source | Notes |
| --- | --- | --- |
| Kepler targets | NASA Exoplanet Archive TAP, `keplerstellar` | `kepid`, `ra`, `dec`, `teff`, `radius`, `kepmag`; dedupe on kepid, record rule |
| Kepler–Gaia match | Gaia-Kepler.fun one-to-one DR3 crossmatch (https://gaia-kepler.fun/) | record exact file used |
| Planets + candidates | Exoplanet Archive TAP, `cumulative` | `kepid`, `kepoi_name`, `kepler_name`, `koi_disposition`, `koi_period`, `koi_prad`, `koi_sma`, `koi_teq`, false-positive flag columns |
| Neighbor stars | Gaia DR3 via `astroquery.gaia` (ADQL) | `source_id`, `ra`, `dec`, `parallax`, `parallax_over_error`, `phot_g_mean_mag`, `bp_rp`, `teff_gspphot`, `radius_gspphot`, `mh_gspphot` (nullable) |

TAP sync endpoint: `https://exoplanetarchive.ipac.caltech.edu/TAP/sync?query=<ADQL>&format=csv`.

### Critical data reality: distance precision

Gaia parallaxes get imprecise with distance. Beyond a few hundred parsecs, faint stars' distances scatter by tens of parsecs along the line of sight, which would smear a sector into radial streaks. Therefore:
- Only use stars with `parallax_over_error >= 10`. Distance = 1000 / parallax (pc). Convert to light-years for game data (1 pc = 3.2616 ly).
- Prefer sectors roughly 100–500 pc from the Sun. Report the actual distribution you find in NOTES.md.

### Sector shape: corridors

Real star density (~1 star per 10 pc³ near the Sun, less for a magnitude-limited sample) means a compact sphere either has too many stars or is too short to cross. Use **corridors**: a tube between a start point and a goal point inside the Kepler field's volume.

Parameters (put in `pipeline/src/transit_pipeline/config.py`, all tunable):
- Corridor length: ~200–300 ly; radius: ~25–40 ly
- Target star count per corridor: 300–1,500 (tune radius and/or a magnitude cut to hit it)
- Candidate corridors are scored by: count of Kepler planet hosts and KOIs inside, plus a bonus if a landmark star is inside (landmarks list in config: Kepler-16, Kepler-90, Kepler-444, KIC 8462852 / Boyajian's Star, Kepler-452, Kepler-186, Kepler-22, Kepler-10). Many landmarks will be too distant or imprecise to qualify; that's expected, record which qualify.
- Bake the top 10 scoring corridors that pass validation.

### Per-sector bundle: `data/sectors/<sector_id>.json`

```jsonc
{
  "id": "s01", "version": 1,
  "meta": { "lengthLy": 0, "radiusLy": 0, "starCount": 0, "hostCount": 0, "koiCount": 0, "landmarks": [] },
  "start": { "starIndex": 0 }, "goal": { "starIndex": 0 },
  "sunDirection": [0, 0, 0],            // unit vector from sector center toward the Sun
  "sunDistanceLy": 0,
  "stars": [
    {
      "id": "KIC 8311864" | "Gaia DR3 123...",
      "kepid": 8311864 | null, "gaiaId": "123..." | null,
      "name": "Kepler-452" | null,
      "pos": [x, y, z],                 // light-years, sector-local frame, origin at sector center
      "teff": 5757 | null, "radius": 1.1 | null, "mh": 0.2 | null, "gmag": 13.4,
      "flags": { "keplerTarget": true, "host": true, "koi": true, "landmark": false }
    }
  ],
  "planets": [ { "starIndex": 0, "koi": "K07016.01", "name": "Kepler-452 b" | null, "disposition": "CONFIRMED" | "CANDIDATE", "periodDays": 0, "radiusEarth": 0, "smaAu": 0, "teqK": 0, "fpFlags": { } } ],
  "neighbors": [ [ [otherIndex, distanceLy], ... ], ... ]   // per star, all within maxJumpRangeLy (30), sorted by distance
}
```

Also write `data/sectors/index.json` listing sectors with their meta.

### Validation (pytest, and run as part of `make data`)

- Each sector: star count within target band; no NaN positions; every planet references a valid star.
- Path check: a path exists from start to goal using only jumps of <= starting jump range (12 ly, read from `content/balance.json`). Report the shortest path length in jumps; target 25–45 (tune corridor length if not).
- Neighbor lists are symmetric and within max range.
- Unit tests on coordinate transforms against astropy (fixtures, no network).

Accept: `make data` produces 10 valid sectors; `NOTES.md` has a table per sector (stars, hosts, KOIs, landmarks, distance from Sun, shortest path in jumps, file size) and a note on which landmarks qualified.

---

## Milestone 2 — Game core (Phase 1, logic only)

Pure TypeScript. `(state, action) => state`. No DOM.

### Determinism
- `rng.ts`: string hash (xmur3 or FNV-1a) + PRNG (sfc32 or splitmix64). `seedFor(runSeed, ...path)` gives a stable sub-seed, e.g. `seedFor(run, "KIC 8311864", "planet", 2)`.
- Systems are generated lazily on first visit/scan and cached in state.
- Saves = `{ runSeed, sectorId, contentVersion, actions[] }`. Loading replays actions. Test: replay produces byte-identical state.

### State (minimum)
Ship (fuel, lifeSupport, hull, materials, data, cargo), position (star index), calendar (turn), visited/scanned sets, generated systems cache, front position, clocks, run status (active / won / lost + cause), log entries.

### System generation (text-level, from real star properties)
- Star class from `teff` (fallback from `bp_rp`).
- Confirmed planets are fixed slots with real values. KOI candidates resolve per run: planet / eclipsing binary / artifact, odds from `balance.json`, tilted by real false-positive flags.
- Procedural planets: 0–8, count weighted by star class; around Kepler targets they are flagged non-transiting. Orbits spaced by a simple ratio rule.
- World type from equilibrium temperature at orbit + size: rocky, super-Earth, ocean, ice, desert, lava, gas giant, ice giant, belt.
- Resources by world type (fuel: gas/ice giants and ice worlds; hull metals: rocky worlds, richer with higher `mh`; life support: temperate and ocean worlds). Quantities seeded.
- Hazard from star class (cool M dwarfs flare more; hot stars radiate).

### Actions
`jump(targetStarIndex)`, `survey(worldId)`, `land(worldId)`, `mine(worldId)`, `stay()` (push-your-luck: extra yield, rising hazard risk), `chooseEvent(optionId)`, `endTurn()` if needed by your design.

Rules from `balance.json`: jump cost = base + perLy x distance; life support drain per jump and per landing; hazard damage; landing risk. Run ends at zero fuel with no reachable refuel, zero life support, or zero hull (lost), or arriving at goal (won).

### The front
A slow threat advancing from the start end of the corridor. Position per turn from `balance.json`. Stars behind it are dangerous (heavy hull damage per turn spent there). Visible distance in state.

### One-more-turn infrastructure (build the framework now, even with few clocks)
- `clocks.ts`: a registry of timed things, each with `turnsRemaining`, a label, and an effect. Phase 1 clocks: front advance, stay-yield, a "signal decode" clock started by some events, and one delayed-reward event type.
- `nextUp(state)` returns the next 3 upcoming clock completions for the UI ticker.
- The horizon: sensor range reveals stars progressively; `revealed` set grows as you move.

### Events
- YAML files in `content/events/`, validated by JSON Schema: id, tags (star class, world type, first-visit, etc.), weight, text, 1–4 options each with visible costs, optional chance (shown to player), outcomes (resource deltas, start a clock, log line).
- Write 10 events for Phase 1: derelict salvage, flare warning, ice-moon fuel find, rough landing, strange signal (starts a decode clock), stellar wind, abandoned probe (delayed reward), temperate-world first sighting (a "first"), micrometeoroid swarm, quiet system (rest/repair trade-off).

### Simulation harness (very important)
`packages/core/src/sim/`: headless bots that play full runs (a random bot, a greedy-cheapest-jump bot, a cautious bot). `make sim` runs N=500 runs per bot per sector and prints: win rate, run length in jumps, cause of death distribution, turns between clock payoffs, resource curves. Use it to tune `balance.json` toward: greedy bot wins 30–60%, random bot rarely wins, median run 35–55 jumps, a clock payoff on most turns.

Tests (Vitest): determinism (same seed → same systems and same sim outcome), save/replay identity, every event validates and every outcome is reachable, no action ever produces negative resources without ending the run correctly.

Accept: tests pass; `make sim` report in NOTES.md with the tuned balance values.

---

## Milestone 3 — Playable prototype (Phase 1, UI)

Deliberately plain but already moody: dark background, thin lines, muted palette (greens, ambers, pale blues). No art assets, no audio.

- **Sector map (PixiJS):** stars as glowing dots colored by temperature; orthographic projection of 3D positions with drag-to-rotate and zoom; a thin drop line from each star to a reference plane for depth; revealed vs unrevealed stars; jump-range ring; reachable stars highlighted; the front drawn as a translucent band; goal marker; a faint marker and label for the direction and distance to the Sun ("Sol, 1,140 ly").
- **Star card on hover:** name/ID, class, distance in ly, "light left this star N years ago", Real data badge for Kepler hosts/confirmed planets.
- **Jump preview:** fuel and life support cost, known hazards, then confirm.
- **System panel (text):** star, worlds list with type/resources/hazards, actions (survey, land, mine, stay, leave).
- **Event dialog:** text, options with costs and shown odds.
- **HUD:** fuel, life support, hull, materials, data, turn, distance to the front, goal distance.
- **Next up ticker** on the end-turn / jump area: next 3 clock payoffs.
- **Run end screen:** cause, stats, "what you almost did" (nearest unfinished clock or distance to goal), New Run button.
- **Saves:** autosave each turn to IndexedDB; continue on reload; export/import JSON.
- **Telemetry (local only):** append gameplay events (turn start/end with duration, run start/end, quit point) to a local log in IndexedDB with an export button. Keep a thin `track(event, props)` wrapper so a PostHog client can be dropped in later.

Tests: `npm run typecheck`, `npm run build`, Playwright smoke: start a run with a fixed seed, make one jump, see the turn counter advance, reload, see the save restored.

Accept: a full run is playable start to finish in the browser; tests pass; NOTES.md records median turn time from 3 of your own runs using the telemetry export.

---

## Out of scope

Observatory and light-curve mini-game, sonification, KOI betting UI, beacons/uplink/outposts, aliens and language, research tree, Atlas/meta-progression, landmark story events, art, audio, cinematics, 3D, deployment.
