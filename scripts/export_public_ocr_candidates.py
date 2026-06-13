from __future__ import annotations

import argparse
import csv
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = REPO_ROOT / "private_input" / "review" / "hayashi_2019_ndlocr_lite_candidates.csv"
DEFAULT_OUTPUT = REPO_ROOT / "data" / "hayashi_2019_public_candidates.csv"

CONIFER_FAMILIES = {
    "マツ科",
    "ヒノキ科",
    "イチイ科",
    "コウヤマキ科",
    "ナンヨウスギ科",
    "マキ科",
    "スギ科",
    "イヌガヤ科",
}

FAMILY_CORRECTIONS = {
    "ウゼンカズラ科": "ノウゼンカズラ科",
    "カパノキ科": "カバノキ科",
    "キプシ科": "キブシ科",
    "グルセミウム科": "ゲルセミウム科",
    "サルトリイパラ科": "サルトリイバラ科",
    "ジンチョウグ科": "ジンチョウゲ科",
    "スプリ科": "スグリ科",
    "ツパキ科": "ツバキ科",
    "パラ科": "バラ科",
    "プドウ科": "ブドウ科",
    "プナ科": "ブナ科",
    "マツプサ科": "マツブサ科",
    "ミイカズラ科": "スイカズラ科",
    "ミツパウツギ科": "ミツバウツギ科",
    "ロウパイ科": "ロウバイ科",
}

BASIC_COLUMNS = [
    "id",
    "ja_name",
    "scientific_name",
    "family",
    "genus",
    "leaf_persistence",
    "leaf_type",
    "leaf_complexity",
    "leaf_arrangement",
    "leaf_margin",
    "serration",
    "source_note",
]

PUBLIC_EXTRA_COLUMNS = [
    "source_page",
    "review_status",
    "review_confidence",
    "needs_review_reason",
    "family_ja_ocr",
    "family_latin_ocr",
    "genus_ja_ocr",
    "genus_latin_ocr",
    "leaf_type_ocr",
    "leaf_complexity_ocr",
    "leaf_arrangement_ocr",
    "leaf_margin_ocr",
    "serration_ocr",
    "trait_label_texts_ocr",
    "trait_terms_detected_all_text",
]


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Export a public, review-friendly CSV from private NDLOCR-Lite candidates."
    )
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--include-low-confidence", action="store_true")
    args = parser.parse_args()

    rows = read_csv(args.input)
    public_rows = []
    for row in rows:
        if row.get("review_confidence") == "low" and not args.include_low_confidence:
            continue
        public_rows.append(to_public_row(row))

    write_csv(args.output, public_rows)
    print(f"Wrote {relative_to_repo(args.output)}")
    print(f"Rows: {len(public_rows)}")
    print(f"Missing family: {sum(1 for row in public_rows if not row['family'])}")
    print(f"Missing genus: {sum(1 for row in public_rows if not row['genus'])}")
    print("Scientific names are intentionally blank for a later authority-based fill step.")
    return 0


def to_public_row(row: dict[str, str]) -> dict[str, str]:
    page = clean_page(row)
    ja_name = clean_text(row.get("ja_name_ocr", ""))
    family_raw = clean_text(row.get("family_ocr", ""))
    family = FAMILY_CORRECTIONS.get(family_raw, family_raw)
    genus = clean_text(row.get("genus_latin_corrected_candidate", ""))
    source_note = f"林将之 (2019)『樹木の葉』 p.{page} OCR候補。公開前に要確認"
    review_reasons = public_review_reasons(row)
    if family_raw and family_raw != family:
        review_reasons = append_reason(review_reasons, "family_corrected_by_rule")

    public = {
        "id": make_id(row.get("scan_number", ""), row.get("side", "")),
        "ja_name": ja_name,
        "scientific_name": "",
        "family": family,
        "genus": genus,
        "leaf_persistence": normalize_leaf_persistence(row.get("leaf_persistence", "")),
        "leaf_type": normalize_leaf_type(family, row.get("leaf_type", ""), row.get("trait_terms_detected_all_text", "")),
        "leaf_complexity": normalize_leaf_complexity(row.get("leaf_complexity", ""), family),
        "leaf_arrangement": normalize_leaf_arrangement(row.get("leaf_arrangement", "")),
        "leaf_margin": normalize_leaf_margin(row.get("leaf_margin", ""), row.get("serration", "")),
        "serration": normalize_serration(row.get("serration", ""), row.get("leaf_margin", "")),
        "source_note": source_note,
        "source_page": page,
        "review_status": "needs_review",
        "review_confidence": clean_text(row.get("review_confidence", "")),
        "needs_review_reason": review_reasons,
        "family_ja_ocr": family_raw,
        "family_latin_ocr": clean_text(row.get("family_latin_ocr", "")),
        "genus_ja_ocr": clean_text(row.get("genus_ocr", "")),
        "genus_latin_ocr": clean_text(row.get("genus_latin_ocr", "")),
        "leaf_type_ocr": clean_text(row.get("leaf_type", "")),
        "leaf_complexity_ocr": clean_text(row.get("leaf_complexity", "")),
        "leaf_arrangement_ocr": clean_text(row.get("leaf_arrangement", "")),
        "leaf_margin_ocr": clean_text(row.get("leaf_margin", "")),
        "serration_ocr": clean_text(row.get("serration", "")),
        "trait_label_texts_ocr": clean_text(row.get("trait_label_texts_ocr", "")),
        "trait_terms_detected_all_text": clean_text(row.get("trait_terms_detected_all_text", "")),
    }
    return public


