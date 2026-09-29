"""Corridor search, scoring, and sector bundle baking.

A corridor is a tube (axis segment A->B, radius r) inside the Kepler field's volume. Candidates
are sampled with a seeded RNG, scored by the real hosts/KOIs/landmarks they contain, and the best
non-overlapping ones whose start->goal path fits the jump-count band are baked to JSON.
"""

from __future__ import annotations

import json
import math
from collections import deque
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from scipy.spatial import cKDTree

from . import config
from .stars import Footprint, angular_sep_deg, sector_frame, to_radec


def _log(msg: str) -> None:
    print(f"[sectors] {msg}", flush=True)


# ---------------------------------------------------------------- geometry helpers


def segment_distance(p: np.ndarray, a: np.ndarray, b: np.ndarray) -> np.ndarray:
    ab = b - a
    t = np.clip(((p - a) @ ab) / (ab @ ab), 0.0, 1.0)
    return np.linalg.norm(p - (a + t[:, None] * ab), axis=1)


def adjacency(pos: np.ndarray, max_ly: float) -> list[list[int]]:
    adj: list[list[int]] = [[] for _ in range(len(pos))]
    for i, j in cKDTree(pos).query_pairs(max_ly):
        adj[i].append(j)
        adj[j].append(i)
    return adj


def bfs_hops(adj: list[list[int]], start: int, goal: int) -> int | None:
    """Fewest jumps from start to goal, or None if unreachable."""
    seen = {start: 0}
    queue = deque([start])
    while queue:
        u = queue.popleft()
        if u == goal:
            return seen[u]
        for v in adj[u]:
            if v not in seen:
                seen[v] = seen[u] + 1
                queue.append(v)
    return None


# ---------------------------------------------------------------- search


@dataclass(eq=False)  # compare by identity; fields hold numpy arrays
class Candidate:
    a: np.ndarray
    b: np.ndarray
    radius: float
    members: np.ndarray  # indices into the star table, after any magnitude cut
    gmag_cut: float | None
    hosts: int
    kois: int
    landmarks: int
    score: float
    start: int = -1  # star-table index
    goal: int = -1
    jumps: int | None = None
    notes: dict = field(default_factory=dict)

    @property
    def length(self) -> float:
        return float(np.linalg.norm(self.b - self.a))


