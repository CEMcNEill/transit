"""Command-line entry point: `uv run transit-pipeline <command>`.

inspect   dump real source schemas to raw/schemas/ (run before trusting column names)
fetch     download every source into raw/ (cached; --refresh to force)
bake      search corridors and write data/sectors/*.json + index.json + report.md
validate  validate baked sectors
all       fetch + bake + validate (what `make data` runs)
"""

from __future__ import annotations

import argparse
import json
import sys
import time

import numpy as np

from . import config, fetch, sectors, stars, validate

COMMANDS = ("inspect", "fetch", "bake", "validate", "all")


def _log(msg: str) -> None:
    print(f"[pipeline] {msg}", flush=True)


def cmd_inspect() -> None:
    """Record what each source actually provides, so code never relies on guessed columns."""
    out = config.RAW_DIR / "schemas"
    out.mkdir(parents=True, exist_ok=True)
    for table in ("keplerstellar", "cumulative", "keplernames"):
        fetch.tap_csv(
            config.EXOPLANET_TAP_SYNC,
            f"select top 5 * from {table}",
            out / f"sample_{table}.csv",
            refresh=True,
        )
        _log(f"wrote schemas/sample_{table}.csv")
    from astroquery.gaia import Gaia

    lines = []
    for t in ("gaiadr3.gaia_source", "gaiadr3.astrophysical_parameters"):
        cols = [c.name for c in Gaia.load_table(t).columns]
        lines.append(f"{t} ({len(cols)} columns)\n  " + ", ".join(cols))
    (out / "gaia_dr3_columns.txt").write_text("\n\n".join(lines) + "\n")
    _log("wrote schemas/gaia_dr3_columns.txt")
    from astropy.table import Table

    xm = Table.read(fetch.crossmatch(), memmap=True)
    (out / "crossmatch_columns.txt").write_text(", ".join(xm.colnames) + "\n")
    _log("wrote schemas/crossmatch_columns.txt")


def load_sources(refresh: bool = False):
    paths = fetch.exoplanet_tables(refresh)
    kepler, kstats = stars.load_keplerstellar(paths["keplerstellar"])
    placed = kepler.dropna(subset=["ra", "dec"])
    fp = stars.footprint(
        placed.ra.to_numpy(), placed.dec.to_numpy(), config.CORRIDOR.footprint_cell_deg
    )
    ra, dec = stars.to_radec(fp.center)
    ra, dec = round(ra, 3), round(dec, 3)
    xmatch, xstats = stars.load_crossmatch(fetch.crossmatch(refresh))
    gaia = stars.load_gaia(fetch.gaia(ra, dec, refresh))
    kois = stars.load_cumulative(paths["cumulative"])
    hosts = stars.load_host_names(paths["keplernames"])
    return kepler, kstats, fp, (ra, dec), xmatch, xstats, gaia, kois, hosts


def distance_histogram(dist_ly: np.ndarray) -> dict[str, int]:
    edges_pc = [0, 100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 700]
    pc = dist_ly / config.PC_TO_LY
    hist, _ = np.histogram(pc, bins=edges_pc)
    return {
        f"{a}-{b} pc": int(n) for a, b, n in zip(edges_pc[:-1], edges_pc[1:], hist, strict=True)
    }


