from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

from tree_data import REPO_ROOT, TREE_CSV
from update_species_ids import assign_species_ids, print_errors, read_csv, write_csv

DEFAULT_INSTRUCTIONS = REPO_ROOT / "data" / "scientific_name_unresolved.csv"
RANK_TOKENS = {"subsp", "ssp", "var", "f", "forma"}
EPITHET_RE = re.compile(r"^[a-z][a-z0-9-]*$")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Apply review instructions for unresolved scientific names."
    )
    parser.add_argument("--input", type=Path, default=TREE_CSV)
    parser.add_argument("--instructions", type=Path, default=DEFAULT_INSTRUCTIONS)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    rows, fieldnames = read_csv(args.input)
    instruction_rows, _ = read_csv(args.instructions)
    instructions = {row.get("id", ""): row for row in instruction_rows if row.get("id")}

    errors: list[str] = []
    output_rows: list[dict[str, str]] = []
    deleted = 0
    updated = 0

    for row in rows:
        instruction_row = instructions.get(row.get("id", ""))
        if instruction_row is None:
            output_rows.append(row)
            continue

        instruction = instruction_row.get("instruction", "").strip()
        if not instruction:
            errors.append(f"{row.get('id', '')}: missing instruction")
            output_rows.append(row)
            continue

        if instruction.lower() == "delete":
            deleted += 1
            continue

        scientific_name = extract_scientific_name(instruction)
        canonical_name = canonical_scientific_name(scientific_name)
        if not canonical_name:
            errors.append(f"{row.get('id', '')}: could not extract scientific name from instruction")
            output_rows.append(row)
            continue

        updated_row = dict(row)
        ja_name = extract_ja_name(instruction)
        if ja_name:
            updated_row["ja_name"] = ja_name
        updated_row["scientific_name"] = canonical_name
        output_rows.append(updated_row)
        updated += 1

    unused = sorted(set(instructions) - {row.get("id", "") for row in rows})
    for species_id in unused:
        errors.append(f"instruction id not found in trees.csv: {species_id}")

    if not errors:
        errors = assign_species_ids(output_rows)

    if errors:
        print_errors(errors)
        return 1

    output_path = args.output or args.input
    write_csv(output_path, output_rows, fieldnames)
    print(f"Wrote {output_path.relative_to(REPO_ROOT)}")
    print(f"Rows deleted: {deleted}")
    print(f"Rows updated from instructions: {updated}")
    print(f"Rows remaining: {len(output_rows)}")
    return 0


def extract_ja_name(instruction: str) -> str:
    match = re.search(r"和名(?:は|[:：])?([^、，,]+)", instruction)
    if not match:
        return ""
    return match.group(1).strip()


def extract_scientific_name(instruction: str) -> str:
    if "学名" in instruction:
        _, value = re.split(r"学名(?:は|[:：])?", instruction, maxsplit=1)
        return value.strip(" 、，,")
    if "を採用" in instruction:
        return instruction.split("を採用", 1)[0].strip()
    return instruction.strip()


def canonical_scientific_name(scientific_name: str) -> str:
    value = scientific_name.replace("\u00d7", " x ")
    value = re.sub(r"[(),]", " ", value)
    tokens = [token.strip().strip(".") for token in value.split()]
    tokens = [token for token in tokens if token]
    if len(tokens) < 2:
        return ""

    canonical = [tokens[0], tokens[1]]
    index = 2
    while index < len(tokens):
        rank = tokens[index].lower()
        if rank in RANK_TOKENS:
            normalized_rank = "subsp" if rank == "ssp" else "f" if rank == "forma" else rank
            epithet = find_next_epithet(tokens, index + 1)
            if epithet:
                canonical.extend([normalized_rank, epithet])
                index += 2
                continue
        index += 1

    return " ".join(canonical)


def find_next_epithet(tokens: list[str], start: int) -> str:
    for token in tokens[start:]:
        cleaned = token.strip().strip(".")
        if EPITHET_RE.match(cleaned):
            return cleaned
    return ""


if __name__ == "__main__":
    raise SystemExit(main())
