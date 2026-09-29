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

| Sector | Stars | Hosts | KOIs (stars) | Landmarks              | Distance from Sun (center) | Length × radius | G cut | Shortest path (≤12 ly jumps) | File     |
| ------ | ----- | ----- | ------------ | ---------------------- | -------------------------- | --------------- | ----- | ---------------------------- | -------- |
| s01    | 1500  | 13    | 23 (19)      | Kepler-22 (goal)       | 761 ly                     | 231 × 40 ly     | 18.59 | 28 jumps                     | 2,182 KB |
| s02    | 1500  | 17    | 34 (20)      | —                      | 910 ly                     | 229 × 38 ly     | 19.2  | 27 jumps                     | 2,380 KB |
| s03    | 1500  | 16    | 34 (19)      | —                      | 1,019 ly                   | 292 × 39 ly     | 18.27 | 40 jumps                     | 1,882 KB |
| s04    | 1347  | 10    | 15 (11)      | Kepler-10              | 513 ly                     | 226 × 32 ly     | —     | 25 jumps                     | 2,424 KB |
| s05    | 1500  | 14    | 31 (19)      | —                      | 965 ly                     | 260 × 35 ly     | 19.27 | 32 jumps                     | 2,311 KB |
| s06    | 1500  | 14    | 29 (18)      | —                      | 1,178 ly                   | 285 × 40 ly     | 18.62 | 35 jumps                     | 1,875 KB |
| s07    | 1500  | 8     | 12 (10)      | Kepler-22              | 717 ly                     | 274 × 32 ly     | 19.43 | 33 jumps                     | 2,488 KB |
| s08    | 1500  | 7     | 22 (12)      | Kepler-186 (goal)      | 712 ly                     | 257 × 37 ly     | 18.17 | 32 jumps                     | 2,223 KB |
| s09    | 1381  | 7     | 18 (11)      | Boyajian's Star (goal) | 1,388 ly                   | 249 × 39 ly     | —     | 32 jumps                     | 1,793 KB |
| s10    | 665   | 6     | 9 (8)        | Kepler-452 (goal)      | 1,753 ly                   | 204 × 34 ly     | —     | 28 jumps                     | 656 KB   |

- **Columns:**
  - "KOIs" counts non-false-positive KOIs (CONFIRMED and CANDIDATE) and equals `planets.length`.
    The number in parentheses is the stars carrying them.
  - "G cut" is the Gaia G magnitude limit applied to ordinary stars when a tube held more than
    1,500 stars. Hosts, KOI stars and landmarks are always kept.
- **Size:** all 10 bundles total 21.7 MB. The 30 ly neighbor lists are the bulk, averaging 57–130
  neighbors per star.
- **Starts:** each start is the star nearest the tube's start end.
- **Goals:** each goal is a landmark, host or KOI star within 25 ly of the far end if there is
  one; otherwise the nearest star.

### Landmarks

| Landmark                      | Qualifies?                 | Why                                                                                                                                      |
| ----------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Kepler-452                    | yes, s10 goal              | 1,807 ly (554 pc). Qualifies only because the band was widened to 600 pc (below).                                                        |
| Kepler-186                    | yes, s08 goal              | 579 ly                                                                                                                                   |
| Kepler-22                     | yes, s01 goal, also in s07 | 644 ly                                                                                                                                   |
| Boyajian's Star (KIC 8462852) | yes, s09 goal              | 1,447 ly                                                                                                                                 |
| Kepler-10                     | yes, in s04 (mid-corridor) | 607 ly. No corridor ending at it passed the overlap and path checks; s04's goal is Kepler-78, another host.                              |
| Kepler-16                     | no                         | Too close: its parallax is above the 12 mas query limit (under ~83 pc). The Kepler field's cone is too narrow there for a 25–40 ly tube. |
| Kepler-444                    | no                         | Too close, for the same reason (about 36 pc).                                                                                            |
| Kepler-90                     | no                         | Too far: beyond the 1.6 mas query floor (about 625 pc).                                                                                  |

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

- **Sampling:** 20,000 random tubes (length 200–300 ly, radius 25–40 ly), each centered on a
  random in-band star, plus 400 targeted tubes per landmark that end at that landmark. The search
  is seeded, so it's reproducible.
- **Acceptance:** 5,862 tubes passed geometry and star count. Rejections: axis leaves the Kepler
  footprint (14,336), outside the distance band (1,420), tube leaves the query cone (94), too few
  stars (8).
- **Selection:** landmarks first (preferring a tube that ends at the landmark), then by score
  (3 × hosts + 1 × KOI stars + 25 × landmarks). No two sectors may share more than 20% of the
  smaller one's stars.
- **Path lengths:** the spec's corridor lengths already give shortest paths of 25–40 jumps, so no
  length tuning was needed.

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
