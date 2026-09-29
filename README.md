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
make test    # lint, format check, typecheck, Vitest, pytest (no network)
make dev     # Vite dev server at http://localhost:5173
```

Other targets:

| Target            | What it does                                                                  |
| ----------------- | ----------------------------------------------------------------------------- |
| `make data`       | Download (cached in `raw/`) and bake sector bundles into `data/sectors/` (M1) |
| `make sim`        | Headless bot runs for balance tuning (M2)                                     |
| `make e2e`        | Playwright smoke test (M3)                                                    |
| `make build`      | Static production build of the web app                                        |
| `make clean-data` | Delete baked sectors. Never deletes `raw/`.                                   |

Network tests are skipped by default. To run them:
`RUN_NETWORK_TESTS=1 uv run --project pipeline pytest`.

## Layout

```
pipeline/          Python sector pipeline (uv project)
packages/core/     Deterministic game logic, pure TypeScript
packages/web/      React + Vite UI
content/           balance.json, events/*.yaml, JSON Schemas
raw/               Download cache (gitignored, permanent)
data/sectors/      Baked sector bundles (gitignored)
```

See `CLAUDE.md` for working rules and `NOTES.md` for progress and measurements.
