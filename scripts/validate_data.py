from __future__ import annotations

import re
import sys
from collections import Counter

from tree_data import ATTRIBUTE_COLUMNS, TREE_COLUMNS, categories_by_id, load_attribute_config, load_trees, split_values
from update_species_ids import species_id_from_scientific_name

ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def main() -> int:
    errors: list[str] = []
    config = load_attribute_config()
    categories = categories_by_id(config)

    missing_categories = [column for column in ATTRIBUTE_COLUMNS if column not in categories]
    if missing_categories:
        errors.append(f"attributes.yml is missing categories: {', '.join(missing_categories)}")

    for category in config["categories"]:
        for key in ["id", "label", "color", "allow_free", "default_visible"]:
            if key not in category:
                errors.append(f"category '{category.get('id', '<unknown>')}' is missing '{key}'")
        if not category.get("allow_free") and not category.get("values"):
            errors.append(f"category '{category.get('id', '<unknown>')}' needs values or allow_free: true")

    rows = load_trees()
    if not rows:
        errors.append("trees.csv has no species rows")
        print_errors(errors)
        return 1

    actual_columns = list(rows[0].keys())
    if actual_columns != TREE_COLUMNS:
        errors.append(
            "trees.csv columns must be exactly: "
            + ", ".join(TREE_COLUMNS)
            + f"; got: {', '.join(actual_columns)}"
        )

    ids = [row.get("id", "") for row in rows]
    for species_id, count in Counter(ids).items():
        if count > 1:
            errors.append(f"duplicate id: {species_id}")

    closed_values = {
        category["id"]: set(category.get("values", []))
        for category in config["categories"]
        if not category.get("allow_free")
    }

    for line_number, row in enumerate(rows, 2):
        species_label = row.get("id") or f"line {line_number}"
        if not row.get("id"):
            errors.append(f"line {line_number}: missing id")
        elif not ID_RE.match(row["id"]):
            errors.append(f"{species_label}: id must be lowercase ASCII kebab-case")

        scientific_name = row.get("scientific_name", "")
        if scientific_name:
            expected_id = species_id_from_scientific_name(scientific_name)
            if not expected_id:
                errors.append(f"{species_label}: scientific_name did not produce a URL-safe id")
            elif row.get("id") != expected_id:
                errors.append(
                    f"{species_label}: id must match scientific_name-derived ID '{expected_id}'"
                )

        for column in ["ja_name"]:
            if not row.get(column):
                errors.append(f"{species_label}: missing required value '{column}'")

        for column in ATTRIBUTE_COLUMNS:
            raw_value = row.get(column, "")
            if ";;" in raw_value or raw_value.startswith(";") or raw_value.endswith(";"):
                errors.append(f"{species_label}: malformed semicolon list in '{column}'")
            values = split_values(raw_value)
            allowed = closed_values.get(column)
            if allowed is not None:
                for value in values:
                    if value not in allowed:
                        errors.append(
                            f"{species_label}: unknown value '{value}' in '{column}' "
                            f"(allowed: {', '.join(sorted(allowed))})"
                        )

    if errors:
        print_errors(errors)
        return 1

    attribute_values = sum(
        len(split_values(row[column]))
        for row in rows
        for column in ATTRIBUTE_COLUMNS
    )
    print(f"OK: {len(rows)} species, {len(config['categories'])} categories, {attribute_values} species-attribute values")
    return 0


def print_errors(errors: list[str]) -> None:
    print("Data validation failed:", file=sys.stderr)
    for error in errors:
        print(f"- {error}", file=sys.stderr)


if __name__ == "__main__":
    raise SystemExit(main())
