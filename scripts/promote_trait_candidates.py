from __future__ import annotations

import argparse
import csv
from pathlib import Path

from tree_data import REPO_ROOT, TREE_COLUMNS

DEFAULT_INPUT = REPO_ROOT / "data" / "trait_input_candidates.csv"
DEFAULT_OUTPUT = REPO_ROOT / "data" / "trees.csv"


def main() -> int:
    parser = argparse.ArgumentParser(description="Promote reviewed trait candidates to the site data schema.")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    rows = read_csv(args.input)
    promoted_rows = [{column: row.get(column, "").strip() for column in TREE_COLUMNS} for row in rows]
    write_csv(args.output, promoted_rows)

    print(f"Wrote {args.output.relative_to(REPO_ROOT)}")
    print(f"Rows: {len(promoted_rows)}")
    return 0


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        return [{key: (value or "") for key, value in row.items()} for row in csv.DictReader(f)]


def write_csv(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=TREE_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)


if __name__ == "__main__":
    raise SystemExit(main())
