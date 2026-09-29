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

### Local preview (added after M0 review)

- The Vite dev server runs as the user unit `transit-dev.service` on `127.0.0.1:8460`. It is
  exposed tailnet-only via `tailscale serve --https=8459` and survives reboots.
- Glance has a "Transit (dev)" monitor tile and a Transit restart button. The button was tested
  end to end: a POST restarted the unit and the tailnet URL returned 200 afterwards.
- `vite.config.ts` reads `TRANSIT_DEV_HOST` / `TRANSIT_HMR_CLIENT_PORT` so the tailnet hostname
  stays out of the public repo. `vite.config.ts` is now typechecked through its own
  `tsconfig.node.json` (Node types), so browser code can't pick up Node APIs.

## Milestone 1 — Sector data (done 2026-09-29)

`make data` (= `transit-pipeline all`) fetches or uses cached sources, bakes 10 sectors to
`data/sectors/`, writes `index.json` (with provenance and stats) and `report.md`, then validates.
A warm-cache rebuild takes about 45 s. `make test` includes 36 offline pytest tests (coordinate
transforms against astropy, loaders, validator failure cases, and validation of the baked
sectors when present). The 4 network tests pass with `RUN_NETWORK_TESTS=1`.

### Sectors

These were re-baked during Milestone 2: the corridor length was tuned to hit the sim's run-length
target (see M2, deviation 1). This table is the current bake.

| Sector | Stars | Hosts | KOIs (stars) | Landmarks              | Distance from Sun (center) | Length × radius | G cut | Shortest path (≤12 ly jumps) | File     |
| ------ | ----- | ----- | ------------ | ---------------------- | -------------------------- | --------------- | ----- | ---------------------------- | -------- |
| s01    | 1500  | 13    | 30 (22)      | Kepler-186 (goal)      | 668 ly                     | 212 × 40 ly     | 18.06 | 26 jumps                     | 2,290 KB |
| s02    | 1500  | 13    | 25 (18)      | Kepler-22 (goal)       | 798 ly                     | 323 × 36 ly     | 18.05 | 39 jumps                     | 1,970 KB |
| s03    | 1500  | 17    | 38 (21)      | —                      | 965 ly                     | 316 × 38 ly     | 18.07 | 39 jumps                     | 1,805 KB |
| s04    | 1500  | 16    | 33 (21)      | —                      | 965 ly                     | 328 × 35 ly     | 18.34 | 43 jumps                     | 1,936 KB |
| s05    | 1500  | 16    | 22 (21)      | —                      | 1,354 ly                   | 355 × 37 ly     | 18.96 | 45 jumps                     | 1,710 KB |
| s06    | 1500  | 15    | 27 (22)      | —                      | 966 ly                     | 347 × 35 ly     | 18.55 | 42 jumps                     | 1,883 KB |
| s07    | 1500  | 15    | 40 (21)      | —                      | 1,029 ly                   | 327 × 38 ly     | 18.13 | 44 jumps                     | 1,795 KB |
| s08    | 920   | 8     | 16 (12)      | Kepler-452 (goal)      | 1,688 ly                   | 232 × 38 ly     | —     | 34 jumps                     | 926 KB   |
| s09    | 1500  | 13    | 25 (20)      | —                      | 1,130 ly                   | 290 × 39 ly     | 18.53 | 35 jumps                     | 1,875 KB |
| s10    | 1177  | 6     | 14 (9)       | Boyajian's Star (goal) | 1,358 ly                   | 212 × 38 ly     | —     | 26 jumps                     | 1,568 KB |

- **Columns:**
  - "KOIs" counts non-false-positive KOIs (CONFIRMED and CANDIDATE) and equals `planets.length`.
    The number in parentheses is the stars carrying them.
  - "G cut" is the Gaia G magnitude limit applied to ordinary stars when a tube held more than
    1,500 stars. Hosts, KOI stars and landmarks are always kept.
