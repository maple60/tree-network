from __future__ import annotations

import argparse
import csv
import json
import re
from pathlib import Path
from statistics import mean

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_JSON_DIR = REPO_ROOT / "private_input" / "ocr" / "ndlocr_lite" / "json"
DEFAULT_OUTPUT = REPO_ROOT / "private_input" / "review" / "hayashi_2019_ndlocr_lite_candidates.csv"
DEFAULT_REVIEW_QUEUE = REPO_ROOT / "private_input" / "review" / "hayashi_2019_ndlocr_lite_review_queue.csv"

JAPANESE_RE = r"一-龯ぁ-んァ-ヶー々〆〤囗"

TEXT_REPLACEMENTS = {
    "針状票": "針状葉",
    "鱗状票": "鱗状葉",
    "膳状葉": "鱗状葉",
    "全線": "全縁",
    "ク囗ベ": "クロベ",
}

GENUS_CORRECTIONS = {
    "Ables": "Abies",
    "Piceacea": "Picea",
}

SECTION_HEADINGS = {
    "被子植物",
    "裸子植物",
    "ANGIOSPERMAE",
    "GYMNOSPERMAE",
}

TRAIT_GROUPS = {
    "leaf_persistence": ["常緑", "落葉", "半常緑"],
    "leaf_type": ["針状葉", "鱗状葉", "針葉", "広葉"],
    "leaf_complexity": ["羽状複葉", "掌状複葉", "三出複葉", "不分裂葉", "分裂葉", "単葉", "複葉"],
    "leaf_arrangement": ["互生", "対生", "輪生", "束生", "束状", "はね状"],
    "leaf_margin": ["全縁", "波状", "切れ込み", "浅裂", "深裂"],
    "serration": ["重鋸歯", "細鋸歯", "粗鋸歯", "鋸歯"],
}

VARIATION_TERMS = [
    "時に",
    "ときに",
    "まれに",
    "稀",
    "しばしば",
    "混じ",
    "若木",
    "成木",
    "変化",
    "個体差",
    "切れ込み",
    "分裂",
    "不分裂",
]


def main() -> int:
    parser = argparse.ArgumentParser(description="Build review CSV from NDLOCR-Lite JSON files.")
    parser.add_argument("--json-dir", type=Path, default=DEFAULT_JSON_DIR)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--review-queue", type=Path, default=DEFAULT_REVIEW_QUEUE)
    args = parser.parse_args()

    rows = build_candidates(args.json_dir)
    write_csv(args.output, rows)
    review_rows = [row for row in rows if row["ja_name_ocr"] and row["review_confidence"] in {"high", "medium"}]
    write_csv(args.review_queue, review_rows)

    print(f"Wrote {relative_to_repo(args.output)}")
    print(f"Wrote {relative_to_repo(args.review_queue)}")
    print(f"Rows: {len(rows)}")
    print(f"Review queue: {len(review_rows)}")
    print(f"Missing Japanese names: {sum(1 for row in rows if not row['ja_name_ocr'])}")
    print(f"Missing family names: {sum(1 for row in rows if not row['family_ocr'])}")
    print(f"Rows with coordinate label traits: {sum(1 for row in rows if row['trait_terms_detected'])}")
    return 0


def build_candidates(json_dir: Path) -> list[dict[str, str]]:
    json_paths = sorted(json_dir.glob("*.json"), key=natural_path_key)
    rows: list[dict[str, str]] = []
    for json_path in json_paths:
        scan_no = scan_number(json_path)
        obj = json.loads(json_path.read_text(encoding="utf-8"))
        width = int(obj.get("imginfo", {}).get("img_width", 0))
        half = width / 2
        all_lines = obj.get("contents", [[]])[0]
        for side, x0, x1 in (("left", 0.0, half), ("right", half, float(width))):
            lines = [line for line in all_lines if x0 <= line_center_x(line) < x1]
            rows.append(build_page_row(json_path, side, x0, x1, lines, scan_no))
    return rows


