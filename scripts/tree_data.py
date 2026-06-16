from __future__ import annotations

import csv
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
TREE_CSV = REPO_ROOT / "data" / "trees.csv"
ATTRIBUTE_YML = REPO_ROOT / "data" / "attributes.yml"
GRAPH_JSON = REPO_ROOT / "site-data" / "tree-network.json"
SPECIES_CONTENT_DIR = REPO_ROOT / "species-content"
SPECIES_DIR = REPO_ROOT / "species"
SPECIES_TEMPLATE = REPO_ROOT / "templates" / "species.qmd"

CORE_COLUMNS = ["id", "ja_name", "scientific_name", "source_note"]
ATTRIBUTE_COLUMNS = [
    "family",
    "genus",
    "leaf_persistence",
    "leaf_type",
    "leaf_complexity",
    "leaf_arrangement",
    "leaf_margin",
    "serration",
]
TREE_COLUMNS = [
    "id",
    "ja_name",
    "scientific_name",
    *ATTRIBUTE_COLUMNS,
    "source_note",
]


def parse_scalar(value: str) -> Any:
    value = value.strip()
    if not value:
        return ""
    if value in {"true", "True"}:
        return True
    if value in {"false", "False"}:
        return False
    if (value.startswith('"') and value.endswith('"')) or (
        value.startswith("'") and value.endswith("'")
    ):
        return value[1:-1]
    return value


def load_attribute_config(path: Path = ATTRIBUTE_YML) -> dict[str, Any]:
    """Read the limited YAML subset used by data/attributes.yml.

    This intentionally avoids external dependencies so the site can build in a
    minimal GitHub Actions Python environment. Supported shape:

    categories:
      category_id:
        key: value
        values:
          - value
    """

    categories: dict[str, dict[str, Any]] = {}
    current_category: dict[str, Any] | None = None
    current_list_key: str | None = None

    for line_number, raw_line in enumerate(path.read_text(encoding="utf-8-sig").splitlines(), 1):
        if not raw_line.strip() or raw_line.lstrip().startswith("#"):
            continue

        indent = len(raw_line) - len(raw_line.lstrip(" "))
        text = raw_line.strip()

        if indent == 0:
            if text != "categories:":
                raise ValueError(f"{path}:{line_number}: expected 'categories:'")
            continue

        if indent == 2 and text.endswith(":"):
            category_id = text[:-1].strip()
            if not category_id:
                raise ValueError(f"{path}:{line_number}: empty category id")
            if category_id in categories:
                raise ValueError(f"{path}:{line_number}: duplicate category '{category_id}'")
            current_category = {"id": category_id}
            categories[category_id] = current_category
            current_list_key = None
            continue

        if current_category is None:
            raise ValueError(f"{path}:{line_number}: category property before category id")

        if indent == 4:
            if ":" not in text:
                raise ValueError(f"{path}:{line_number}: expected key/value property")
            key, raw_value = text.split(":", 1)
            key = key.strip()
            raw_value = raw_value.strip()
            if not raw_value:
                current_category[key] = []
                current_list_key = key
            else:
                current_category[key] = parse_scalar(raw_value)
                current_list_key = None
            continue

        if indent == 6 and text.startswith("- "):
            if current_list_key is None:
                raise ValueError(f"{path}:{line_number}: list item without list property")
            current_category[current_list_key].append(parse_scalar(text[2:]))
            continue

        raise ValueError(f"{path}:{line_number}: unsupported YAML indentation or syntax")

    return {"categories": list(categories.values())}


def split_values(raw_value: str) -> list[str]:
    if raw_value is None or raw_value.strip() == "":
        return []
    values = [part.strip() for part in raw_value.split(";")]
    return [value for value in values if value]


def load_trees(path: Path = TREE_CSV) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        rows = []
        for row in reader:
            rows.append({key: (value or "").strip() for key, value in row.items()})
    return rows


def categories_by_id(config: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {category["id"]: category for category in config["categories"]}