- **Size:** all 10 bundles total 20.5 MB, and 12,511 distinct stars appear across the sectors.
  The 30 ly neighbor lists are the bulk of each file.
- **Starts:** each start is the star nearest the tube's start end.
- **Goals:** each goal is a landmark, host or KOI star within 25 ly of the far end if there is
  one; otherwise the nearest star.

### Landmarks

| Landmark                      | Qualifies?             | Why                                                                                                                                                                            |
| ----------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Kepler-452                    | yes, s08 goal          | 1,807 ly (554 pc). Qualifies only because the band was widened to 600 pc (deviation 4).                                                                                        |
| Kepler-186                    | yes, s01 goal          | 579 ly (178 pc)                                                                                                                                                                |
| Kepler-22                     | yes, s02 goal          | 644 ly (198 pc)                                                                                                                                                                |
| Boyajian's Star (KIC 8462852) | yes, s10 goal          | 1,447 ly (443 pc)                                                                                                                                                              |
| Kepler-10                     | in range but no sector | 607 ly (186 pc). Its few valid corridors either overlap the Kepler-186 and Kepler-22 sectors by more than 20% or fail the path band. A shorter first bake had it mid-corridor. |
| Kepler-16                     | no                     | Too close: its parallax is above the 12 mas query limit (under ~83 pc), and the field's cone is too narrow there for a 25–40 ly tube.                                          |
| Kepler-444                    | no                     | Too close, for the same reason (about 36 pc).                                                                                                                                  |
| Kepler-90                     | no                     | Too far: beyond the 1.6 mas query floor (about 625 pc).                                                                                                                        |

Near landmarks (about 180–200 pc) sit where the Kepler field's cone is only about 160 ly wide.
Their targeted candidate tubes are oriented roughly along the line of sight (random tilt 0.4) and
may be 200–340 ly long. After the landmark phase, other corridors get no landmark bonus for a
landmark that already has a sector, which prevents duplicates.

### Real distance distribution

The query volume holds all Gaia DR3 stars within 10° of the field center, with parallax 1.6–12
mas and `parallax_over_error >= 10`. That's 267,152 stars, 32,430 of them Kepler targets.

| pc             | 0–100 | 100–150 | 150–200 | 200–250 | 250–300 | 300–350 | 350–400 | 400–450 | 450–500 | 500–550 | 550–600 | 600–700 |
| -------------- | ----- | ------- | ------- | ------- | ------- | ------- | ------- | ------- | ------- | ------- | ------- | ------- |
| All stars      | 1,015 | 5,290   | 10,002  | 14,854  | 20,405  | 26,142  | 29,846  | 32,340  | 34,741  | 36,283  | 37,177  | 19,057* |
| Kepler targets | 226   | 990     | 1,455   | 1,817   | 2,261   | 2,781   | 3,086   | 3,663   | 4,066   | 4,514   | 4,950   | 2,621*  |

\* The 600–700 pc bin is truncated by the query's parallax floor.

For all 196,762 crossmatched Kepler targets with `parallax_over_error >= 10`, the median distance
is 1,124 pc: 5% are within 339 pc and 25% within 743 pc. Most Kepler targets lie well beyond
distances where parallaxes are precise, which is why corridors cluster at 500–1,800 ly from the
Sun.

### Search

- **Sampling:** 20,000 random tubes (length 280–360 ly after M2 tuning; radius 25–40 ly), each
  centered on a random in-band star, plus 400 targeted tubes per landmark that end at that
  landmark. The search is seeded, so it's reproducible.
- **Acceptance:** 3,709 tubes passed geometry and star count. Rejections: axis leaves the Kepler
  footprint (15,776), outside the distance band (1,985), tube leaves the query cone (72).
- **Selection:** landmarks first (preferring a tube that ends at the landmark), then by score
  (3 × hosts + 1 × KOI stars + 25 × landmarks not yet covered). No two sectors may share more
  than 20% of the smaller one's stars.