def cmd_bake(refresh: bool) -> None:
    t0 = time.time()
    kepler, kstats, fp, center, xmatch, xstats, gaia, kois, hosts = load_sources(refresh)
    table, sstats = stars.build_star_table(gaia, kepler, xmatch, kois, hosts, config.LANDMARKS)
    _log(f"star table: {sstats['stars']} stars ({sstats['kepler_targets']} Kepler targets)")

    searcher = sectors.Searcher(table, fp)
    cands = searcher.sample()
    _log(
        f"{len(cands)}/{config.CORRIDOR.candidates} candidate corridors pass geometry and star count"
    )
    ranges = config.jump_ranges()
    chosen = searcher.select(cands, ranges.starting_ly)
    _log(f"path checks: {searcher.path_stats}; chosen {len(chosen)}")
    if len(chosen) < config.CORRIDOR.sectors_to_bake:
        _log(
            f"WARNING: only {len(chosen)} sectors passed validation-level checks; tune config.CORRIDOR"
        )

    member_ids = table.source_id.iloc[sorted({int(i) for c in chosen for i in c.members})]
    n_radius = stars.apply_gaia_radius(table, fetch.gaia_radius(member_ids.tolist(), refresh))
    _log(f"radius_gspphot found for {n_radius}/{len(member_ids)} sector stars")
    bundles = [
        sectors.bake(c, f"s{i + 1:02d}", table, kois, ranges.max_ly) for i, c in enumerate(chosen)
    ]
    in_sectors = {int(i) for c in chosen for i in c.members}
    in_pool = {int(i) for c in cands for i in c.members}
    band = [d * config.PC_TO_LY for d in config.PREFERRED_DISTANCE_PC]
    landmark_report = sstats["landmarks"]
    for info in landmark_report.values():
        rows = table.index[table.kepid == info["kepid"]] if info["kepid"] is not None else []
        ti = int(rows[0]) if len(rows) else None
        info["in_distance_band"] = (
            info.get("dist_ly") is not None and band[0] <= info["dist_ly"] <= band[1]
        )
        info["in_candidate_pool"] = ti in in_pool
        info["in_a_sector"] = [
            b["id"] for b in bundles if any(s["kepid"] == info["kepid"] for s in b["stars"])
        ]
    kt = table[table.keplerTarget]
    provenance = {
        "fieldCenterRaDec": list(center),
        "sources": json.loads(fetch.MANIFEST.read_text()) if fetch.MANIFEST.exists() else {},
        "stats": {
            "keplerstellar": kstats,
            "crossmatch": xstats,
            "starTable": {k: v for k, v in sstats.items() if k != "landmarks"},
            "landmarks": landmark_report,
            "distanceHistogramAllStars": distance_histogram(table.dist_ly.to_numpy()),
            "distanceHistogramKeplerTargets": distance_histogram(kt.dist_ly.to_numpy()),
            "candidates": {
                "sampled": config.CORRIDOR.candidates,
                "passed": len(cands),
                "rejections": searcher.rejections,
                "pathChecks": searcher.path_stats,
                "jumpsOfEvaluated": sorted(c.jumps for c in cands if c.jumps is not None),
            },
            "starsInAnySector": len(in_sectors),
        },
    }
    entries = sectors.write_bundles(bundles, {"provenance": provenance})
    write_report(entries, provenance)
    _log(f"baked {len(entries)} sectors in {time.time() - t0:.0f}s -> {config.SECTORS_DIR}")


def write_report(entries: list[dict], prov: dict) -> None:
    lines = [
        "| Sector | Stars | Hosts | KOIs (stars) | Landmarks | Sun distance | Length × radius | G cut | Shortest path | File |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for e in entries:
        m = e["meta"]
        lines.append(
            f"| {e['id']} | {m['starCount']} | {m['hostCount']} | {m['koiCount']} ({m['koiStarCount']}) "
            f"| {', '.join(m['landmarks']) or '—'} | {e['sunDistanceLy']:,.0f} ly "
            f"| {m['lengthLy']:.0f} × {m['radiusLy']:.0f} ly | {m['gmagCut'] if m['gmagCut'] else '—'} "
            f"| {m['shortestPathJumps']} jumps | {e['bytes'] / 1024:,.0f} KB |"
        )
    s = prov["stats"]
    lines += ["", "Landmarks:", ""]
    for name, info in s["landmarks"].items():
        lines.append(f"- {name}: {json.dumps(info)}")
    lines += [
        "",
        "Distance histogram (all stars in query volume):",
        "",
        json.dumps(s["distanceHistogramAllStars"]),
    ]
    lines += [
        "",
        "Distance histogram (Kepler targets):",
        "",
        json.dumps(s["distanceHistogramKeplerTargets"]),
    ]
    c = s["candidates"]
    lines += [
        "",
        f"Candidates: {c['passed']}/{c['sampled']} passed; rejections {json.dumps(c['rejections'])}",
    ]
    lines += [
        f"Path checks: {json.dumps(c['pathChecks'])}; jumps of evaluated: {c['jumpsOfEvaluated']}"
    ]
    (config.SECTORS_DIR / "report.md").write_text("\n".join(lines) + "\n")


def cmd_validate() -> bool:
    reports = validate.validate_dir()
    ok = True
    for r in reports:
        status = "ok" if r.ok else "FAIL"
        _log(f"{r.sector_id}: {status} (shortest path {r.shortest_path_jumps} jumps)")
        for e in r.errors[:10]:
            _log(f"    {e}")
        ok &= r.ok
    return ok


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="transit-pipeline",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("command", choices=COMMANDS)
    parser.add_argument("--refresh", action="store_true", help="re-download cached files in raw/")
    args = parser.parse_args(argv)
    if args.command == "inspect":
        cmd_inspect()
    elif args.command == "fetch":
        load_sources(args.refresh)
    elif args.command == "bake":
        cmd_bake(args.refresh)
    elif args.command == "validate":
        return 0 if cmd_validate() else 1
    elif args.command == "all":
        cmd_bake(args.refresh)
        return 0 if cmd_validate() else 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
