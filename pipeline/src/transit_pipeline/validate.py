"""Sector bundle validation: star-count band, path check, neighbor symmetry, references."""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from . import config
from .sectors import adjacency, bfs_hops


@dataclass
class Report:
    sector_id: str
    errors: list[str] = field(default_factory=list)
    shortest_path_jumps: int | None = None

    @property
    def ok(self) -> bool:
        return not self.errors


def validate_bundle(
    b: dict,
    starting_range_ly: float,
    max_range_ly: float,
    star_band: tuple[int, int] = config.CORRIDOR.star_count,
    jump_band: tuple[int, int] = config.CORRIDOR.path_jumps,
) -> Report:
    rep = Report(b.get("id", "?"))
    err = rep.errors.append
    stars = b["stars"]
    n = len(stars)

    if not star_band[0] <= n <= star_band[1]:
        err(f"star count {n} outside {star_band}")
    if b["meta"]["starCount"] != n:
        err(f"meta.starCount {b['meta']['starCount']} != {n}")

    pos = np.array([s["pos"] for s in stars], dtype=float)
    if pos.shape != (n, 3) or not np.isfinite(pos).all():
        err("non-finite or malformed star positions")
        return rep

    for key in ("start", "goal"):
        idx = b[key]["starIndex"]
        if not (isinstance(idx, int) and 0 <= idx < n):
            err(f"{key}.starIndex {idx} out of range")
    for i, p in enumerate(b["planets"]):
        if not (isinstance(p["starIndex"], int) and 0 <= p["starIndex"] < n):
            err(f"planet {i} references missing star {p['starIndex']}")
        elif not stars[p["starIndex"]]["flags"]["koi"]:
            err(f"planet {p['koi']} is on a star not flagged koi")

    sun = np.array(b["sunDirection"], dtype=float)
    if not math.isclose(float(np.linalg.norm(sun)), 1.0, abs_tol=1e-4):
        err("sunDirection is not a unit vector")

    nb = b["neighbors"]
    if len(nb) != n:
        err(f"neighbors has {len(nb)} lists for {n} stars")
        return rep
    edges: dict[tuple[int, int], float] = {}
    for i, lst in enumerate(nb):
        dists = [d for _, d in lst]
        if dists != sorted(dists):
            err(f"star {i} neighbors not sorted by distance")
        for j, d in lst:
            if not 0 <= j < n or j == i:
                err(f"star {i} has invalid neighbor {j}")
                continue
            if d > max_range_ly + 1e-9:
                err(f"star {i} neighbor {j} at {d} ly exceeds {max_range_ly}")
            true = float(np.linalg.norm(pos[i] - pos[j]))
            if abs(true - d) > 0.02:
                err(f"star {i}->{j} distance {d} != {true:.3f}")
            edges[(i, j)] = d
    for (i, j), d in edges.items():
        if edges.get((j, i)) != d:
            err(f"neighbor edge {i}->{j} is not symmetric")
            break
    if len(rep.errors) > 50:
        rep.errors[50:] = ["(more errors truncated)"]

    # Path check straight from positions, independent of the baked neighbor lists.
    hops = bfs_hops(
        adjacency(pos, starting_range_ly), b["start"]["starIndex"], b["goal"]["starIndex"]
    )
    rep.shortest_path_jumps = hops
    if hops is None:
        err(f"no path from start to goal with jumps <= {starting_range_ly} ly")
    elif not jump_band[0] <= hops <= jump_band[1]:
        err(f"shortest path {hops} jumps outside {jump_band}")
    elif b["meta"].get("shortestPathJumps") != hops:
        err(f"meta.shortestPathJumps {b['meta'].get('shortestPathJumps')} != {hops}")
    return rep


def validate_dir(sectors_dir: Path = config.SECTORS_DIR) -> list[Report]:
    ranges = config.jump_ranges()
    index = json.loads((sectors_dir / "index.json").read_text())
    reports = []
    for entry in index["sectors"]:
        bundle = json.loads((sectors_dir / entry["file"]).read_text())
        reports.append(validate_bundle(bundle, ranges.starting_ly, ranges.max_ly))
    if len(reports) != config.CORRIDOR.sectors_to_bake:
        reports.append(
            Report("index", [f"{len(reports)} sectors, expected {config.CORRIDOR.sectors_to_bake}"])
        )
    return reports