- **Path checks:** 14 tubes were checked to choose 10. One was too short and three too long.

### Sources (exact inputs; full list with sha256 in `raw/manifest.json`)

- **Exoplanet Archive** TAP sync (`/TAP/sync`), fetched 2026-09-29:
  - `keplerstellar`: kepid, ra, dec, teff, radius, kepmag, st_delivname. 990,244 rows, 200,038
    kepids.
  - `cumulative`: kepid, kepoi_name, kepler_name, koi_disposition, koi_period, koi_prad, koi_sma,
    koi_teq, koi_fpflag_nt/ss/co/ec, koi_score.
  - `keplernames`: kepid, koi_name, kepler_name.
- **Kepler–Gaia crossmatch:** `kepler_dr3_good.fits`, the "one-to-one match" DR3 table from
  Megan Bedell's gaia-kepler.fun (last updated 2022-06-15), downloaded from
  `https://www.dropbox.com/s/pk5cgwjxanczn6b/kepler_dr3_good.fits?dl=1`. 95,264,640 bytes, sha256
  `ce5837a1…a5a3b0`. 196,762 rows.
- **Gaia DR3:** `gaiadr3.gaia_source` via the ESA archive TAP sync endpoint, in 103 RA/Dec tiles
  (one of which split into quarters after a timeout) under
  `raw/gaia_dr3/gaia_source_cone_290.637_+44.526_a40eef46/`. `radius_gspphot` comes from
  `gaiadr3.astrophysical_parameters` by source_id, for sector stars only. It was found for 10,220
  of 12,975.

### Deviations from the spec, and why

1. **gaia-kepler.fun is gone.** The domain is a Namecheap parking page, and HTTPS hangs. The
   site's source is still on GitHub (`megbedell/gaia-kepler.fun`), and its `index.html` links the
   DR3 files on Dropbox. I used the file that page labels "one-to-one match". It is a crossmatch
   against `q1_q17_dr25_stellar`.
2. **`radius_gspphot` is not in `gaiadr3.gaia_source`.** It is in
   `gaiadr3.astrophysical_parameters`, confirmed with `Gaia.load_table` (`transit-pipeline
inspect` writes the column lists to `raw/schemas/`). Joining that table into the cone query
   made tiles about 4× slower and caused sync timeouts, so radius is fetched separately by
   source_id, only for stars in baked sectors.
3. **The Gaia archive was slow and unstable** (its own banner cites DR4 preparation). The async
   queue sat in EXECUTING for over 30 s even on `TOP 5` queries, so tiles use sync queries.
   Tiles that time out split into quarters, and each tile is cached separately. Requests go
   straight to the TAP endpoints rather than through `astroquery` job objects, so timeouts and
   retries are under our control; astroquery is still used for schema inspection. Tile folders
   are keyed by a hash of the query, so a changed query can never mix with cached results.
   Partial tiles from an abandoned joined query remain in
   `raw/gaia_dr3/abandoned_joined_query_*` and are unused.
4. **Preferred distance band widened from 100–500 pc to 100–600 pc** so Kepler-452 (554 pc)
   qualifies as a landmark. This serves the wonder goal. The `parallax_over_error >= 10` cut
   still applies to every star.
5. **Kepler target dedupe rule.** `keplerstellar` has one row per kepid per delivery (5
   deliveries). The pipeline keeps the newest delivery, in order DR25-supp, DR25, DR24, Q16, Q12,
   and fails loudly on an unknown delivery name. Result: 197,096 DR25-supp rows and 2,942 DR25
   rows. 188 kepids have no ra/dec in any delivery.
6. **Crossmatch is not quite one-to-one on the Gaia side.** 12 Gaia sources match two KICs. The
   pipeline keeps the KIC with the smaller Kepler–Gaia separation.
7. **Hosts come from `keplernames`, not just `cumulative`.** Kepler-16 b (discovered from eclipse
   timing) has no `cumulative` row. Host flags and star names use `keplernames`; `planets[]`
   still comes only from `cumulative`, as the spec says, so a host like that gets its name and
   flag but no planet slot.
