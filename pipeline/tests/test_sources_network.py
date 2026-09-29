"""Live checks that the remote sources still have the columns the pipeline relies on."""

import io

import pandas as pd
import pytest
import requests

from transit_pipeline import config, fetch

pytestmark = pytest.mark.network


@pytest.mark.parametrize(
    ("table", "cols"),
    [
        ("keplerstellar", fetch.KEPLERSTELLAR_COLS),
        ("cumulative", fetch.CUMULATIVE_COLS),
        ("keplernames", fetch.KEPLERNAMES_COLS),
    ],
)
def test_exoplanet_archive_columns(table, cols) -> None:
    r = requests.get(
        config.EXOPLANET_TAP_SYNC,
        params={"query": f"select top 1 * from {table}", "format": "csv"},
        timeout=60,
    )
    r.raise_for_status()
    assert set(cols) <= set(pd.read_csv(io.StringIO(r.text)).columns)


def test_gaia_columns() -> None:
    adql = fetch.gaia_tile_adql(fetch.Tile(290.0, 290.05, 44.0, 44.05), 290.637, 44.526)
    r = requests.post(
        f"{config.GAIA_TAP}/sync",
        data={"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "csv", "QUERY": adql},
        timeout=120,
    )
    r.raise_for_status()
    cols = pd.read_csv(io.StringIO(r.text)).columns
    assert {c.split(".")[1] for c in fetch.GAIA_COLS} <= set(cols)