class Searcher:
    def __init__(
        self, table: pd.DataFrame, fp: Footprint, cfg: config.CorridorConfig = config.CORRIDOR
    ):
        self.t = table
        self.fp = fp
        self.cfg = cfg
        self.pos = table[["x", "y", "z"]].to_numpy()
        self.tree = cKDTree(self.pos)
        self.gmag = table.phot_g_mean_mag.to_numpy()
        self.host = table.host.to_numpy()
        self.koi = table.koi.to_numpy()
        self.landmark = table.landmark.to_numpy()
        self.protected = self.host | self.koi | self.landmark
        lo, hi = (d * config.PC_TO_LY for d in config.PREFERRED_DISTANCE_PC)
        self.band_ly = (lo, hi)
        dist = np.linalg.norm(self.pos, axis=1)
        in_band = (dist >= lo) & (dist <= hi) & fp.contains(self.pos / dist[:, None])
        self.seed_stars = np.flatnonzero(in_band)
        self.rejections: dict[str, int] = {}

    def _reject(self, why: str) -> None:
        self.rejections[why] = self.rejections.get(why, 0) + 1

    def _axis_ok(self, a: np.ndarray, b: np.ndarray, r: float) -> bool:
        ts = np.linspace(0.0, 1.0, self.cfg.axis_samples)
        pts = a + ts[:, None] * (b - a)
        d = np.linalg.norm(pts, axis=1)
        if d.min() < self.band_ly[0] or d.max() > self.band_ly[1]:
            self._reject("outside distance band")
            return False
        units = pts / d[:, None]
        if not self.fp.contains(units).all():
            self._reject("axis leaves Kepler footprint")
            return False
        reach = angular_sep_deg(units, self.fp.center) + np.degrees(
            np.arcsin(np.minimum(1.0, r / d))
        )
        if reach.max() > config.GAIA_QUERY.cone_radius_deg:
            self._reject("tube leaves Gaia query cone")
            return False
        return True

    def evaluate(self, a: np.ndarray, b: np.ndarray, r: float) -> Candidate | None:
        if not self._axis_ok(a, b, r):
            return None
        mid = (a + b) / 2
        reach = math.hypot(np.linalg.norm(b - a) / 2, r)
        near = np.asarray(self.tree.query_ball_point(mid, reach), dtype=int)
        members = near[segment_distance(self.pos[near], a, b) <= r] if len(near) else near
        lo, hi = self.cfg.star_count
        if len(members) < lo:
            self._reject("too few stars")
            return None
        gmag_cut = None
        if len(members) > hi:
            # Magnitude-limit the ordinary stars (never hosts, KOIs, or landmarks) to fit the band.
            prot = members[self.protected[members]]
            rest = members[~self.protected[members]]
            keep = hi - len(prot)
            if keep < lo // 2:
                self._reject("too many protected stars")
                return None
            order = rest[np.argsort(self.gmag[rest], kind="stable")]
            gmag_cut = float(self.gmag[order[keep - 1]])
            members = np.sort(np.concatenate([prot, order[:keep]]))
        hosts = int(self.host[members].sum())
        kois = int(self.koi[members].sum())
        lms = int(self.landmark[members].sum())
        c = self.cfg
        score = hosts * c.w_host + kois * c.w_koi + lms * c.w_landmark
        return Candidate(a, b, r, members, gmag_cut, hosts, kois, lms, score)

    def _random_axis(self, rng: np.random.Generator) -> tuple[np.ndarray, float, float]:
        d = rng.normal(size=3)
        d /= np.linalg.norm(d)
        return d, rng.uniform(*self.cfg.length_ly), rng.uniform(*self.cfg.radius_ly)

    def sample(self) -> list[Candidate]:
        rng = np.random.default_rng(self.cfg.search_seed)
        out = []
        for _ in range(self.cfg.candidates):
            mid = self.pos[rng.choice(self.seed_stars)]
            d, length, r = self._random_axis(rng)
            cand = self.evaluate(mid - d * length / 2, mid + d * length / 2, r)
            if cand:
                out.append(cand)
        # Targeted candidates that end at each landmark, so a qualifying landmark can be a goal.
        for lm in np.flatnonzero(self.landmark):
            radial = self.pos[lm] / np.linalg.norm(self.pos[lm])
            for _ in range(self.cfg.landmark_candidates):
                # Roughly along the line of sight, either way: near the Sun the field's cone is
                # narrow, and randomly oriented tubes almost never fit inside it.
                d = (
                    radial * rng.choice([-1.0, 1.0])
                    + rng.normal(size=3) * self.cfg.landmark_axis_tilt
                )
                d /= np.linalg.norm(d)
                r = rng.uniform(*self.cfg.radius_ly)
                length = rng.uniform(*self.cfg.landmark_length_ly)
                b = self.pos[lm] + d * rng.uniform(*self.cfg.landmark_goal_offset_ly)
                cand = self.evaluate(b - d * length, b, r)
                if cand and lm in cand.members:
                    out.append(cand)
        return out

    def assign_path(self, cand: Candidate, jump_ly: float) -> None:
        m = cand.members
        p = self.pos[m]
        start = int(np.argmin(np.linalg.norm(p - cand.a, axis=1)))
        d_goal = np.linalg.norm(p - cand.b, axis=1)
        near_goal = np.flatnonzero(d_goal <= self.cfg.goal_search_ly)
        goal = int(np.argmin(d_goal))
        if len(near_goal):
            # Prefer a landmark, then a host, then a KOI star near the far end.
            rank = (
                self.landmark[m[near_goal]] * 4
                + self.host[m[near_goal]] * 2
                + self.koi[m[near_goal]]
            ).astype(float) - d_goal[near_goal] / 1000
            best = near_goal[int(np.argmax(rank))]
            if rank.max() >= 1:
                goal = int(best)
        cand.start, cand.goal = int(m[start]), int(m[goal])
        cand.jumps = bfs_hops(adjacency(p, jump_ly), start, goal)

    def select(self, cands: list[Candidate], jump_ly: float) -> list[Candidate]:
        """Landmarks first (best valid corridor for each qualifying landmark), then by score."""
        lo, hi = self.cfg.path_jumps
        chosen: list[Candidate] = []
        chosen_sets: list[set[int]] = []
        stats = {"evaluated": 0, "unreachable": 0, "too_short": 0, "too_long": 0}
        ranked = sorted(cands, key=lambda c: -c.score)

        def try_accept(cand: Candidate) -> bool:
            s = set(cand.members.tolist())
            if any(len(s & o) > self.cfg.max_overlap * min(len(s), len(o)) for o in chosen_sets):
                return False
            if cand.jumps is None and cand.start < 0:
                self.assign_path(cand, jump_ly)
                stats["evaluated"] += 1
                if cand.jumps is None:
                    stats["unreachable"] += 1
                elif cand.jumps < lo:
                    stats["too_short"] += 1
                elif cand.jumps > hi:
                    stats["too_long"] += 1
            if cand.jumps is None or not lo <= cand.jumps <= hi:
                return False
            chosen.append(cand)
            chosen_sets.append(s)
            return True

        for lm in np.flatnonzero(self.landmark):
            if any(lm in s for s in chosen_sets):
                continue
            # Prefer corridors that end at the landmark, so reaching it is the goal.
            at_goal = self.cfg.goal_search_ly
            options = sorted(
                (c for c in ranked if lm in c.members),
                key=lambda c: (np.linalg.norm(self.pos[lm] - c.b) > at_goal, -c.score),
            )
            for cand in options:
                if len(chosen) == self.cfg.sectors_to_bake:
                    break
                if try_accept(cand):
                    break
        # Then by score, without the landmark bonus for landmarks that already have a sector.
        covered = {int(i) for c in chosen for i in c.members[self.landmark[c.members]]}

        def fresh_score(c: Candidate) -> float:
            dup = sum(int(i) in covered for i in c.members[self.landmark[c.members]])
            return c.score - dup * self.cfg.w_landmark

        for cand in sorted(cands, key=lambda c: -fresh_score(c)):
            if len(chosen) == self.cfg.sectors_to_bake:
                break
            if cand not in chosen:
                try_accept(cand)
        self.path_stats = stats
        return sorted(chosen, key=lambda c: -c.score)


