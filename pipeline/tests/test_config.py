import astropy.units as u
import pytest

from transit_pipeline import config


def test_jump_ranges_come_from_balance_json() -> None:
    ranges = config.jump_ranges()
    assert ranges.starting_ly == 12
    assert ranges.max_ly == 30
    assert ranges.starting_ly < ranges.max_ly


def test_parsec_to_light_year_matches_astropy() -> None:
    assert config.PC_TO_LY == pytest.approx((1 * u.pc).to_value(u.lyr), rel=1e-4)


def test_corridor_bands_are_ordered() -> None:
    c = config.CORRIDOR
    for lo, hi in (c.length_ly, c.radius_ly, c.star_count):
        assert lo < hi


def test_raw_dir_is_gitignored() -> None:
    gitignore = (config.REPO_ROOT / ".gitignore").read_text().splitlines()
    assert "raw/" in gitignore
    assert "data/" in gitignore