def build_page_row(
    json_path: Path,
    side: str,
    x0: float,
    x1: float,
    lines: list[dict],
    scan_no: int,
) -> dict[str, str]:
    page_ocr, page_guess = extract_page_number(lines, side, scan_no)
    header = parse_header(lines)
    ja_name, name_line = choose_species_name(lines, x0)
    scientific_ocr, scientific_expanded, scientific_line = choose_scientific_name(
        lines,
        name_line,
        header["genus_latin_corrected_candidate"],
    )

    sorted_lines = sorted(lines, key=lambda line: (line_y(line), line_center_x(line)))
    text_lines = [normalize_text(line.get("text", "")) for line in sorted_lines]
    all_text = "\n".join(text_lines)
    label_lines = [line for line in sorted_lines if is_trait_label_line(line, x0, x1)]
    label_texts = [normalize_text(line.get("text", "")) for line in label_lines]
    label_text = "\n".join(label_texts)

    trait_values = {}
    for key, terms in TRAIT_GROUPS.items():
        source_text = all_text if key == "leaf_persistence" else label_text
        trait_values[key] = unique_join(collect_terms(source_text, terms))

    all_text_terms = all_trait_terms(all_text)
    label_terms = all_trait_terms(label_text)
    variation_notes = [
        text[:90]
        for text in text_lines
        if any(term in text for term in VARIATION_TERMS)
        and any(term in text for term in ["葉", "裂", "分裂", "切れ込み", "針", "鱗"])
    ]

    confidence_values = [float(line.get("confidence", 0) or 0) for line in lines]
    mean_confidence = mean(confidence_values) if confidence_values else 0.0
    reasons = review_reasons(ja_name, header, mean_confidence)
    confidence = review_confidence(ja_name, header, reasons)

    evidence_parts = [header["header_text"]]
    if name_line:
        evidence_parts.append(normalize_text(name_line.get("text", "")))
    if scientific_line and scientific_line is not name_line:
        evidence_parts.append(normalize_text(scientific_line.get("text", "")))
    evidence_parts.extend(text_lines[:4])

    return {
        "review_status": "needs_review",
        "review_confidence": confidence,
        "scan_file": json_path.name.replace(".json", ".png"),
        "scan_number": str(scan_no),
        "side": side,
        "printed_page_ocr": page_ocr,
        "printed_page_guess": str(page_guess),
        "ocr_json_file": str(relative_to_repo(json_path)),
        "page_half_bbox": f"{int(x0)},0,{int(x1)},{max((bbox_tuple(line)[3] for line in lines), default=0)}",
        "header_text_ocr": header["header_text"],
        "header_bbox": bbox_string(header["line"]),
        "ja_name_ocr": ja_name,
        "ja_name_bbox": bbox_string(name_line),
        "scientific_name_ocr": scientific_ocr,
        "scientific_name_expanded_candidate": scientific_expanded,
        "scientific_name_bbox": bbox_string(scientific_line),
        "family_ocr": header["family_ocr"],
        "family_latin_ocr": header["family_latin_ocr"],
        "genus_ocr": header["genus_ocr"],
        "genus_latin_ocr": header["genus_latin_ocr"],
        "genus_latin_corrected_candidate": header["genus_latin_corrected_candidate"],
        **trait_values,
        "trait_terms_detected": unique_join(label_terms),
        "trait_terms_detected_all_text": unique_join(all_text_terms),
        "trait_label_texts_ocr": unique_join(label_texts),
        "variation_notes_ocr": unique_join(variation_notes[:4]),
        "mean_line_confidence": f"{mean_confidence:.3f}" if confidence_values else "",
        "line_count": str(len(lines)),
        "source_note": f"林将之 (2019)『樹木の葉』 p.{page_ocr or page_guess} NDLOCR-Lite candidate",
        "needs_review_reason": unique_join(reasons),
        "evidence_snippet": " / ".join(part for part in evidence_parts if part)[:260],
    }


def review_reasons(ja_name: str, header: dict[str, str | dict | None], mean_confidence: float) -> list[str]:
    reasons: list[str] = []
    if ja_name in SECTION_HEADINGS:
        reasons.append("section_heading")
    if not ja_name:
        reasons.append("species_name_not_found")
    if not header["family_ocr"]:
        reasons.append("family_not_found")
    if mean_confidence and mean_confidence < 0.70:
        reasons.append("low_mean_ocr_confidence")
    if header["genus_latin_ocr"] != header["genus_latin_corrected_candidate"]:
        reasons.append("genus_latin_corrected_by_rule")
    return reasons


def review_confidence(ja_name: str, header: dict[str, str | dict | None], reasons: list[str]) -> str:
    if "section_heading" in reasons:
        return "low"
    if not ja_name:
        return "low"
    if not header["family_ocr"]:
        return "medium"
    if any(reason.startswith("low") for reason in reasons):
        return "medium"
    return "high"


