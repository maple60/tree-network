from __future__ import annotations

from tree_data import (
    ATTRIBUTE_COLUMNS,
    SPECIES_CONTENT_DIR,
    SPECIES_DIR,
    SPECIES_TEMPLATE,
    categories_by_id,
    load_attribute_config,
    load_trees,
    split_values,
)


def main() -> int:
    rows_by_id = {row["id"]: row for row in load_trees()}
    categories = categories_by_id(load_attribute_config())
    template = SPECIES_TEMPLATE.read_text(encoding="utf-8")
    content_paths = sorted(SPECIES_CONTENT_DIR.glob("*.qmd"))

    if not content_paths:
        print("No species content files found.")
        return 0

    for content_path in content_paths:
        species_id = content_path.stem
        if species_id not in rows_by_id:
            raise ValueError(f"{content_path}: species id is not found in data/trees.csv")

        row = rows_by_id[species_id]
        output_path = SPECIES_DIR / species_id / "index.qmd"
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(render_species_page(template, content_path, row, categories), encoding="utf-8")
        print(f"Wrote {output_path.relative_to(SPECIES_DIR.parents[0])}")

    return 0


def render_species_page(
    template: str,
    content_path,
    row: dict[str, str],
    categories: dict[str, dict[str, object]],
) -> str:
    context = {
        "species_id": row["id"],
        "ja_name": row["ja_name"],
        "scientific_name": row["scientific_name"] or "学名未設定",
        "family": display_values(row, "family") or "未設定",
        "genus": display_values(row, "genus") or "未設定",
        "body": content_path.read_text(encoding="utf-8").strip(),
        "trait_rows": build_trait_rows(row, categories),
        "source_note_block": build_source_note_block(row),
    }

    page = template
    for key, value in context.items():
        page = page.replace("{{ " + key + " }}", value)
    return page.rstrip() + "\n"


def build_trait_rows(row: dict[str, str], categories: dict[str, dict[str, object]]) -> str:
    lines = []
    for category_id in ATTRIBUTE_COLUMNS:
        category = categories[category_id]
        label = str(category["label"])
        value = display_values(row, category_id) or "未設定"
        lines.append(f"| {escape_markdown_table(label)} | {escape_markdown_table(value)} |")
    return "\n".join(lines)


def build_source_note_block(row: dict[str, str]) -> str:
    source_note = row.get("source_note", "").strip()
    if not source_note:
        return ""
    return f"## データ注記\n\n{source_note}"


def display_values(row: dict[str, str], category_id: str) -> str:
    return "、".join(split_values(row.get(category_id, "")))


def escape_markdown_table(value: str) -> str:
    return value.replace("|", "\\|").replace("\n", " ")


if __name__ == "__main__":
    raise SystemExit(main())
