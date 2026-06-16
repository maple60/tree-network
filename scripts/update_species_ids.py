from __future__ import annotations

import argparse
import csv
import re
import sys
import unicodedata
from pathlib import Path

from tree_data import REPO_ROOT, TREE_CSV

MAX_LISTED_ERRORS = 20


def species_id_from_scientific_name(scientific_name: str) -> str:
    text = unicodedata.normalize("NFKD", scientific_name.strip())
    text = text.replace("\u00d7", " x ")
    text = text.replace("'", "").replace('"', "")
    text = "".join(char for char in text if not unicodedata.combining(char))
    text = text.lower()
    text = re.sub(r"\b(var|subsp|ssp|f|forma|cf|aff)\.", r"\1", text)
    text = text.encode("ascii", "ignore").decode("ascii")
    text = re.sub(r"[^a-z0-9]+", "-", text)
    text = re.sub(r"-+", "-", text)
    return text.strip("-")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Update data/trees.csv id values from scientific_name."
    )
    parser.add_argument("--input", type=Path, default=TREE_CSV)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--check", action="store_true", help="validate generated IDs without writing")
    args = parser.parse_args()

    rows, fieldnames = read_csv(args.input)
    errors = validate_columns(fieldnames)
    if errors:
        print_errors(errors)
        return 1

    errors = assign_species_ids(rows)
    if errors:
        print_errors(errors)
        return 1

    if not args.check:
        output_path = args.output or args.input
        write_csv(output_path, rows, fieldnames)
        print(f"Wrote {output_path.relative_to(REPO_ROOT)}")
    print(f"OK: {len(rows)} species IDs generated from scientific_name")
    return 0


def read_csv(path: Path) -> tuple[list[dict[str, str]], list[str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        rows = [{key: (value or "").strip() for key, value in row.items()} for row in reader]
        return rows, list(reader.fieldnames or [])


def write_csv(path: Path, rows: list[dict[str, str]], fieldnames: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def validate_columns(fieldnames: list[str]) -> list[str]:
    errors: list[str] = []
    for column in ["id", "scientific_name"]:
        if column not in fieldnames:
            errors.append(f"missing required column: {column}")
    return errors


def assign_species_ids(rows: list[dict[str, str]]) -> list[str]:
    errors: list[str] = []
    assignments: list[tuple[dict[str, str], str]] = []
    generated: dict[str, list[tuple[int, dict[str, str]]]] = {}
    missing_scientific_names: list[tuple[int, dict[str, str]]] = []
    empty_generated_ids: list[tuple[int, dict[str, str]]] = []

    for index, row in enumerate(rows, 2):
        scientific_name = row.get("scientific_name", "").strip()
        if not scientific_name:
            missing_scientific_names.append((index, row))
            continue

        species_id = species_id_from_scientific_name(scientific_name)
        if not species_id:
            empty_generated_ids.append((index, row))
            continue

        assignments.append((row, species_id))
        generated.setdefault(species_id, []).append((index, row))

    add_limited_row_errors(
        errors,
        "missing scientific_name",
        missing_scientific_names,
    )
    add_limited_row_errors(
        errors,
        "scientific_name did not produce a URL-safe id",
        empty_generated_ids,
    )

    for species_id, matches in sorted(generated.items()):
        if len(matches) <= 1:
            continue
        errors.append(f"duplicate generated id: {species_id}")
        for line_number, row in matches:
            errors.append(
                f"  line {line_number}: id={row.get('id', '')} "
                f"ja_name={row.get('ja_name', '')} "
                f"scientific_name={row.get('scientific_name', '')}"
            )

    if errors:
        return errors

    for row, species_id in assignments:
        row["id"] = species_id
    return []


def add_limited_row_errors(
    errors: list[str],
    label: str,
    rows: list[tuple[int, dict[str, str]]],
) -> None:
    if not rows:
        return
    errors.append(f"{label}: {len(rows)} row(s)")
    for line_number, row in rows[:MAX_LISTED_ERRORS]:
        errors.append(
            f"  line {line_number}: id={row.get('id', '')} "
            f"ja_name={row.get('ja_name', '')}"
        )
    remaining = len(rows) - MAX_LISTED_ERRORS
    if remaining > 0:
        errors.append(f"  ... {remaining} more row(s)")


def print_errors(errors: list[str]) -> None:
    print("Species ID update failed:", file=sys.stderr)
    for error in errors:
        print(f"- {error}", file=sys.stderr)


if __name__ == "__main__":
    raise SystemExit(main())
