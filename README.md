# Transit

A turn-based exploration roguelike set among the real stars of the Kepler field. Star positions
and confirmed planets come from Gaia DR3 and the NASA Exoplanet Archive. Everything telescopes
can't see is generated procedurally from the run seed.

## Requirements

- Node.js 22.12 or later (see `.nvmrc`) with npm
- [uv](https://docs.astral.sh/uv/). It installs Python 3.12 for the pipeline automatically.
- GNU make

## Setup and run

```sh
make setup   # uv sync --frozen + npm ci
make data    # fetch real data (cached in raw/, ~200 MB first time) and bake 10 sectors
make dev     # Vite dev server at http://localhost:5173, then pick a sector and begin
make test    # lint, format check, typecheck, Vitest, pytest (no network)
```

Other targets:

| Target             | What it does                                                             |
| ------------------ | ------------------------------------------------------------------------ |
| `make sim`         | 500 headless bot runs per bot per sector; report in `data/sim/report.md` |
| `make e2e`         | Playwright smoke test: seeded run, one jump, reload, save restored       |
| `make playthrough` | Three full runs through the UI, then a telemetry turn-time report        |
| `make build`       | Static production build of the web app (`packages/web/dist`)             |
| `make clean-data`  | Delete baked sectors. Never deletes `raw/`.                              |

Network tests are skipped by default. To run them:
`RUN_NETWORK_TESTS=1 uv run --project pipeline pytest`.

## Playing

- **The goal:** cross the corridor from the start star to the goal (often a famous Kepler
  system) before fuel, life support or hull runs out, and stay ahead of the front advancing
  behind you.
- **Map:** drag to rotate, scroll to zoom, shift-drag to pan. Ringed stars are in jump range.
  Click one, or pick from the jump list, to see costs and known hazards, then confirm.
- **Real data:** star positions are real Gaia DR3 stars. Kepler hosts and confirmed planets
  carry a "Real data" badge. Kepler candidates resolve into planets, eclipsing binaries or
  artifacts when you arrive.
- **Autosave:** every action is saved automatically, and reloading continues the run. Export or
  import a save from the menu or the title screen.
- **Telemetry:** stays local. Use "export telemetry" on the title screen, then run
  `node packages/web/scripts/telemetry-report.ts <file>` for turn-time stats.
- **Lab:** `#lab` shows the baked sectors and the latest balance sim.

## Layout

```
pipeline/          Python sector pipeline (uv project)
packages/core/     Deterministic game logic, pure TypeScript
packages/web/      React + Vite UI (PixiJS map, Zustand UI state)
content/           balance.json, events/*.yaml, JSON Schemas
raw/               Download cache (gitignored, permanent)
data/sectors/      Baked sector bundles (gitignored)
```

See `CLAUDE.md` for working rules and `NOTES.md` for progress and measurements.
