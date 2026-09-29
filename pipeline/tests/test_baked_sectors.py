"""Validates data/sectors/ when it has been baked (`make data`); skipped on a clean clone."""

import pytest

from transit_pipeline import config
from transit_pipeline.validate import validate_dir

pytestmark = pytest.mark.skipif(
    not (config.SECTORS_DIR / "index.json").exists(), reason="no baked sectors; run `make data`"
)


def test_baked_sectors_are_valid() -> None:
    reports = validate_dir()
    assert {r.sector_id: r.errors for r in reports if not r.ok} == {}
