"""Coordinate transforms checked against astropy (no network)."""

import astropy.units as u
import numpy as np
import pytest
from astropy.coordinates import Galactic, SkyCoord

from transit_pipeline import config, stars

# (ra deg, dec deg, parallax mas): Kepler-field-like points plus awkward edge cases.
FIXTURES = np.array(
    [
        [290.6667, 44.5, 3.3],  # field center, ~300 pc
        [279.7, 36.6, 9.8],  # field corner, near
        [301.7, 52.4, 1.7],  # field corner, far
        [0.0, 0.0, 5.0],
        [359.999, -89.9, 2.0],
        [180.0, 89.9, 10.0],
    ]
)


def test_icrs_xyz_matches_astropy() -> None:
    ra, dec, plx = FIXTURES.T
    ours = stars.icrs_xyz_ly(ra, dec, plx)
    c = SkyCoord(ra=ra * u.deg, dec=dec * u.deg, distance=(1000 / plx) * u.pc, frame="icrs")
    theirs = np.stack([c.cartesian.x, c.cartesian.y, c.cartesian.z], axis=-1).to_value(u.lyr)
    # PC_TO_LY is rounded to 5 significant figures (3.2616 vs 3.26156...).
    np.testing.assert_allclose(ours, theirs, rtol=2e-5)


def test_galactic_north_matches_astropy() -> None:
    pole = SkyCoord(l=0 * u.deg, b=90 * u.deg, frame=Galactic).icrs
    theirs = stars.unit_vectors(np.array(pole.ra.deg), np.array(pole.dec.deg))
    np.testing.assert_allclose(stars.galactic_north(), theirs, atol=1e-6)


def test_to_radec_roundtrip() -> None:
    for ra, dec, _ in FIXTURES:
        v = stars.unit_vectors(np.array(ra), np.array(dec))
        r2, d2 = stars.to_radec(v)
        assert d2 == pytest.approx(dec, abs=1e-9)
        if abs(dec) < 89:
            assert (r2 - ra + 180) % 360 - 180 == pytest.approx(0, abs=1e-9)


def test_angular_separation_matches_astropy() -> None:
    ra, dec, _ = FIXTURES.T
    v = stars.unit_vectors(ra, dec)
    center = stars.unit_vectors(np.array(290.6667), np.array(44.5))
    theirs = (
        SkyCoord(ra * u.deg, dec * u.deg).separation(SkyCoord(290.6667 * u.deg, 44.5 * u.deg)).deg
    )
    np.testing.assert_allclose(stars.angular_sep_deg(v, center), theirs, atol=1e-7)


@pytest.mark.parametrize("axis", [[1, 0, 0], [0.3, -0.5, 0.8], [0, 0, 1], stars.galactic_north()])
def test_sector_frame_is_right_handed_orthonormal(axis) -> None:
    f = stars.sector_frame(np.asarray(axis, dtype=float))
    np.testing.assert_allclose(f @ f.T, np.eye(3), atol=1e-12)
    assert np.linalg.det(f) == pytest.approx(1.0)
    np.testing.assert_allclose(f[0], np.asarray(axis) / np.linalg.norm(axis), atol=1e-12)


def test_sector_frame_z_points_toward_galactic_north() -> None:
    f = stars.sector_frame(np.array([0.3, -0.5, 0.8]))
    assert f[2] @ stars.galactic_north() > 0


def test_tangent_plane_center_and_scale() -> None:
    c = stars.unit_vectors(np.array(290.0), np.array(44.0))
    assert np.allclose(stars.tangent_plane(c[None], c), 0)
    north = stars.unit_vectors(np.array(290.0), np.array(45.0))
    x, y = stars.tangent_plane(north[None], c)[0]
    assert x == pytest.approx(0, abs=1e-9)
    assert y == pytest.approx(np.degrees(np.tan(np.radians(1.0))), rel=1e-9)


def test_pc_to_ly_constant() -> None:
    assert config.PC_TO_LY == pytest.approx((1 * u.pc).to_value(u.lyr), rel=1e-4)
