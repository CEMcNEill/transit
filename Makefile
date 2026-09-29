# Transit — top-level tasks. See README.md.
.PHONY: setup data test test-js test-py lint sim dev build e2e clean-data

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

sim:
	@echo "make sim: simulation harness arrives in Milestone 2" >&2; exit 2

dev:
	npm run dev

build:
	npm run build

e2e:
	@echo "make e2e: Playwright smoke test arrives in Milestone 3" >&2; exit 2

# Removes baked output only. Never touches raw/.
clean-data:
	rm -rf data/sectors