# ---------------------------------------------------------------- baking


def _num(v, nd: int | None = None):
    if v is None or (isinstance(v, float) and not math.isfinite(v)) or pd.isna(v):
        return None
    return round(float(v), nd) if nd is not None else int(v)


def bake(
    cand: Candidate,
    sector_id: str,
    table: pd.DataFrame,
    kois: pd.DataFrame,
    max_range_ly: float,
) -> dict:
    axis = cand.b - cand.a
    frame = sector_frame(axis)
    center = (cand.a + cand.b) / 2
    rows = table.iloc[cand.members]
    local = (rows[["x", "y", "z"]].to_numpy() - center) @ frame.T
    order = np.argsort(local[:, 0], kind="stable")  # stars ordered from start end to goal end
    rows = rows.iloc[order]
    local = local[order]
    table_index = rows.index.to_numpy()
    index_of = {int(ti): i for i, ti in enumerate(table_index)}

    stars = []
    for (_, r), p in zip(rows.iterrows(), local, strict=True):
        kepid = None if pd.isna(r.kepid) else int(r.kepid)
        name = r["name"] if isinstance(r["name"], str) else None
        stars.append(
            {
                "id": f"KIC {kepid}" if kepid is not None else f"Gaia DR3 {int(r.source_id)}",
                "kepid": kepid,
                "gaiaId": str(int(r.source_id)),
                "name": name,
                "pos": [round(float(c), config.POS_DECIMALS) for c in p],
                "teff": _num(r.teff),
                "radius": _num(r.radius, 3),
                "mh": _num(r.mh_gspphot, 2),
                "gmag": _num(r.phot_g_mean_mag, 2),
                "bpRp": _num(r.bp_rp, 3),
                "distLy": _num(r.dist_ly, 1),
                "flags": {
                    "keplerTarget": bool(r.keplerTarget),
                    "host": bool(r.host),
                    "koi": bool(r.koi),
                    "landmark": bool(r.landmark),
                },
            }
        )

    kepid_to_index = {s["kepid"]: i for i, s in enumerate(stars) if s["kepid"] is not None}
    planets = []
    for _, k in (
        kois[kois.kepid.isin(kepid_to_index)].sort_values(["kepid", "koi_period"]).iterrows()
    ):
        planets.append(
            {
                "starIndex": kepid_to_index[int(k.kepid)],
                "koi": k.kepoi_name,
                "name": k.kepler_name if isinstance(k.kepler_name, str) else None,
                "disposition": k.koi_disposition,
                "periodDays": _num(k.koi_period, 4),
                "radiusEarth": _num(k.koi_prad, 2),
                "smaAu": _num(k.koi_sma, 4),
                "teqK": _num(k.koi_teq),
                "koiScore": _num(k.koi_score, 3),
                "fpFlags": {
                    "notTransitLike": _num(k.koi_fpflag_nt),
                    "stellarEclipse": _num(k.koi_fpflag_ss),
                    "centroidOffset": _num(k.koi_fpflag_co),
                    "ephemerisMatch": _num(k.koi_fpflag_ec),
                },
            }
        )
    planets.sort(key=lambda p: (p["starIndex"], p["periodDays"] or 0))

    pos = np.array([s["pos"] for s in stars])
    tree = cKDTree(pos)
    neighbors: list[list[list[float]]] = [[] for _ in stars]
    for i, j in tree.query_pairs(max_range_ly):
        d = round(float(np.linalg.norm(pos[i] - pos[j])), config.DIST_DECIMALS)
        neighbors[i].append([j, d])
        neighbors[j].append([i, d])
    for n in neighbors:
        n.sort(key=lambda e: (e[1], e[0]))

    sun_vec = -center @ frame.T
    ra, dec = to_radec(center)
    landmark_names = sorted(s["name"] or s["id"] for s in stars if s["flags"]["landmark"])
    return {
        "id": sector_id,
        "version": 1,
        "meta": {
            "lengthLy": round(cand.length, 1),
            "radiusLy": round(cand.radius, 1),
            "starCount": len(stars),
            "hostCount": sum(s["flags"]["host"] for s in stars),
            "koiCount": len(planets),
            "koiStarCount": sum(s["flags"]["koi"] for s in stars),
            "landmarks": landmark_names,
            "shortestPathJumps": cand.jumps,
            "gmagCut": None if cand.gmag_cut is None else round(cand.gmag_cut, 2),
            "centerRaDec": [round(ra, 4), round(dec, 4)],
            "score": cand.score,
        },
        "start": {"starIndex": index_of[cand.start]},
        "goal": {"starIndex": index_of[cand.goal]},
        "sunDirection": [round(float(c), 6) for c in sun_vec / np.linalg.norm(sun_vec)],
        "sunDistanceLy": round(float(np.linalg.norm(center)), 1),
        "stars": stars,
        "planets": planets,
        "neighbors": neighbors,
    }


def write_bundles(bundles: list[dict], extra_index: dict) -> list[dict]:
    config.SECTORS_DIR.mkdir(parents=True, exist_ok=True)
    for old in config.SECTORS_DIR.glob("*.json"):
        old.unlink()
    entries = []
    for b in bundles:
        path = config.SECTORS_DIR / f"{b['id']}.json"
        path.write_text(json.dumps(b, separators=(",", ":"), ensure_ascii=False))
        entries.append(
            {
                "id": b["id"],
                "file": path.name,
                "bytes": path.stat().st_size,
                "sunDistanceLy": b["sunDistanceLy"],
                "meta": b["meta"],
            }
        )
    index = {"version": 1, **extra_index, "sectors": entries}
    (config.SECTORS_DIR / "index.json").write_text(
        json.dumps(index, indent=2, ensure_ascii=False) + "\n"
    )
    return entries