8. **Star values.** `teff` and `radius` prefer the Kepler stellar catalog for Kepler targets and
   fall back to Gaia GSP-Phot. `mh` is Gaia `mh_gspphot`. Extra fields beyond the spec: `bpRp`
   (lets the game infer a Teff for the stars that lack one), `distLy` (distance from the Sun),
   `meta.koiStarCount`, `meta.shortestPathJumps`, `meta.gmagCut`, `meta.centerRaDec`,
   `meta.score`, and `planets[].koiScore`. `fpFlags` keys are `notTransitLike`,
   `stellarEclipse`, `centroidOffset` and `ephemerisMatch`.
9. **Sector frame.** x runs along the corridor from start to goal. z points toward the galactic
   north pole, projected perpendicular to x. y = z × x. The origin is the tube's midpoint. Stars
   are stored in order of increasing x.
10. **Field geometry.** The field center (RA 290.637°, Dec 44.526°) is derived from the Kepler
    targets' extent. The footprint is the targets' occupied 0.25° tangent-plane cells, dilated by
    one cell. A corridor's axis must stay inside the footprint and the distance band, and the
    whole tube must fit inside the 10° query cone so no star is cut off.
11. **Added `scipy`** (KD-tree for tube membership and neighbor lists) and `ruff`.

## Milestone 2 — Game core (done 2026-09-29)

Pure TypeScript in `packages/core`. `reduce(state, action, {sector, content}) => state`, with no
DOM, no wall clock and no ambient randomness (ESLint enforces this, and a test checks the rule
stays active). `make test` runs 29 Vitest tests:

- **RNG:** determinism, seed separation and distribution.
- **Determinism:** same seed gives the same systems and the same sim outcome for all three bots.
- **Saves:** replaying the action log gives byte-identical state, for 3 seeds × 3 bots, and saves
  from another content version are rejected.
- **Invariants:** no negative resources without the run ending correctly, checked over 180 bot
  runs after every action.
- **Actions:** every legal action is accepted and illegal ones throw.
- **Content:** content compiles and validates, and every event has a free option.
- **Events:** every event is eligible somewhere, and every outcome of every option is reachable.
- **Clocks:** `nextUp` ordering, stay-clock cancellation, and recurring-clock reset.

The tests use a synthetic sector (`test/fixtures/sector.ts`) so they pass on a clean clone
without baked data.

### How it's built

- **RNG (`rng.ts`):** xmur3 hash plus sfc32. There is no mutable RNG in state: every roll uses
  `rngFor(runSeed, ...context)`, e.g. `('landing', turn, worldId)`. A save is
  `{format, runSeed, sectorId, contentVersion, actions[]}`, and loading replays the actions.
- **Content:** `content/balance.json` and `content/events/*.yaml` are validated with Ajv against
  `content/schemas/*` and compiled by `scripts/build-content.ts` into a gitignored
  `src/generated/content.json`. That runs automatically before typecheck, test and sim, and
  stamps an FNV-1a content version. Core has no runtime YAML dependency.
- **Systems (`generate/system.ts`):**
  - Generated lazily on first visit and cached in state.
  - Star class comes from Teff, falling back to BP−RP through an approximate dwarf color
    sequence in `balance.json`. Luminosity is R²(T/5772)⁴.
  - Confirmed planets are fixed slots with their real values.
  - KOI candidates resolve per run to a planet, an eclipsing binary or an artifact, with odds
    tilted by the real false-positive flags and `koi_score`. Resolving a candidate in play logs
    a "Real data" line.
  - 0–8 procedural planets, weighted by star class, with orbits spaced by ratio and kept clear
    of real orbits. Around Kepler targets they're flagged non-transiting. Real planets keep
    letter names; generated ones get Roman numerals, so it's always visible which is which.
