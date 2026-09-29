"""Bundle validator on synthetic bundles (no network, no baked data needed)."""

import copy

import numpy as np
import pytest

from transit_pipeline import sectors
from transit_pipeline.validate import validate_bundle

STARTING, MAX = 12.0, 30.0
BAND = (10, 100)


def _bundle(n: int = 31, spacing: float = 10.0) -> dict:
    """A straight chain of stars; shortest path start->goal is n-1 jumps."""
    pos = np.array([[i * spacing, 0.0, 0.0] for i in range(n)])
    stars = [
        {
            "id": f"S{i}",
            "pos": p.tolist(),
            "flags": {"keplerTarget": False, "host": False, "koi": i == 5, "landmark": False},
        }
        for i, p in enumerate(pos)
    ]
    neighbors = [[] for _ in range(n)]
    for i in range(n):
        for j in range(n):
            d = float(np.linalg.norm(pos[i] - pos[j]))
            if i != j and d <= MAX:
                neighbors[i].append([j, round(d, 2)])
        neighbors[i].sort(key=lambda e: (e[1], e[0]))
    return {
        "id": "t01",
        "meta": {"starCount": n, "shortestPathJumps": n - 1},
        "start": {"starIndex": 0},
        "goal": {"starIndex": n - 1},
        "sunDirection": [0.0, 0.6, 0.8],
        "stars": stars,
        "planets": [{"starIndex": 5, "koi": "K1.01"}],
        "neighbors": neighbors,
    }


def _check(b: dict):
    return validate_bundle(b, STARTING, MAX, star_band=BAND, jump_band=(25, 45))


def test_valid_bundle_passes() -> None:
    rep = _check(_bundle())
    assert rep.errors == []
    assert rep.shortest_path_jumps == 30


def test_star_count_band() -> None:
    assert any(
        "star count" in e
        for e in validate_bundle(_bundle(), STARTING, MAX, star_band=(300, 1500)).errors
    )


def test_nan_position_caught() -> None:
    b = _bundle()
    b["stars"][3]["pos"] = [float("nan"), 0, 0]
    assert any("non-finite" in e for e in _check(b).errors)


def test_bad_planet_reference_caught() -> None:
    b = _bundle()
    b["planets"].append({"starIndex": 999, "koi": "K2.01"})
    assert any("missing star" in e for e in _check(b).errors)


def test_asymmetric_neighbors_caught() -> None:
    b = _bundle()
    b["neighbors"][0] = [e for e in b["neighbors"][0] if e[0] != 1]
    assert any("not symmetric" in e for e in _check(b).errors)


def test_neighbor_out_of_range_caught() -> None:
    b = _bundle()
    b["neighbors"][0].append([10, 100.0])
    errs = _check(b).errors
    assert any("exceeds" in e for e in errs)


def test_unreachable_goal_caught() -> None:
    b = _bundle(spacing=13.0)  # every gap exceeds the 12 ly starting range
    b = copy.deepcopy(b)
    assert any("no path" in e for e in _check(b).errors)


@pytest.mark.parametrize(("n", "ok"), [(20, False), (31, True), (47, False)])
def test_path_length_band(n: int, ok: bool) -> None:
    b = _bundle(n=n)
    assert _check(b).ok is ok


def test_bfs_hops_and_segment_distance() -> None:
    adj = sectors.adjacency(np.array([[0, 0, 0], [10, 0, 0], [20, 0, 0], [50, 0, 0]], float), 12)
    assert sectors.bfs_hops(adj, 0, 2) == 2
    assert sectors.bfs_hops(adj, 0, 3) is None
    d = sectors.segment_distance(
        np.array([[5, 3, 0], [-4, 3, 0], [14, 0, 0]], float), np.zeros(3), np.array([10.0, 0, 0])
    )
    np.testing.assert_allclose(d, [3, 5, 4])