def normalize_leaf_persistence(value: str) -> str:
    values = split_values(value)
    output = []
    for candidate in ("常緑", "落葉"):
        if candidate in values and candidate not in output:
            output.append(candidate)
    return ";".join(output)


def normalize_leaf_type(family: str, leaf_type: str, all_terms: str) -> str:
    raw = f"{leaf_type};{all_terms}"
    if family in CONIFER_FAMILIES or any(term in raw for term in ["針状葉", "鱗状葉", "針葉"]):
        return "針葉樹"
    if family:
        return "広葉樹"
    return ""


def normalize_leaf_complexity(value: str, family: str) -> str:
    values = split_values(value)
    output = []
    if "掌状複葉" in values:
        output.append("掌状複葉")
    if "羽状複葉" in values:
        output.append("羽状複葉")
    if "三出複葉" in values and "羽状複葉" not in output:
        output.append("三出複葉")
    if any(term in values for term in ["不分裂葉", "分裂葉", "単葉"]):
        output.append("単葉")
    if not output and family:
        output.append("単葉")
    return ";".join(unique(output))


def normalize_leaf_arrangement(value: str) -> str:
    values = split_values(value)
    output = []
    if "互生" in values:
        output.append("互生")
    if "対生" in values:
        output.append("対生")
    if "輪生" in values:
        output.append("輪生")
    if "束生" in values or "束状" in values:
        output.append("束生")
    return ";".join(unique(output))


def normalize_leaf_margin(leaf_margin: str, serration: str) -> str:
    margin_values = split_values(leaf_margin)
    serration_values = split_values(serration)
    output = []
    if "全縁" in margin_values:
        output.append("全縁")
    if "波状" in margin_values:
        output.append("波状")
    if any(term in margin_values for term in ["掌状裂", "深裂", "浅裂", "切れ込み"]):
        output.append("掌状裂")
    if serration_values:
        output.append("鋸歯縁")
    return ";".join(unique(output))


def normalize_serration(serration: str, leaf_margin: str) -> str:
    values = split_values(serration)
    output = []
    for candidate in ("重鋸歯", "細鋸歯", "粗鋸歯"):
        if candidate in values:
            output.append(candidate)
    if not output and "鋸歯" in values:
        output.append("あり")
    if not output and "全縁" in split_values(leaf_margin):
        output.append("なし")
    return ";".join(unique(output))


def public_review_reasons(row: dict[str, str]) -> str:
    reasons = split_values(row.get("needs_review_reason", ""))
    if not row.get("scientific_name_expanded_candidate"):
        reasons.append("scientific_name_to_be_filled_later")
    else:
        reasons.append("scientific_name_excluded_from_public_candidate")
    if not row.get("family_ocr"):
        reasons.append("family_not_found")
    if not row.get("genus_latin_corrected_candidate"):
        reasons.append("genus_not_found")
    return ";".join(unique(reasons))


def append_reason(reasons: str, reason: str) -> str:
    return ";".join(unique([*split_values(reasons), reason]))


def make_id(scan_number: str, side: str) -> str:
    scan_part = scan_number.zfill(3) if scan_number.isdigit() else slugify_ascii(scan_number or "unknown")
    side_part = "l" if side == "left" else "r" if side == "right" else slugify_ascii(side or "x")
    return f"hayashi-2019-s{scan_part}-{side_part}"


def clean_page(row: dict[str, str]) -> str:
    return clean_text(row.get("printed_page_ocr") or row.get("printed_page_guess") or "")


def split_values(value: str) -> list[str]:
    return [part.strip() for part in clean_text(value).split(";") if part.strip()]


def clean_text(value: str) -> str:
    value = (value or "").strip()
    value = value.replace("\r", " ").replace("\n", " ")
    value = re.sub(r"\s+", " ", value)
    value = value.replace("全緑", "全縁")
    return value.strip()


def unique(values: list[str]) -> list[str]:
    output = []
    for value in values:
        if value and value not in output:
            output.append(value)
    return output


def slugify_ascii(value: str) -> str:
    value = value.lower()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-") or "x"


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        return [{key: (value or "").strip() for key, value in row.items()} for row in csv.DictReader(f)]


def write_csv(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        fieldnames = [*BASIC_COLUMNS, *PUBLIC_EXTRA_COLUMNS]
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def relative_to_repo(path: Path) -> Path:
    try:
        return path.resolve().relative_to(REPO_ROOT)
    except ValueError:
        return path


if __name__ == "__main__":
    raise SystemExit(main())