- **Clocks (`clocks.ts`):** a registry of timed things:
  - Recycler (every 4 turns, +2 life support) and deep sensor sweep (every 3 turns, +1 data).
  - Spectrum analysis (2 turns after each first visit to a star) and survey analysis (2 turns
    after each survey).
  - Stay-yield (cancelled if you leave).
  - Signal decode (strange-signal event: pays data and reveals a supply cache ahead).
  - Delayed reward (abandoned-probe event).
  - `nextUp()` returns the next three completions, including a derived "front reaches this star
    in N turns" entry.
- **The front:** advances 3.5 ly per turn along the corridor's x axis, starting 30 ly behind the
  start star. Each turn spent at a star behind it costs 30 hull.
- **Events:** the 10 Phase 1 events listed in the spec, in YAML, with visible costs and shown odds.

### Sim report (`make sim`: 500 runs per bot per sector, content fb7b110f, 161 s)

| Bot      | Win rate | Median jumps (all / won) | Median turns | Payoff on % of turns | Mean / max gap between payoffs | Events per run |
| -------- | -------- | ------------------------ | ------------ | -------------------- | ------------------------------ | -------------- |
| random   | 0%       | 7 / —                    | 13           | 73%                  | 1.33 / 3                       | 3.1            |
| greedy   | 48%      | 32 / 35                  | 54           | 78%                  | 1.27 / 3                       | 11.5           |
| cautious | 49%      | 30 / 35                  | 67           | 86%                  | 1.16 / 3                       | 13.4           |

- **random:** loses to the front 82% of the time and is stranded 16%.
- **greedy:** loses to mining accidents 17%, flares 10%, stranding 8%, derelict salvage 6% and
  hard landings 5%. It never repairs.
- **cautious:** stranded 29%, life support 15%. It spends turns keeping reserves up and runs dry
  when the front forces it on.

Win rate by sector:

| Bot      | s01 | s02 | s03 | s04 | s05 | s06 | s07 | s08 | s09 | s10 |
| -------- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| greedy   | 78% | 47% | 30% | 45% | 23% | 36% | 28% | 62% | 48% | 79% |
| cautious | 71% | 47% | 37% | 43% | 24% | 51% | 36% | 48% | 57% | 77% |

Sector difficulty tracks shortest-path length: s01 and s10 are 26 jumps, s05 is 45.

Resource curves (mean fuel / life support / hull of runs still going): greedy holds fuel near
21–23 while its hull wears from 100 to about 27 by turn 70. Cautious holds hull near 60 and
fuel near 20 through turn 90. Full curves are in `data/sim/report.md`.

Against the targets:

- Greedy wins 30–60%: **met, 48%.**
- Random rarely wins: **met, 0%.**
- A clock payoff on most turns: **met,** 78–86% of turns, never more than 3 turns apart.
- Median run 35–55 jumps: **met for winning runs (35); the all-runs median is 30–32** because
  losses end early. Pushing it higher would need longer corridors than the pipeline's 25–45
  path band allows, or detour-heavy play.

### Tuned balance values (content/balance.json)

- **Jump fuel:** 1 + 0.03·d². So 6 ly costs 2.1, 8 ly costs 2.9 and 12 ly costs 5.3. Life
  support is 0.5 per jump.
- **Life support:** 0.5 per turn, 1 per landing.
- **Start / max:** fuel 24 / 40, life support 24 / 40, hull 100 / 100, materials 4 / 30.
- **Front:** 3.5 ly per turn, starts 30 ly behind, 30 hull per turn behind it.
- **Mining:** 6 fuel, 5 materials, 5 life support per action. 20% accident chance for 6–16 hull.
- **Fuel pools:** gas giants 6–16, ice giants 5–12, ice worlds 3–8. Procedural radii skew toward
  small worlds (exponent 2.2).
- **Stay:** yield grows +50% per consecutive turn. Hazard is 10% + 10% per turn. A deep-survey
  clock pays after 3 consecutive turns.
