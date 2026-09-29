"""Pipeline configuration. All tunables live here; gameplay numbers come from balance.json."""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import cache
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
RAW_DIR = REPO_ROOT / "raw"
SECTORS_DIR = REPO_ROOT / "data" / "sectors"
BALANCE_PATH = REPO_ROOT / "content" / "balance.json"

PC_TO_LY = 3.2616

# Distance quality: Gaia parallaxes smear faint, distant stars into radial streaks.
MIN_PARALLAX_OVER_ERROR = 10.0
PREFERRED_DISTANCE_PC = (100.0, 500.0)


@dataclass(frozen=True)
class CorridorConfig:
    length_ly: tuple[float, float] = (200.0, 300.0)
    radius_ly: tuple[float, float] = (25.0, 40.0)
    star_count: tuple[int, int] = (300, 1500)
    sectors_to_bake: int = 10


CORRIDOR = CorridorConfig()

LANDMARKS: tuple[str, ...] = (
    "Kepler-16",
    "Kepler-90",
    "Kepler-444",
    "KIC 8462852",  # Boyajian's Star
    "Kepler-452",
    "Kepler-186",
    "Kepler-22",
    "Kepler-10",
)


@dataclass(frozen=True)
class JumpRanges:
    starting_ly: float
    max_ly: float


@cache
def jump_ranges() -> JumpRanges:
    """Jump ranges shared with the game, read from content/balance.json."""
    jump = json.loads(BALANCE_PATH.read_text())["jump"]
    return JumpRanges(starting_ly=float(jump["startingRangeLy"]), max_ly=float(jump["maxRangeLy"]))
