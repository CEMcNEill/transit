"""Star table assembly: Kepler targets, Gaia DR3 neighbors, crossmatch, coordinate transforms.

Coordinates: positions are ICRS Cartesian in light-years (x toward RA=0/Dec=0, z toward the
celestial north pole). The Sun is at the origin.
"""

from __future__ import annotations

import re
import warnings
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from . import config

# Galactic north pole in ICRS (IAU 1958 definition as realized by astropy's Galactic frame).
# tests/test_coords.py checks this against astropy.
GALACTIC_NORTH_RA_DEG = 192.85948
GALACTIC_NORTH_DEC_DEG = 27.12825


class SchemaError(RuntimeError):
    pass


def require_columns(df: pd.DataFrame, cols: Iterable[str], source: str) -> None:
    missing = [c for c in cols if c not in df.columns]
    if missing:
        raise SchemaError(f"{source} is missing expected columns {missing}; got {list(df.columns)}")


# ---------------------------------------------------------------- transforms


def unit_vectors(ra_deg: np.ndarray, dec_deg: np.ndarray) -> np.ndarray:
    ra, dec = np.radians(ra_deg), np.radians(dec_deg)
    return np.stack([np.cos(dec) * np.cos(ra), np.cos(dec) * np.sin(ra), np.sin(dec)], axis=-1)


def to_radec(v: np.ndarray) -> tuple[float, float]:
    v = v / np.linalg.norm(v)
    return float(np.degrees(np.arctan2(v[1], v[0])) % 360), float(np.degrees(np.arcsin(v[2])))


def parallax_to_ly(parallax_mas: np.ndarray) -> np.ndarray:
    return 1000.0 / np.asarray(parallax_mas, dtype=float) * config.PC_TO_LY


def icrs_xyz_ly(ra_deg: np.ndarray, dec_deg: np.ndarray, parallax_mas: np.ndarray) -> np.ndarray:
    return unit_vectors(ra_deg, dec_deg) * parallax_to_ly(parallax_mas)[..., None]


def galactic_north() -> np.ndarray:
    return unit_vectors(np.array(GALACTIC_NORTH_RA_DEG), np.array(GALACTIC_NORTH_DEC_DEG))


def tangent_plane(v: np.ndarray, center: np.ndarray) -> np.ndarray:
    """Gnomonic projection (degrees) of unit vectors v about unit vector center."""
    east = np.cross([0.0, 0.0, 1.0], center)
    east /= np.linalg.norm(east)
    north = np.cross(center, east)
    w = v @ center
    return np.degrees(np.stack([(v @ east) / w, (v @ north) / w], axis=-1))


def angular_sep_deg(v: np.ndarray, center: np.ndarray) -> np.ndarray:
    return np.degrees(np.arccos(np.clip(v @ center, -1.0, 1.0)))


def sector_frame(axis: np.ndarray) -> np.ndarray:
    """Rows are the sector-local basis: x along the corridor, z toward galactic north (projected
    perpendicular to x), y = z cross x. Right-handed."""
    x = axis / np.linalg.norm(axis)
    gn = galactic_north()
    z = gn - (gn @ x) * x
    if np.linalg.norm(z) < 1e-6:  # corridor parallel to galactic pole: pick celestial north
        z = np.array([0.0, 0.0, 1.0]) - x[2] * x
    z /= np.linalg.norm(z)
    y = np.cross(z, x)
    return np.stack([x, y, z])


# ---------------------------------------------------------------- source tables


def load_keplerstellar(path: Path) -> tuple[pd.DataFrame, dict]:
    """One row per kepid, taking the newest delivery (config.KEPLERSTELLAR_DELIVERY_PRIORITY)."""
    df = pd.read_csv(path)
    require_columns(
        df, ("kepid", "ra", "dec", "teff", "radius", "kepmag", "st_delivname"), "keplerstellar"
    )
    rank = {d: i for i, d in enumerate(config.KEPLERSTELLAR_DELIVERY_PRIORITY)}
    unknown = sorted(set(df.st_delivname) - set(rank))
    if unknown:
        raise SchemaError(f"keplerstellar has deliveries not in the priority list: {unknown}")
    df["_rank"] = df.st_delivname.map(rank)
    deduped = df.sort_values(["kepid", "_rank"]).drop_duplicates("kepid").drop(columns="_rank")
    stats = {
        "rows": len(df),
        "kepids": len(deduped),
        "chosen_delivery": deduped.st_delivname.value_counts().to_dict(),
    }
    return deduped.reset_index(drop=True), stats


