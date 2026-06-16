from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timezone

from tree_data import (
    ATTRIBUTE_COLUMNS,
    GRAPH_JSON,
    SPECIES_CONTENT_DIR,
    categories_by_id,
    load_attribute_config,
    load_trees,
    split_values,
)


def main() -> int:
    config = load_attribute_config()
    categories = categories_by_id(config)
    rows = load_trees()

    node_species: dict[str, set[str]] = defaultdict(set)
    node_records: dict[str, dict[str, object]] = {}
    species_records: list[dict[str, object]] = []

    for row in rows:
        attributes: dict[str, list[str]] = {}
        attribute_node_ids: list[str] = []

        for category_id in ATTRIBUTE_COLUMNS:
            category = categories[category_id]
            values = split_values(row.get(category_id, ""))
            attributes[category_id] = values
            for value in values:
                node_id = make_node_id(category_id, value)
                attribute_node_ids.append(node_id)
                node_species[node_id].add(row["id"])
                node_records.setdefault(
                    node_id,
                    {
                        "id": node_id,
                        "label": value,
                        "category": category_id,
                        "categoryLabel": category["label"],
                        "color": category["color"],
                        "speciesIds": [],
                        "speciesCount": 0,
                    },
                )

        species_record = {
            "id": row["id"],
            "jaName": row["ja_name"],
            "scientificName": row["scientific_name"],
            "sourceNote": row.get("source_note", ""),
            "attributes": attributes,
            "attributeNodeIds": attribute_node_ids,
        }
        page_url = species_page_url(row["id"])
        if page_url:
            species_record["pageUrl"] = page_url
        species_records.append(species_record)

    for node_id, species_ids in node_species.items():
        record = node_records[node_id]
        record["speciesIds"] = sorted(species_ids)
        record["speciesCount"] = len(species_ids)

    category_payload = []
    for index, category_id in enumerate(ATTRIBUTE_COLUMNS):
        category = categories[category_id]
        category_payload.append(
            {
                "id": category_id,
                "label": category["label"],
                "color": category["color"],
                "allowFree": bool(category["allow_free"]),
                "defaultVisible": bool(category["default_visible"]),
                "order": index,
                "values": category.get("values", []),
            }
        )

    payload = {
        "metadata": {
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "speciesCount": len(species_records),
            "categoryCount": len(category_payload),
            "attributeNodeCount": len(node_records),
        },
        "categories": category_payload,
        "nodes": sorted(node_records.values(), key=lambda item: (item["category"], item["label"])),
        "species": species_records,
    }

    GRAPH_JSON.parent.mkdir(parents=True, exist_ok=True)
    GRAPH_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        "Wrote "
        f"{GRAPH_JSON.relative_to(GRAPH_JSON.parents[1])}: "
        f"{len(species_records)} species, {len(node_records)} attribute nodes"
    )
    return 0


def make_node_id(category_id: str, value: str) -> str:
    return f"{category_id}::{value}"


def species_page_url(species_id: str) -> str:
    if (SPECIES_CONTENT_DIR / f"{species_id}.qmd").exists():
        return f"species/{species_id}/"
    return ""


if __name__ == "__main__":
    raise SystemExit(main())