- **Events:** 35% chance on arrival, 25% on landing, 20% on stay.

### Deviations and decisions

1. **Corridor length retuned in the pipeline** from 200–300 ly to 280–360 ly (landmark tubes
   200–340 ly), as the spec allows ("tune corridor length"). Shortest paths are now 26–45 jumps
   and still pass the 25–45 validation band. This moved the sim's winning-run median from 32 to
   35 jumps.
2. **Quadratic jump fuel** (`fuelPerLySquared`). With a linear cost the best play is always the
   longest jump, so runs have fewer stops and fewer systems seen. Now 6–8 ly hops are the
   efficient choice and 12 ly jumps are an emergency move. This serves both design goals.
3. **Added a `repair` action** (materials → hull, takes a turn). Materials had no use otherwise.
4. **Life support drains 0.5 per turn**, in addition to per jump and per landing, so time
   spent (stay, mining, repair) has a cost.
5. **Extra clocks:** recycler, sensor sweep, survey analysis and spectrum analysis, beyond the
   spec's four (front, stay-yield, signal decode, delayed reward). They are what gets "a clock
   payoff on most turns". Spectrum analysis ties the payoff rhythm to exploring new stars. The
   front is a derived ticker entry rather than a stored clock.
6. **Mining is illegal when it would yield nothing** because the holds are full. Found in
   tuning: a bot could loop on it forever.
7. **Loss causes** are `hull` (with the damage source as detail: front, mining, flare, or an
   event id), `lifeSupport`, and `stranded`. Stranded means no affordable jump, no reachable fuel
   here, and no fuel clock pending.