def parse_header(lines: list[dict]) -> dict[str, str | dict | None]:
    candidates = [
        line
        for line in lines
        if line_y(line) <= 36 and ("科" in line.get("text", "") or "属" in line.get("text", ""))
    ]
    if not candidates:
        return {
            "line": None,
            "header_text": "",
            "family_ocr": "",
            "family_latin_ocr": "",
            "genus_ocr": "",
            "genus_latin_ocr": "",
            "genus_latin_corrected_candidate": "",
        }

    line = max(candidates, key=lambda candidate: len(candidate.get("text", "")))
    text = clean_header_text(line.get("text", ""))
    family = ""
    family_latin = ""
    genus = ""
    genus_latin = ""

    family_match = re.search(rf"([{JAPANESE_RE}]+科)", text)
    if not family_match:
        for candidate in candidates:
            candidate_text = clean_header_text(candidate.get("text", ""))
            family_match = re.search(rf"([{JAPANESE_RE}]+科)", candidate_text)
            if family_match:
                break
    if family_match:
        family = family_match.group(1)
    family_latin_match = re.search(r"([A-Z][a-z]+aceae)", text)
    if family_latin_match:
        family_latin = family_latin_match.group(1)

    genus_match = re.search(rf"([{JAPANESE_RE}/]+属)", text)
    if genus_match:
        genus = genus_match.group(1)
        after_genus = text[genus_match.end() :]
        latin_words = re.findall(r"[A-Z][A-Za-z]+", after_genus)
        if latin_words:
            genus_latin = "/".join(latin_words[:2])
    if not genus_latin:
        latin_words = [word for word in re.findall(r"[A-Z][A-Za-z]+", text) if not word.endswith("aceae")]
        if latin_words:
            genus_latin = latin_words[-1]

    return {
        "line": line,
        "header_text": text,
        "family_ocr": family,
        "family_latin_ocr": family_latin,
        "genus_ocr": genus,
        "genus_latin_ocr": genus_latin,
        "genus_latin_corrected_candidate": GENUS_CORRECTIONS.get(genus_latin, genus_latin),
    }


def choose_species_name(lines: list[dict], x0: float) -> tuple[str, dict | None]:
    candidates = [line for line in lines if is_species_name_candidate(line)]
    if not candidates:
        return "", None

    target_x = x0 + 105

    def score(line: dict) -> float:
        text = normalize_text(line.get("text", ""))
        name = japanese_name_from_text(text)
        latin_bonus = -18 if re.search(r"(?<![A-Za-z])[A-Z]\. ?[a-z]|(?<![A-Za-z])[A-Z][a-z]+ [a-z]", text) else 0
        caption_penalty = 45 if "×" in text else 0
        sentence_penalty = 20 if len(name) >= 10 else 0
        return (
            line_y(line) * 1.5
            + abs(line_center_x(line) - target_x) / 4
            + len(name) * 0.2
            + latin_bonus
            + caption_penalty
            + sentence_penalty
        )

    line = min(candidates, key=score)
    return japanese_name_from_text(line.get("text", "")), line


def is_species_name_candidate(line: dict) -> bool:
    text = normalize_text(line.get("text", ""))
    if not (34 <= line_y(line) <= 72):
        return False
    if not re.search(rf"[{JAPANESE_RE}]", text):
        return False
    if "科" in text or "属" in text or text.startswith("〈"):
        return False
    if any(
        term in text
        for term in [
            "針状葉",
            "鱗状葉",
            "羽状複葉",
            "不分裂葉",
            "分裂葉",
            "互生",
            "束状",
            "はね状",
            "全縁",
            "鋸歯",
        ]
    ):
        return False
    name = japanese_name_from_text(text)
    if not name or len(name) > 14:
        return False
    if any(char in text for char in "。、，"):
        return False
    return True


def japanese_name_from_text(text: str) -> str:
    text = normalize_text(text)
    text = re.split(r"[A-Z][a-z]?\.|[A-Z][a-z]+\s+[a-z]", text)[0]
    text = re.split(r"[A-Z],\s*[a-z]", text)[0]
    text = text.split("×", 1)[0]
    text = re.sub(r"[〈〉《》「」\[\]（）()0-9.,:;／/ '’\-]+", "", text)
    match = re.search(rf"[{JAPANESE_RE}]+", text)
    return match.group(0).strip() if match else ""