def load_crossmatch(path: Path) -> tuple[pd.DataFrame, dict]:
    """kepid -> Gaia DR3 source_id. A few Gaia sources match two KICs; keep the closer match."""
    from astropy.table import Table

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")  # non-FITS units like 'dex' in the file header
        t = Table.read(path)
    df = t[["kepid", "source_id", "kepler_gaia_ang_dist"]].to_pandas()
    shared = df.source_id.duplicated(keep=False)
    deduped = df.sort_values("kepler_gaia_ang_dist").drop_duplicates("source_id")
    stats = {"rows": len(df), "gaia_sources_shared_by_two_kics": int(shared.sum() // 2)}
    return deduped[["kepid", "source_id"]].reset_index(drop=True), stats


FP_FLAG_COLS = ("koi_fpflag_nt", "koi_fpflag_ss", "koi_fpflag_co", "koi_fpflag_ec")


def load_cumulative(path: Path) -> pd.DataFrame:
    """Non-false-positive KOIs (CONFIRMED and CANDIDATE)."""
    df = pd.read_csv(path)
    require_columns(
        df,
        (
            "kepid",
            "kepoi_name",
            "kepler_name",
            "koi_disposition",
            "koi_period",
            "koi_prad",
            "koi_sma",
            "koi_teq",
            *FP_FLAG_COLS,
        ),
        "cumulative",
    )
    return df[df.koi_disposition.isin(["CONFIRMED", "CANDIDATE"])].reset_index(drop=True)


_PLANET_SUFFIX = re.compile(r"\s+[a-z]$")


def host_name(planet_name: str) -> str:
    """'Kepler-452 b' -> 'Kepler-452'."""
    return _PLANET_SUFFIX.sub("", planet_name.strip())


def load_host_names(path: Path) -> pd.DataFrame:
    """kepid -> host star name from keplernames (includes hosts with no cumulative KOI row)."""
    df = pd.read_csv(path)
    require_columns(df, ("kepid", "kepler_name"), "keplernames")
    df["name"] = df.kepler_name.map(host_name)
    names = df.groupby("kepid").name.agg(lambda s: sorted(set(s)))
    ambiguous = names[names.map(len) > 1]
    if len(ambiguous):
        raise SchemaError(f"kepids with multiple host names: {ambiguous.to_dict()}")
    return names.map(lambda s: s[0]).rename("name").reset_index()


def load_gaia(paths: list[Path]) -> pd.DataFrame:
    frames = [pd.read_csv(p) for p in paths]
    df = pd.concat([f for f in frames if len(f)], ignore_index=True)
    require_columns(
        df,
        (
            "source_id",
            "ra",
            "dec",
            "parallax",
            "parallax_over_error",
            "phot_g_mean_mag",
            "bp_rp",
            "teff_gspphot",
            "mh_gspphot",
        ),
        "gaia tiles",
    )
    dupes = int(df.source_id.duplicated().sum())
    if dupes:
        raise SchemaError(f"{dupes} Gaia sources appear in more than one tile")
    return df


# ---------------------------------------------------------------- field geometry


@dataclass(frozen=True)
class Footprint:
    """Kepler field on the sky: occupied cells of a tangent-plane grid, dilated by one cell."""

    center: np.ndarray
    cell_deg: float
    origin: np.ndarray
    mask: np.ndarray

    def contains(self, v: np.ndarray) -> np.ndarray:
        v = np.atleast_2d(v)
        front = v @ self.center > 0
        xy = tangent_plane(v, self.center)
        ij = np.floor((xy - self.origin) / self.cell_deg).astype(int)
        ok = (
            front
            & (ij >= 0).all(1)
            & (ij[:, 0] < self.mask.shape[0])
            & (ij[:, 1] < self.mask.shape[1])
        )
        out = np.zeros(len(v), bool)
        out[ok] = self.mask[ij[ok, 0], ij[ok, 1]]
        return out


def field_center(ra_deg: np.ndarray, dec_deg: np.ndarray) -> np.ndarray:
    """Center of the targets' tangent-plane bounding box (not the mean, which is density-biased)."""
    v = unit_vectors(ra_deg, dec_deg)
    mean = v.mean(0)
    mean /= np.linalg.norm(mean)
    xy = tangent_plane(v, mean)
    mid = (xy.min(0) + xy.max(0)) / 2
    east = np.cross([0.0, 0.0, 1.0], mean)
    east /= np.linalg.norm(east)
    north = np.cross(mean, east)
    c = mean + np.tan(np.radians(mid[0])) * east + np.tan(np.radians(mid[1])) * north
    return c / np.linalg.norm(c)


def footprint(ra_deg: np.ndarray, dec_deg: np.ndarray, cell_deg: float) -> Footprint:
    center = field_center(ra_deg, dec_deg)
    xy = tangent_plane(unit_vectors(ra_deg, dec_deg), center)
    origin = xy.min(0) - 2 * cell_deg
    shape = np.ceil((xy.max(0) + 2 * cell_deg - origin) / cell_deg).astype(int) + 1
    mask = np.zeros(shape, bool)
    ij = np.floor((xy - origin) / cell_deg).astype(int)
    mask[ij[:, 0], ij[:, 1]] = True
    dilated = mask.copy()
    for di in (-1, 0, 1):
        for dj in (-1, 0, 1):
            dilated |= np.roll(np.roll(mask, di, 0), dj, 1)
    return Footprint(center, cell_deg, origin, dilated)


# ---------------------------------------------------------------- merged star table


def build_star_table(
    gaia: pd.DataFrame,
    kepler: pd.DataFrame,
    xmatch: pd.DataFrame,
    kois: pd.DataFrame,
    hosts: pd.DataFrame,
    landmarks: dict[str, str],
) -> tuple[pd.DataFrame, dict]:
    """Every Gaia star passing the distance-quality cut, annotated with Kepler data.

    Values: teff/radius prefer the Kepler stellar catalog for Kepler targets and fall back to
    Gaia GSP-Phot; mh is Gaia mh_gspphot (nullable); gmag is Gaia G.
    """
    g = gaia[gaia.parallax_over_error >= config.MIN_PARALLAX_OVER_ERROR].copy()
    if "radius_gspphot" not in g:
        g["radius_gspphot"] = np.nan  # filled later for sector members by apply_gaia_radius
    g = g.merge(xmatch, on="source_id", how="left")
    g = g.merge(
        kepler[["kepid", "teff", "radius", "kepmag"]].rename(
            columns={"teff": "kic_teff", "radius": "kic_radius"}
        ),
        on="kepid",
        how="left",
    )
    g = g.merge(hosts, on="kepid", how="left")
    g["kepid"] = g.kepid.astype("Int64")
    g["teff"] = g.kic_teff.fillna(g.teff_gspphot)
    g["radius"] = g.kic_radius.fillna(g.radius_gspphot)
    g["dist_ly"] = parallax_to_ly(g.parallax.to_numpy())
    xyz = icrs_xyz_ly(g.ra.to_numpy(), g.dec.to_numpy(), g.parallax.to_numpy())
    g["x"], g["y"], g["z"] = xyz[:, 0], xyz[:, 1], xyz[:, 2]

    koi_kepids = set(kois.kepid)
    confirmed_kepids = set(kois.kepid[kois.koi_disposition == "CONFIRMED"]) | set(hosts.kepid)
    g["keplerTarget"] = g.kepid.notna()
    g["koi"] = g.kepid.isin(koi_kepids).fillna(False).astype(bool)
    g["host"] = g.kepid.isin(confirmed_kepids).fillna(False).astype(bool)
    g["landmark"] = False
    landmark_report = {}
    for label, key in landmarks.items():
        if key.startswith("KIC "):
            hit = g.kepid == int(key.removeprefix("KIC "))
            kepid = int(key.removeprefix("KIC "))
        else:
            ids = hosts.kepid[hosts.name == key]
            kepid = int(ids.iloc[0]) if len(ids) else None
            hit = g.kepid == kepid if kepid is not None else pd.Series(False, index=g.index)
        hit = hit.fillna(False).astype(bool)
        g.loc[hit, "landmark"] = True
        if label != key:
            g.loc[hit, "name"] = label
        landmark_report[label] = {"kepid": kepid, "in_gaia_volume": bool(hit.any())}
        if hit.any():
            row = g[hit].iloc[0]
            landmark_report[label]["dist_ly"] = round(float(row.dist_ly), 1)
    stats = {
        "gaia_rows": len(gaia),
        "stars": len(g),
        "kepler_targets": int(g.keplerTarget.sum()),
        "hosts": int(g.host.sum()),
        "kois": int(g.koi.sum()),
        "landmarks": landmark_report,
    }
    return g.reset_index(drop=True), stats


def apply_gaia_radius(table: pd.DataFrame, radius_paths: list[Path]) -> int:
    """Fill radius_gspphot (and radius where the Kepler catalog has none) from fetched chunks."""
    frames = [pd.read_csv(p) for p in radius_paths]
    frames = [f for f in frames if len(f)]
    if not frames:
        return 0
    ap = pd.concat(frames, ignore_index=True)
    require_columns(ap, ("source_id", "radius_gspphot"), "astrophysical_parameters")
    lookup = ap.dropna().drop_duplicates("source_id").set_index("source_id").radius_gspphot
    got = table.source_id.map(lookup)
    table["radius_gspphot"] = table.radius_gspphot.fillna(got)
    table["radius"] = table.kic_radius.fillna(table.radius_gspphot)
    return int(got.notna().sum())