8. **Bots navigate by true hops-to-goal** (BFS over the whole sector's jump graph), which is more
   than a player's sensors reveal. A straight-line heuristic trapped them in local dead ends. So
   "greedy" means the cheapest-fuel jump that stays on a shortest path, and tops up fuel below
   60%. "Cautious" surveys everything, keeps reserves above 60%, repairs below 60 hull, avoids
   hazardous stars, and runs when the front is within 20 ly.
9. **The reducer clones state with a JSON round-trip,** which also guarantees state stays plain
   JSON. A 15,000-run sim takes about 160 s.
10. **Code style:** TypeScript imports use `.ts` extensions and `erasableSyntaxOnly`, so Node 22
    runs the sim and content scripts directly with no extra tooling. The base lib is raised to
    ES2023.

## Milestone 3 — Playable prototype (done 2026-09-29)

A full run is playable start to finish in the browser. `make dev` serves it locally, and it's on
the tailnet via `transit-dev.service` (see CLAUDE.md), with Glance tiles for the game and the Lab.

### What's in it

- **Sector map (PixiJS 8):**
  - An orthographic 3D view of the real star positions. Drag to rotate, wheel to zoom,
    shift-drag or right-drag to pan. It redraws only on change.
  - Stars are glow sprites tinted by spectral class, brighter for lower Gaia G. Stars beyond
    sensor range stay dim grey, so the horizon grows as you move.
  - Thin drop lines run to a z = 0 reference grid.
  - Overlays: jump-range and sensor-range rings, ringed reachable stars, the route travelled,
    the front as a translucent plane with a fading wake, a goal diamond with its label, and
    square markers for decoded caches.
  - A Sol marker at the view edge in its true direction, labeled like "Sol, 1,688 ly".
- **Star card on hover:** name and catalog ID, class and Teff, distance from here, distance from
  Sol with "the light Earth sees left it N years ago", a Real data badge for hosts, landmarks and
  confirmed planets, and a note for Kepler targets.
- **Jump preview:** fuel and life-support cost, progress toward the goal, known hazards (star
  class is known from the catalog before arrival), and a warning if the front will be on the
  target. Then confirm. A sortable jump list mirrors the map (▲ marks jumps on a shortest path).
- **System panel:** star class, Teff, luminosity and hazard, plus KOI resolutions. Each world
  shows type, orbit, Teq and radius, a "Kepler confirmed/candidate" badge, "non-transiting" on
  generated worlds around Kepler targets, resources after survey, and landing risk. Actions:
  survey, land, mine or skim (showing the yield), stay (showing the next hazard %), repair.
- **Event dialog:** text, options with costs and shown odds; unaffordable options are disabled.
- **HUD:** fuel, life support, hull, materials, data, turn, distance to the front, distance to
  the goal and minimum jumps.
- **Next-up ticker:** the next three clock payoffs, including the front's ETA.
- **Log:** color-coded, with a `real` badge on lines that come from real data.
- **Run end screen:** cause, stats (turns, jumps, ly, systems, data, KOIs resolved and
  confirmed, firsts), a "what you almost did" line (distance and jumps to the goal, plus the
  nearest unfinished clock), New run, and Export run.
- **Saves:** every action autosaves to IndexedDB. Reload continues the run. The in-game menu
  exports and abandons; the title screen imports a save.
- **Telemetry:** `track(event, props)` appends to IndexedDB, with `setTelemetrySink()` as the
  PostHog seam. It records run_start/resume/end/abandon, turn_start, turn_end (with
  durationMs), each action, and quit_point on pagehide or tab hide. "export telemetry" on the
  title screen downloads it; `scripts/telemetry-report.ts` summarizes an export.
- **Lab (`#lab`):** the sector table and the latest sim summary.

### Tests

- `npm run typecheck` and `npm run build` pass (JS bundle 482 kB, 150 kB gzipped; `dist` is
  21 MB because it includes the sector data).
- `make e2e` (Playwright smoke) passes: start s01 with seed `smoke`, pick a jump, confirm,
  answer any arrival event, see the turn go 0 → 1, reload, and see turn 1 and the same fuel
  restored.
- `make playthrough` plays three full runs through the real UI with a scripted policy (survey,
  refuel below 12, jump along ▲) and exports telemetry.

### Median turn time (3 runs, from the telemetry export)

| Run          | Outcome                        | Turns | Median turn time |
| ------------ | ------------------------------ | ----- | ---------------- |
| s01 / play-1 | lost: stranded                 | 36    | 0.49 s           |
| s08 / play-2 | **won**: arrived at Kepler-452 | 58    | 0.33 s           |
| s10 / play-3 | lost: stranded                 | 24    | 0.32 s           |
| all          |                                | 118   | **0.37 s**       |

**This is not human data.** I can't play by hand, so these three runs were played by a scripted
Playwright policy driving the real UI. That proves the full loop works end to end, but the turn
times measure automation speed, not thinking time. To get the real number, play 3 runs, click
"export telemetry", and run `node packages/web/scripts/telemetry-report.ts <file>`.

### Bugs found and fixed while testing

1. **Telemetry got slower over time.** Each event re-read and rewrote the whole log (O(n²)), and
   a multi-run session slowed to a crawl. Now each flushed batch is its own record in a
   dedicated `transit-telemetry` IndexedDB store.
2. **Navigating away right after "New run"** raced the autosave delete and resumed the finished
   run. The app now waits for the title screen. On reload, a finished run shows its end screen
   until "New run".

### Deviations and decisions

- **Data serving.** Vite serves the repo's `data/` as `publicDir`, so sectors are at
  `/sectors/*.json` and the sim report at `/sim/*`. `vite build` copies them into `dist`. For
  Vercel that's 20 MB of static JSON; the spec's later R2 plan fits here.
- **Game state lives in a small external store** (`game/session.ts`, `useSyncExternalStore`).
  Zustand holds only UI state (hover, selection), as the spec says.
- **Long Gaia IDs** are shortened to `Gaia …1234567` in lists, labels and logs. The full ID is
  on the hover card and system title tooltip.
- **Added `make playthrough` and a `#lab` page** so the data and balance are viewable on the
  tailnet and in Glance.
