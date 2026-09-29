"""Remote downloads, cached permanently in raw/.

Rules: never re-fetch a cached file unless refresh=True; refuse any single download over
MAX_DOWNLOAD_BYTES (the user must approve those). Every fetch is recorded in raw/manifest.json
(source URL or query, bytes, sha256, fetch time) so NOTES.md can cite exact inputs.
"""

from __future__ import annotations

import hashlib
import json
import math
import threading
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import requests

from . import config

MANIFEST = config.RAW_DIR / "manifest.json"
_manifest_lock = threading.Lock()
USER_AGENT = "transit-pipeline/0.1 (+https://github.com/CEMcNEill/transit)"


class DownloadTooLarge(RuntimeError):
    pass


def _log(msg: str) -> None:
    print(f"[fetch] {msg}", flush=True)


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _record(path: Path, source: str) -> None:
    entry = {
        "source": source,
        "bytes": path.stat().st_size,
        "sha256": _sha256(path),
        "fetched": datetime.now(UTC).isoformat(timespec="seconds"),
    }
    with _manifest_lock:
        manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
        manifest[str(path.relative_to(config.RAW_DIR))] = entry
        MANIFEST.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")


def _cached(dest: Path, refresh: bool) -> bool:
    if dest.exists() and not refresh:
        return True
    dest.parent.mkdir(parents=True, exist_ok=True)
    return False


def _retry[T](fn: Callable[[], T], what: str, retries: int) -> T:
    for attempt in range(1, retries + 1):
        try:
            return fn()
        except (requests.RequestException, RuntimeError) as e:
            if isinstance(e, DownloadTooLarge) or attempt == retries:
                raise
            wait = 5 * 2 ** (attempt - 1)
            _log(f"{what}: {e!s:.120} — retry {attempt}/{retries - 1} in {wait}s")
            time.sleep(wait)
    raise AssertionError("unreachable")


def download(url: str, dest: Path, refresh: bool = False, retries: int = 4) -> Path:
    """Stream url to dest (atomic via .part). Size-checked before and during transfer."""
    if _cached(dest, refresh):
        return dest

    def go() -> None:
        with requests.get(url, stream=True, timeout=120, headers={"User-Agent": USER_AGENT}) as r:
            r.raise_for_status()
            size = int(r.headers.get("content-length") or 0)
            if size > config.MAX_DOWNLOAD_BYTES:
                raise DownloadTooLarge(f"{url} is {size / 1e9:.1f} GB; ask the user first")
            part = dest.with_suffix(dest.suffix + ".part")
            got = 0
            with part.open("wb") as f:
                for chunk in r.iter_content(1 << 20):
                    got += len(chunk)
                    if got > config.MAX_DOWNLOAD_BYTES:
                        raise DownloadTooLarge(f"{url} exceeded the size limit mid-transfer")
                    f.write(chunk)
            part.rename(dest)

    _log(f"downloading {url} -> {dest.relative_to(config.RAW_DIR)}")
    _retry(go, dest.name, retries)
    _record(dest, url)
    return dest


