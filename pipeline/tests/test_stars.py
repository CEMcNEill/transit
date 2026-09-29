"""Source loaders and star-table assembly on small fixtures (no network)."""

import numpy as np
import pandas as pd
import pytest
from astropy.table import Table

from transit_pipeline import stars


def test_keplerstellar_dedupe_prefers_newest_delivery(tmp_path) -> None:
    p = tmp_path / "ks.csv"
    pd.DataFrame(
        {
            "kepid": [1, 1, 1, 2],
            "ra": [290.0] * 4,
            "dec": [44.0] * 4,
            "teff": [5000, 5100, 5200, 6000],
            "radius": [1.0] * 4,
            "kepmag": [12.0] * 4,
            "st_delivname": [
                "q1_q12_stellar",
                "q1_q17_dr25_supp_stellar",
                "q1_q17_dr25_stellar",
                "q1_q16_stellar",
            ],
        }
    ).to_csv(p, index=False)
    df, st = stars.load_keplerstellar(p)
    assert df.set_index("kepid").teff.to_dict() == {1: 5100, 2: 6000}
    assert st["kepids"] == 2


def test_keplerstellar_unknown_delivery_fails_loudly(tmp_path) -> None:
    p = tmp_path / "ks.csv"
    pd.DataFrame(
        {
            "kepid": [1],
            "ra": [1.0],
            "dec": [1.0],
            "teff": [1],
            "radius": [1],
            "kepmag": [1],
            "st_delivname": ["new_one"],
        }
    ).to_csv(p, index=False)
    with pytest.raises(stars.SchemaError):
        stars.load_keplerstellar(p)


def test_missing_column_fails_loudly(tmp_path) -> None:
    p = tmp_path / "ks.csv"
    pd.DataFrame({"kepid": [1]}).to_csv(p, index=False)
    with pytest.raises(stars.SchemaError, match="missing expected columns"):
        stars.load_keplerstellar(p)


def test_crossmatch_keeps_closest_kic_for_shared_gaia_source(tmp_path) -> None:
    p = tmp_path / "xm.fits"
    Table(
        {
            "kepid": np.array([10, 11, 12]),
            "source_id": np.array([100, 100, 101]),
            "kepler_gaia_ang_dist": np.array([0.8, 0.2, 0.1]),
        }
    ).write(p)
    df, st = stars.load_crossmatch(p)
    assert dict(zip(df.source_id, df.kepid, strict=True)) == {100: 11, 101: 12}
    assert st["gaia_sources_shared_by_two_kics"] == 1


@pytest.mark.parametrize(
    ("planet", "host"),
    [
        ("Kepler-452 b", "Kepler-452"),
        ("Kepler-1625 b", "Kepler-1625"),
        ("Kepler-90 i", "Kepler-90"),
    ],
)
def test_host_name(planet, host) -> None:
    assert stars.host_name(planet) == host


def _fixture_tables():
    gaia = pd.DataFrame(
        {
            "source_id": [100, 101, 102, 103],
            "ra": [290.0, 291.0, 292.0, 293.0],
            "dec": [44.0, 44.5, 45.0, 45.5],
            "parallax": [3.0, 4.0, 5.0, 2.0],
            "parallax_over_error": [50.0, 20.0, 5.0, 12.0],  # 102 fails the quality cut
            "phot_g_mean_mag": [12.0, 13.0, 14.0, 15.0],
            "bp_rp": [0.8, 1.0, 1.2, 2.5],
            "teff_gspphot": [5800.0, np.nan, 5000.0, 3400.0],
            "mh_gspphot": [0.1, np.nan, 0.0, -0.3],
            "radius_gspphot": [1.0, np.nan, 0.8, 0.4],
        }
    )
    kepler = pd.DataFrame(
        {"kepid": [1, 2], "teff": [5757.0, 6100.0], "radius": [1.1, 1.3], "kepmag": [13.4, 12.0]}
    )
    xmatch = pd.DataFrame({"kepid": [1, 2], "source_id": [100, 101]})
    kois = pd.DataFrame({"kepid": [1, 2], "koi_disposition": ["CONFIRMED", "CANDIDATE"]})
    hosts = pd.DataFrame({"kepid": [1], "name": ["Kepler-452"]})
    return gaia, kepler, xmatch, kois, hosts


def test_build_star_table_flags_values_and_landmarks() -> None:
    gaia, kepler, xmatch, kois, hosts = _fixture_tables()
    t, st = stars.build_star_table(
        gaia,
        kepler,
        xmatch,
        kois,
        hosts,
        {"Kepler-452": "Kepler-452", "Kepler-999": "Kepler-999", "Odd Star": "KIC 2"},
    )
    t = t.set_index("source_id")
    assert list(t.index) == [100, 101, 103]  # parallax_over_error cut
    assert t.loc[100, "teff"] == 5757.0  # Kepler catalog preferred
    assert t.loc[103, "teff"] == 3400.0  # Gaia fallback
    assert bool(t.loc[100, "host"]) and bool(t.loc[100, "koi"]) and bool(t.loc[100, "landmark"])
    assert not bool(t.loc[101, "host"]) and bool(t.loc[101, "koi"]) and bool(t.loc[101, "landmark"])
    assert t.loc[101, "name"] == "Odd Star"
    assert not bool(t.loc[103, "keplerTarget"])
    assert t.loc[100, "dist_ly"] == pytest.approx(1000 / 3.0 * 3.2616)
    assert st["landmarks"]["Kepler-999"] == {"kepid": None, "in_gaia_volume": False}


def test_footprint_contains_targets_but_not_far_sky() -> None:
    rng = np.random.default_rng(1)
    ra = 290 + rng.uniform(-3, 3, 2000)
    dec = 44 + rng.uniform(-3, 3, 2000)
    fp = stars.footprint(ra, dec, 0.25)
    assert fp.contains(stars.unit_vectors(ra, dec)).all()
    far = stars.unit_vectors(np.array([100.0, 290.0, 290.0]), np.array([0.0, 60.0, 30.0]))
    assert not fp.contains(far).any()
