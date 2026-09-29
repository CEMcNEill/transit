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

# Ask the user before any single download larger than this.
MAX_DOWNLOAD_BYTES = 5 * 1024**3

# ---------------------------------------------------------------- sources
EXOPLANET_TAP_SYNC = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync"
GAIA_TAP = "https://gea.esac.esa.int/tap-server/tap"

# gaia-kepler.fun is now a parked domain; the site's source (github.com/megbedell/gaia-kepler.fun,
# index.html) links this Dropbox file as the "one-to-one match" DR3 table. See NOTES.md.
CROSSMATCH_URL = "https://www.dropbox.com/s/pk5cgwjxanczn6b/kepler_dr3_good.fits?dl=1"
CROSSMATCH_FILE = "kepler_dr3_good.fits"

# keplerstellar has one row per kepid per catalog delivery. Keep the first delivery in this list
# that a kepid appears in (newest first).
KEPLERSTELLAR_DELIVERY_PRIORITY: tuple[str, ...] = (
    "q1_q17_dr25_supp_stellar",
    "q1_q17_dr25_stellar",
    "q1_q17_dr24_stellar",
    "q1_q16_stellar",
    "q1_q12_stellar",
)

# ---------------------------------------------------------------- distance quality
# Gaia parallaxes smear faint, distant stars into radial streaks.
MIN_PARALLAX_OVER_ERROR = 10.0
# Spec: prefer 100-500 pc. Extended to 600 pc so Kepler-452 (554 pc) qualifies; the Gaia query's
# parallax floor (1.6 mas = 625 pc) still covers a full tube radius past the band. See NOTES.md.
PREFERRED_DISTANCE_PC = (100.0, 600.0)


@dataclass(frozen=True)
class GaiaQueryConfig:
    # Query cone around the Kepler field center (derived from the Kepler targets' mean position).
    # The field itself reaches ~8 deg from center; the margin lets corridor tubes near the field
    # edge keep all their stars. Corridors must fit entirely inside this cone.
    cone_radius_deg: float = 10.0
    # Parallax window (mas) = preferred distance band plus a margin for tube radius.
    parallax_mas: tuple[float, float] = (1.6, 12.0)
    # The archive is unstable on long jobs, so the cone is fetched as small cached tiles.
    tile_dec_deg: float = 2.0
    tile_ra_deg: float = 3.0
    workers: int = 4
    timeout_s: int = 300
    retries: int = 4


GAIA_QUERY = GaiaQueryConfig()


# ---------------------------------------------------------------- corridors
@dataclass(frozen=True)
class CorridorConfig:
    length_ly: tuple[float, float] = (200.0, 300.0)
    radius_ly: tuple[float, float] = (25.0, 40.0)
    star_count: tuple[int, int] = (300, 1500)
    path_jumps: tuple[int, int] = (25, 45)
    sectors_to_bake: int = 10
    candidates: int = 20000
    search_seed: int = 20260929
    # Corridor axis sample points that must lie inside the Kepler footprint and distance band.
    axis_samples: int = 13
    # Footprint grid on the tangent plane (degrees). A cell is "in field" if it or a neighbor
    # holds a Kepler target.
    footprint_cell_deg: float = 0.25
    # Goal: prefer the best landmark/host/KOI star within this distance of the far end.
    goal_search_ly: float = 25.0
    # Extra candidates per landmark whose goal end sits just past the landmark.
    landmark_candidates: int = 400
    landmark_goal_offset_ly: tuple[float, float] = (-15.0, -3.0)
    # Two baked sectors may share at most this fraction of the smaller one's stars.
    max_overlap: float = 0.2
    # Score = hosts * w_host + kois * w_koi + landmarks * w_landmark.
    w_host: float = 3.0
    w_koi: float = 1.0
    w_landmark: float = 25.0


CORRIDOR = CorridorConfig()

# Landmark display name -> how to find it: "Kepler-NN" matches a keplernames host,
# "KIC n" matches a kepid directly.
LANDMARKS: dict[str, str] = {
    "Kepler-16": "Kepler-16",
    "Kepler-90": "Kepler-90",
    "Kepler-444": "Kepler-444",
    "Boyajian's Star": "KIC 8462852",
    "Kepler-452": "Kepler-452",
    "Kepler-186": "Kepler-186",
    "Kepler-22": "Kepler-22",
    "Kepler-10": "Kepler-10",
}

# Output precision.
POS_DECIMALS = 2
DIST_DECIMALS = 2


@dataclass(frozen=True)
class JumpRanges:
    starting_ly: float
    max_ly: float


@cache
def jump_ranges() -> JumpRanges:
    """Jump ranges shared with the game, read from content/balance.json."""
    jump = json.loads(BALANCE_PATH.read_text())["jump"]
    return JumpRanges(starting_ly=float(jump["startingRangeLy"]), max_ly=float(jump["maxRangeLy"]))