def tap_csv(
    endpoint: str,
    adql: str,
    dest: Path,
    refresh: bool = False,
    timeout_s: int = 600,
    retries: int = 4,
    gaia_style: bool = False,
) -> Path:
    """Run a synchronous TAP query and cache the CSV result."""
    if _cached(dest, refresh):
        return dest
    params = (
        {"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "csv", "QUERY": adql}
        if gaia_style
        else {"query": adql, "format": "csv"}
    )

    def go() -> None:
        r = requests.post(
            endpoint, data=params, timeout=timeout_s, headers={"User-Agent": USER_AGENT}
        )
        r.raise_for_status()
        text = r.text
        # TAP services report query errors as VOTable/XML with HTTP 200.
        if text.lstrip().startswith("<"):
            raise RuntimeError(f"TAP error response: {text[:300]}")
        part = dest.with_suffix(dest.suffix + ".part")
        part.write_text(text)
        part.rename(dest)

    _retry(go, dest.name, retries)
    _record(dest, f"{endpoint} ADQL: {' '.join(adql.split())}")
    return dest


# ---------------------------------------------------------------- Exoplanet Archive

KEPLERSTELLAR_COLS = ("kepid", "ra", "dec", "teff", "radius", "kepmag", "st_delivname")
CUMULATIVE_COLS = (
    "kepid",
    "kepoi_name",
    "kepler_name",
    "koi_disposition",
    "koi_period",
    "koi_prad",
    "koi_sma",
    "koi_teq",
    "koi_fpflag_nt",
    "koi_fpflag_ss",
    "koi_fpflag_co",
    "koi_fpflag_ec",
    "koi_score",
)
KEPLERNAMES_COLS = ("kepid", "koi_name", "kepler_name")


def exoplanet_tables(refresh: bool = False) -> dict[str, Path]:
    out = {}
    for table, cols in (
        ("keplerstellar", KEPLERSTELLAR_COLS),
        ("cumulative", CUMULATIVE_COLS),
        ("keplernames", KEPLERNAMES_COLS),
    ):
        dest = config.RAW_DIR / "exoplanet_archive" / f"{table}.csv"
        if not dest.exists() or refresh:
            _log(f"querying Exoplanet Archive: {table}")
        out[table] = tap_csv(
            config.EXOPLANET_TAP_SYNC, f"select {', '.join(cols)} from {table}", dest, refresh
        )
    return out


def crossmatch(refresh: bool = False) -> Path:
    dest = config.RAW_DIR / "gaia_kepler_fun" / config.CROSSMATCH_FILE
    return download(config.CROSSMATCH_URL, dest, refresh)


# ---------------------------------------------------------------- Gaia DR3

GAIA_COLS = (
    "g.source_id",
    "g.ra",
    "g.dec",
    "g.parallax",
    "g.parallax_over_error",
    "g.phot_g_mean_mag",
    "g.bp_rp",
    "g.teff_gspphot",
    "g.mh_gspphot",
)
# radius_gspphot is not in gaia_source; it lives in gaiadr3.astrophysical_parameters. Joining it
# into the cone query made tiles ~4x slower and hit sync timeouts, so it is fetched separately by
# source_id, only for stars that end up in baked sectors (see gaia_radius and NOTES.md).


@dataclass(frozen=True)
class Tile:
    ra0: float
    ra1: float
    dec0: float
    dec1: float

    @property
    def name(self) -> str:
        return f"ra{self.ra0:07.3f}_{self.ra1:07.3f}_dec{self.dec0:+07.3f}_{self.dec1:+07.3f}"


def gaia_tiles(center_ra: float, center_dec: float) -> list[Tile]:
    """Half-open RA/Dec boxes covering the query cone (the ADQL also clips to the cone)."""
    q = config.GAIA_QUERY
    r = q.cone_radius_deg
    tiles = []
    dec_edges = np.arange(center_dec - r, center_dec + r + 1e-9, q.tile_dec_deg)
    if dec_edges[-1] < center_dec + r:
        dec_edges = np.append(dec_edges, center_dec + r)
    for d0, d1 in zip(dec_edges[:-1], dec_edges[1:], strict=True):
        worst = max(abs(d0), abs(d1))
        half = math.degrees(
            math.asin(min(1.0, math.sin(math.radians(r)) / math.cos(math.radians(worst))))
        )
        half += 0.01
        n = max(1, math.ceil(2 * half / q.tile_ra_deg))
        ra_edges = np.linspace(center_ra - half, center_ra + half, n + 1)
        # Adjacent boxes share identical rounded edges, so half-open bounds never double-count.
        for a0, a1 in zip(ra_edges[:-1], ra_edges[1:], strict=True):
            tiles.append(Tile(round(a0, 3), round(a1, 3), round(d0, 3), round(d1, 3)))
    return tiles


def gaia_tile_adql(tile: Tile, center_ra: float, center_dec: float) -> str:
    q = config.GAIA_QUERY
    return (
        f"SELECT {', '.join(GAIA_COLS)} FROM gaiadr3.gaia_source AS g "
        f"WHERE 1=CONTAINS(POINT('ICRS', g.ra, g.dec), "
        f"CIRCLE('ICRS', {center_ra:.6f}, {center_dec:.6f}, {q.cone_radius_deg})) "
        f"AND g.ra >= {tile.ra0} AND g.ra < {tile.ra1} "
        f"AND g.dec >= {tile.dec0} AND g.dec < {tile.dec1} "
        f"AND g.parallax_over_error >= {config.MIN_PARALLAX_OVER_ERROR} "
        f"AND g.parallax BETWEEN {q.parallax_mas[0]} AND {q.parallax_mas[1]}"
    )


def gaia_tile_dir(center_ra: float, center_dec: float) -> Path:
    """Cache folder keyed by a hash of the query template, so a changed query never mixes in."""
    template = gaia_tile_adql(Tile(0.0, 1.0, 0.0, 1.0), center_ra, center_dec)
    key = hashlib.sha1(template.encode()).hexdigest()[:8]
    return config.RAW_DIR / "gaia_dr3" / f"gaia_source_cone_{center_ra:.3f}_{center_dec:+.3f}_{key}"


def _is_timeout(e: Exception) -> bool:
    if isinstance(e, requests.Timeout):
        return True
    return (
        isinstance(e, requests.HTTPError)
        and e.response is not None
        and e.response.status_code in (408, 504)
    )


def split_tile(t: Tile) -> list[Tile]:
    ra_mid = round((t.ra0 + t.ra1) / 2, 4)
    dec_mid = round((t.dec0 + t.dec1) / 2, 4)
    return [
        Tile(t.ra0, ra_mid, t.dec0, dec_mid),
        Tile(ra_mid, t.ra1, t.dec0, dec_mid),
        Tile(t.ra0, ra_mid, dec_mid, t.dec1),
        Tile(ra_mid, t.ra1, dec_mid, t.dec1),
    ]


def gaia(center_ra: float, center_dec: float, refresh: bool = False) -> list[Path]:
    """Fetch every tile of the Gaia cone: sync TAP, parallel, cached per tile, resumable.

    The archive's sync endpoint times out (HTTP 408) on dense tiles, and its async queue was
    backed up for minutes even on trivial jobs, so a tile that times out is split into four
    quarters (recursively, up to max depth). A `<tile>.split` marker records the split so a rerun
    goes straight to the quarters.
    """
    q = config.GAIA_QUERY
    tiles = gaia_tiles(center_ra, center_dec)
    tile_dir = gaia_tile_dir(center_ra, center_dec)
    tile_dir.mkdir(parents=True, exist_ok=True)
    max_depth = 3
    progress = {"done": 0}

    def fetch_tile(t: Tile, depth: int) -> list[Path]:
        dest = tile_dir / f"{t.name}.csv"
        marker = tile_dir / f"{t.name}.split"
        if refresh:
            marker.unlink(missing_ok=True)
        if marker.exists() and not refresh:
            return [p for child in split_tile(t) for p in fetch_tile(child, depth + 1)]
        if dest.exists() and not refresh:
            return [dest]
        adql = gaia_tile_adql(t, center_ra, center_dec)
        for attempt in range(1, q.retries + 1):
            try:
                tap_csv(
                    f"{config.GAIA_TAP}/sync", adql, dest, refresh, q.timeout_s, 1, gaia_style=True
                )
                return [dest]
            except (requests.RequestException, RuntimeError) as e:
                if _is_timeout(e) and depth < max_depth:
                    _log(f"{t.name}: timed out, splitting into quarters (depth {depth + 1})")
                    marker.write_text("split after sync timeout\n")
                    return [p for child in split_tile(t) for p in fetch_tile(child, depth + 1)]
                if attempt == q.retries:
                    raise
                wait = 5 * 2 ** (attempt - 1)
                _log(f"{t.name}: {e!s:.100} — retry {attempt}/{q.retries - 1} in {wait}s")
                time.sleep(wait)
        raise AssertionError("unreachable")

    def one(t: Tile) -> list[Path]:
        paths = fetch_tile(t, 0)
        progress["done"] += 1
        if progress["done"] % 10 == 0 or progress["done"] == len(tiles):
            _log(f"Gaia DR3: {progress['done']}/{len(tiles)} tiles")
        return paths

    with ThreadPoolExecutor(q.workers) as pool:
        results = list(pool.map(one, tiles))
    return [p for paths in results for p in paths]


def gaia_radius(source_ids: list[int], refresh: bool = False, chunk: int = 400) -> list[Path]:
    """radius_gspphot from astrophysical_parameters for the given sources, in cached chunks.

    Chunks are keyed by a hash of their (sorted) ids, so re-baking the same sectors re-uses them.
    """
    q = config.GAIA_QUERY
    ids = sorted({int(i) for i in source_ids})
    out_dir = config.RAW_DIR / "gaia_dr3" / "astrophysical_parameters_radius"
    chunks = [ids[i : i + chunk] for i in range(0, len(ids), chunk)]
    paths = []
    for c in chunks:
        key = hashlib.sha1(",".join(map(str, c)).encode()).hexdigest()[:16]
        paths.append(out_dir / f"{key}.csv")
    todo = [(c, p) for c, p in zip(chunks, paths, strict=True) if refresh or not p.exists()]
    if todo:
        _log(f"Gaia DR3 radius_gspphot: {len(todo)}/{len(chunks)} chunks to fetch")

    def one(item: tuple[list[int], Path]) -> None:
        c, p = item
        adql = (
            "SELECT source_id, radius_gspphot FROM gaiadr3.astrophysical_parameters "
            f"WHERE source_id IN ({', '.join(map(str, c))})"
        )
        tap_csv(
            f"{config.GAIA_TAP}/sync", adql, p, refresh, q.timeout_s, q.retries, gaia_style=True
        )

    with ThreadPoolExecutor(q.workers) as pool:
        list(pool.map(one, todo))
    return paths
