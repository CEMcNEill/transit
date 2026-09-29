"""Command-line entry point: `uv run transit-pipeline <command>`."""

from __future__ import annotations

import argparse
import sys

COMMANDS = ("fetch", "bake", "validate", "all")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="transit-pipeline", description=__doc__)
    parser.add_argument("command", choices=COMMANDS)
    parser.add_argument("--refresh", action="store_true", help="re-download cached files in raw/")
    args = parser.parse_args(argv)
    print(f"transit-pipeline {args.command}: not implemented until Milestone 1", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