def choose_scientific_name(
    lines: list[dict],
    name_line: dict | None,
    genus_latin: str,
) -> tuple[str, str, dict | None]:
    candidates: list[tuple[dict, str]] = []
    for line in lines:
        if not (34 <= line_y(line) <= 84):
            continue
        text = normalize_text(line.get("text", ""))
        if "科" in text or "属" in text:
            continue
        for latin in scientific_name_candidates(text):
            candidates.append((line, latin))
    if not candidates:
        return "", "", None

    name_x = line_center_x(name_line) if name_line else 0
    name_y = line_y(name_line) if name_line else 45

    def score(item: tuple[dict, str]) -> float:
        line, _ = item
        return abs(line_y(line) - name_y) * 2 + abs(line_center_x(line) - name_x) / 3

    line, scientific = min(candidates, key=score)
    expanded = expand_abbreviated_scientific_name(scientific, genus_latin)
    return scientific, expanded, line


def scientific_name_candidates(text: str) -> list[str]:
    text = normalize_text(text)
    text = re.sub(r"[A-Z][a-z]+aceae", " ", text)
    patterns = [
        r"(?<![A-Za-z])[A-Z]\.\s*[a-z][a-z\-]+(?:\s+[A-Za-z][A-Za-z'\-]+)*",
        r"(?<![A-Za-z])[A-Z][a-z]+\s+[a-z][a-z\-]+(?:\s+[A-Za-z][A-Za-z'\-]+)*",
    ]
    found: list[str] = []
    for pattern in patterns:
        found.extend(match.group(0).strip() for match in re.finditer(pattern, text))
    return found


def expand_abbreviated_scientific_name(scientific: str, genus_latin: str) -> str:
    scientific = normalize_text(scientific)
    match = re.match(r"^([A-Z])\.\s*(.+)$", scientific)
    if match and genus_latin and genus_latin[0].upper() == match.group(1):
        return genus_latin.split("/")[0] + " " + match.group(2)
    return scientific


def is_trait_label_line(line: dict, x0: float, x1: float) -> bool:
    text = normalize_text(line.get("text", ""))
    if not text or len(text) > 24:
        return False
    if not all_trait_terms(text):
        return False
    cx = line_center_x(line)
    return cx <= x0 + 70 or cx >= x1 - 70


def extract_page_number(lines: list[dict], side: str, scan_no: int) -> tuple[str, int]:
    digits: list[str] = []
    for line in lines:
        if line_y(line) > 26:
            continue
        text = normalize_text(line.get("text", ""))
        for match in re.finditer(r"(?<!\d)(\d{1,3})(?!\d)", text):
            value = int(match.group(1))
            if 1 <= value <= 999:
                digits.append(str(value))
    page_ocr = unique_join(digits).replace(";", "|")
    page_guess = scan_no * 2 - 2 if side == "left" else scan_no * 2 - 1
    return page_ocr, page_guess


def collect_terms(text: str, terms: list[str]) -> list[str]:
    return [term for term in terms if term in text]


def all_trait_terms(text: str) -> list[str]:
    terms: list[str] = []
    for group_terms in TRAIT_GROUPS.values():
        terms.extend(collect_terms(text, group_terms))
    return terms


def normalize_text(text: str) -> str:
    text = (text or "").strip()
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"([A-Z])\.(?=[a-z])", r"\1. ", text)
    for old, new in TEXT_REPLACEMENTS.items():
        text = text.replace(old, new)
    return text.strip()


def clean_header_text(text: str) -> str:
    text = normalize_text(text)
    text = re.sub(r"^\d{1,3}", "", text)
    text = re.sub(r"\d{1,3}$", "", text)
    return text.strip()


def bbox_tuple(line: dict) -> tuple[int, int, int, int]:
    points = line.get("boundingBox") or []
    xs = [int(point[0]) for point in points]
    ys = [int(point[1]) for point in points]
    return min(xs), min(ys), max(xs), max(ys)


def bbox_string(line: dict | None) -> str:
    if not line:
        return ""
    return ",".join(str(value) for value in bbox_tuple(line))


def line_center_x(line: dict) -> float:
    x0, _, x1, _ = bbox_tuple(line)
    return (x0 + x1) / 2


def line_y(line: dict) -> int:
    return bbox_tuple(line)[1]


def unique_join(items: list[str]) -> str:
    output: list[str] = []
    for item in items:
        if item and item not in output:
            output.append(item)
    return ";".join(output)


def write_csv(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not rows:
        path.write_text("", encoding="utf-8-sig")
        return
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def natural_path_key(path: Path) -> tuple[int, str]:
    return scan_number(path), path.name


def scan_number(path: Path) -> int:
    match = re.search(r"_(\d+)$", path.stem)
    return int(match.group(1)) if match else 0


def relative_to_repo(path: Path) -> Path:
    try:
        return path.resolve().relative_to(REPO_ROOT)
    except ValueError:
        return path


if __name__ == "__main__":
    raise SystemExit(main())
