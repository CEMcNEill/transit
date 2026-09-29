# Transit — top-level tasks. See README.md.
.PHONY: setup data test test-js test-py lint sim dev build e2e playthrough clean-data

UV := uv --project pipeline

setup:
	$(UV) sync --frozen
	npm ci

# Bake sector bundles from real data (downloads are cached in raw/).
data:
	$(UV) run transit-pipeline all

test: lint test-js test-py

lint:
	npm run lint
	npm run format:check
	$(UV) run ruff check pipeline
	$(UV) run ruff format --check pipeline

test-js:
	npm run typecheck
	npm test

test-py:
	cd pipeline && uv run pytest -q

# Balance sim over every baked sector (needs `make data`). Pass args with SIM_ARGS="--runs 50".
sim:
	npm run content -w @transit/core
	npm run sim -w @transit/core -- $(SIM_ARGS)

dev:
	npm run dev

build:
	npm run build

# Playwright smoke test (needs `make data`). Installs Chromium on first run (~170 MB).
e2e:
	cd packages/web && npx playwright install chromium
	npm run e2e -w @transit/web

# Plays 3 full runs through the UI and exports telemetry to packages/web/test-results/.
playthrough:
	cd packages/web && npx playwright install chromium
	npm run playthrough -w @transit/web
	npm run telemetry-report -w @transit/web -- test-results/telemetry.json

# Removes baked output only. Never touches raw/.
clean-data:
	rm -rf data/sectors
