from __future__ import annotations

import csv
import re
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OCR_DIR = REPO_ROOT / "private_input" / "ocr" / "hayashi_2019"
DEFAULT_OUTPUT = REPO_ROOT / "private_input" / "review" / "hayashi_2019_candidates.csv"
DEFAULT_REVIEW_QUEUE = REPO_ROOT / "private_input" / "review" / "hayashi_2019_review_queue.csv"

JAPANESE_RE = r"一-龯ぁ-んァ-ヶー々〆〤"
STOP_NAME_SUFFIXES = (
    "科",
    "属",
    "葉",
    "小葉",
    "托葉",
    "枝",
    "幹",
    "樹皮",
    "花",
    "実",
    "果実",
    "裏",
    "表",
    "葉裏",
    "葉表",
)
STOP_NAME_PARTS = (
    "見分け方",
    "別名",
    "品種",
    "変種",
    "原産",
    "植栽",
    "葉身",
    "葉柄",
    "冬芽",
    "樹形",
)
TRAIT_TERMS = [
    "常緑",
    "落葉",
    "半常緑",
    "針葉",
    "広葉",
    "単葉",
    "複葉",
    "羽状複葉",
    "掌状複葉",
    "互生",
    "対生",
    "輪生",
    "束生",
    "全縁",
    "鋸歯",
    "細鋸歯",
    "重鋸歯",
    "粗鋸歯",
    "波状",
    "切れ込み",
    "裂",
]
CONIFER_FAMILIES = {
    "マツ科",
    "ヒノキ科",
    "イチイ科",
    "コウヤマキ科",
    "ナンヨウスギ科",
    "マキ科",
    "スギ科",
}


@dataclass
class SpeciesHit:
    ja_name: str
    scientific_name: str
    start: int
    end: int
    reason: str


def main() -> int:
    candidates = build_candidates(DEFAULT_OCR_DIR)
    write_csv(DEFAULT_OUTPUT, candidates)
    review_queue = [row for row in candidates if row["ja_name_ocr"] and row["confidence"] in {"high", "medium"}]
    write_csv(DEFAULT_REVIEW_QUEUE, review_queue)

    print(f"Wrote {DEFAULT_OUTPUT.relative_to(REPO_ROOT)}")
    print(f"Wrote {DEFAULT_REVIEW_QUEUE.relative_to(REPO_ROOT)}")
    print(f"Candidates: {len(candidates)}")
    print(f"Review queue: {len(review_queue)}")
    status_counts: dict[str, int] = {}
    for row in candidates:
        status_counts[row["confidence"]] = status_counts.get(row["confidence"], 0) + 1
    for key in sorted(status_counts):
        print(f"{key}: {status_counts[key]}")
    return 0


def build_candidates(ocr_dir: Path) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    files = sorted(ocr_dir.glob("*.txt"), key=natural_text_key)
    for text_file in files:
        meta = parse_text_filename(text_file)
        if meta is None:
            continue
        raw_text = text_file.read_text(encoding="utf-8-sig")
        compact = normalize_ocr_text(raw_text)
        page_info = page_from_scan(meta["scan_number"], meta["side"])
        header = extract_header(compact)
        hits = extract_species_hits(compact, header)
        if not hits:
            continue

        hits = dedupe_hits(hits)
        for index, hit in enumerate(hits, 1):
            next_start = hits[index].start if index < len(hits) else len(compact)
            segment = compact[hit.start : max(hit.end, next_start)]
            if len(segment) < 80:
                segment = compact[max(0, hit.start - 80) : min(len(compact), hit.end + 260)]
            traits = infer_traits(segment, header)
            confidence = infer_confidence(hit, header, traits)
            rows.append(
                {
                    "review_status": "needs_review",
                    "confidence": confidence,
                    "scan_file": meta["scan_file"],
                    "scan_number": str(meta["scan_number"]),
                    "side": meta["side"],
                    "printed_page_guess": str(page_info["printed_page_guess"]),
                    "ocr_text_file": str(text_file.relative_to(REPO_ROOT)),
                    "candidate_index": str(index),
                    "ja_name_ocr": hit.ja_name,
                    "scientific_name_ocr": hit.scientific_name,
                    "family_ocr": header.get("family_ocr", ""),
                    "family_latin_ocr": header.get("family_latin_ocr", ""),
                    "genus_ocr": header.get("genus_ocr", ""),
                    "genus_latin_ocr": header.get("genus_latin_ocr", ""),
                    "leaf_persistence": traits["leaf_persistence"],
                    "leaf_type": traits["leaf_type"],
                    "leaf_complexity": traits["leaf_complexity"],
                    "leaf_arrangement": traits["leaf_arrangement"],
                    "leaf_margin": traits["leaf_margin"],
                    "serration": traits["serration"],
                    "variation_notes": traits["variation_notes"],
                    "trait_terms_detected": traits["trait_terms_detected"],
                    "source_note": f"林 2019, p.{page_info['printed_page_guess']} OCR候補（要確認）",
                    "extraction_reason": hit.reason,
                    "needs_review_reason": needs_review_reason(hit, header, traits),
                    "evidence_snippet": snippet_around(compact, hit.start, hit.end),
                }
            )
    return rows


def write_csv(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames())
        writer.writeheader()
        writer.writerows(rows)


def fieldnames() -> list[str]:
    return [
        "review_status",
        "confidence",
        "scan_file",
        "scan_number",
        "side",
        "printed_page_guess",
        "ocr_text_file",
        "candidate_index",
        "ja_name_ocr",
        "scientific_name_ocr",
        "family_ocr",
        "family_latin_ocr",
        "genus_ocr",
        "genus_latin_ocr",
        "leaf_persistence",
        "leaf_type",
        "leaf_complexity",
        "leaf_arrangement",
        "leaf_margin",
        "serration",
        "variation_notes",
        "trait_terms_detected",
        "source_note",
        "extraction_reason",
        "needs_review_reason",
        "evidence_snippet",
    ]


def parse_text_filename(path: Path) -> dict[str, object] | None:
    match = re.match(r"^(?P<stem>.+?)_(?P<number>\d+)_(?P<side>left|right)\.txt$", path.name)
    if not match:
        return None
    number = int(match.group("number"))
    return {
        "scan_file": f"{match.group('stem')}_{number}.png",
        "scan_number": number,
        "side": match.group("side"),
    }


def page_from_scan(scan_number: int, side: str) -> dict[str, int]:
    # In the supplied sample, scan 23 contains printed pages 44 and 45.
    left_page = scan_number * 2 - 2
    return {"printed_page_guess": left_page if side == "left" else left_page + 1}


def normalize_ocr_text(text: str) -> str:
    text = text.replace("﹣", "-").replace("—", "-").replace("ー", "ー")
    text = re.sub(r"\s+", "", text)
    return text


def extract_header(text: str) -> dict[str, str]:
    header = {
        "family_ocr": "",
        "family_latin_ocr": "",
        "genus_ocr": "",
        "genus_latin_ocr": "",
        "genus_latin_end": "0",
    }
    match = re.search(
        rf"(?P<family>[{JAPANESE_RE}]{{1,18}}科)(?P<family_latin>[A-Z][A-Za-z]{{3,}}aceae)"
        rf"(?P<genus>[{JAPANESE_RE}]{{1,18}}属)(?P<genus_latin>[A-Z][A-Za-z]{{2,}})",
        text,
    )
    if match:
        header.update(
            {
                "family_ocr": clean_name(match.group("family")),
                "family_latin_ocr": match.group("family_latin"),
                "genus_ocr": clean_name(match.group("genus")),
                "genus_latin_ocr": match.group("genus_latin"),
                "genus_latin_end": str(match.end("genus_latin")),
            }
        )
    else:
        family = re.search(rf"(?P<family>[{JAPANESE_RE}]{{1,18}}科)", text)
        if family:
            header["family_ocr"] = clean_name(family.group("family"))
        genus = re.search(rf"(?P<genus>[{JAPANESE_RE}]{{1,18}}属)", text)
        if genus:
            header["genus_ocr"] = clean_name(genus.group("genus"))
    return header


def extract_species_hits(text: str, header: dict[str, str]) -> list[SpeciesHit]:
    hits: list[SpeciesHit] = []
    genus_end = int(header.get("genus_latin_end") or 0)
    if genus_end:
        sci = find_scientific_after(text, genus_end)
        if sci:
            raw_name = text[genus_end : sci.start()]
            name = trim_species_name(raw_name)
            scientific = normalize_scientific_name(sci.group(0))
            if is_plausible_species_name(name, header) and is_plausible_scientific_name(scientific, header):
                hits.append(SpeciesHit(name, scientific, genus_end, sci.end(), "after_family_genus_header"))

    sci_pattern = re.compile(r"(?:[A-Z]\.[a-z][a-z.-]{2,}|[A-Z][a-z]{2,}\.[a-z][a-z.-]{2,}|[A-Z][a-z]{2,}\s?[a-z][a-z-]{2,})")
    for sci in sci_pattern.finditer(text):
        if genus_end and sci.start() <= genus_end:
            continue
        name = previous_japanese_name(text, sci.start())
        scientific = normalize_scientific_name(sci.group(0))
        if is_plausible_species_name(name, header) and is_plausible_scientific_name(scientific, header):
            hits.append(SpeciesHit(name, scientific, max(0, sci.start() - len(name)), sci.end(), "before_scientific_name"))

    return hits


def find_scientific_after(text: str, start: int) -> re.Match[str] | None:
    window = text[start : start + 90]
    match = re.search(r"(?:[A-Z]\.[a-z][a-z.-]{2,}|[A-Z][a-z]{2,}\.[a-z][a-z.-]{2,}|[A-Z][a-z]{2,}\s?[a-z][a-z-]{2,})", window)
    if match:
        return re.search(re.escape(match.group(0)), text[start : start + 90]) and OffsetMatch(match, start)  # type: ignore[return-value]
    return None


class OffsetMatch:
    def __init__(self, match: re.Match[str], offset: int):
        self.match = match
        self.offset = offset

    def group(self, *args):  # noqa: ANN001
        return self.match.group(*args)

    def start(self, *args):  # noqa: ANN001
        return self.offset + self.match.start(*args)

    def end(self, *args):  # noqa: ANN001
        return self.offset + self.match.end(*args)


def previous_japanese_name(text: str, position: int) -> str:
    prefix = text[max(0, position - 40) : position]
    prefix = re.split(r"[。、【】（）()<>〈〉◆:：/0-9A-Za-z]+", prefix)[-1]
    return trim_species_name(prefix)


def trim_species_name(value: str) -> str:
    value = clean_name(value)
    value = re.sub(r"^[ノのと・,、がはにをもで]+", "", value)
    value = re.sub(r"[ノのと・,、がはにをもで]+$", "", value)
    katakana_runs = re.findall(r"[ァ-ヶー・]{2,18}", value)
    if katakana_runs:
        value = katakana_runs[-1]
    if len(value) > 16:
        value = value[-16:]
    return value


def clean_name(value: str) -> str:
    return re.sub(rf"[^{JAPANESE_RE}・]", "", value or "").strip("・")


def is_plausible_species_name(value: str, header: dict[str, str] | None = None) -> bool:
    if not (2 <= len(value) <= 16):
        return False
    if any(part in value for part in STOP_NAME_PARTS):
        return False
    if any(value.endswith(suffix) for suffix in STOP_NAME_SUFFIXES):
        return False
    if value in {"高木", "低木", "小高木", "落葉樹", "常緑樹", "自生", "普通", "葉身", "葉柄", "植栽", "原産", "品種", "マツ", "マッ"}:
        return False
    if header:
        family_base = (header.get("family_ocr") or "").removesuffix("科")
        genus_base = (header.get("genus_ocr") or "").removesuffix("属")
        if value and value in {family_base, genus_base}:
            return False
    return True


def is_plausible_scientific_name(value: str, header: dict[str, str] | None = None) -> bool:
    if not value:
        return False
    if value.endswith("aceae"):
        return False
    if header and value in {header.get("family_latin_ocr", ""), header.get("genus_latin_ocr", "")}:
        return False
    return True


def normalize_scientific_name(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace("。", ".")).strip()


def dedupe_hits(hits: list[SpeciesHit]) -> list[SpeciesHit]:
    deduped: list[SpeciesHit] = []
    seen: set[tuple[str, str]] = set()
    for hit in sorted(hits, key=lambda item: item.start):
        key = (hit.ja_name, hit.scientific_name)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(hit)
    return deduped


def infer_traits(segment: str, header: dict[str, str]) -> dict[str, str]:
    terms = detected_terms(segment)
    leaf_persistence = values_from_terms(terms, ["常緑", "落葉", "半常緑"])
    leaf_type_values = []
    if "針葉" in terms:
        leaf_type_values.append("針葉樹")
    if "広葉" in terms:
        leaf_type_values.append("広葉樹")
    if not leaf_type_values and header.get("family_ocr") in CONIFER_FAMILIES:
        leaf_type_values.append("針葉樹")

    complexity_priority = ["羽状複葉", "掌状複葉", "複葉", "単葉"]
    leaf_complexity = values_from_terms(terms, complexity_priority)
    arrangement_values = []
    for term, value in [("互生", "互生"), ("対生", "対生"), ("輪生", "輪生"), ("束生", "束生"), ("東生", "束生")]:
        if term in segment and value not in arrangement_values:
            arrangement_values.append(value)

    margin_values = []
    has_serration = has_any(segment, ["鋸歯", "細鋸歯", "重鋸歯", "粗鋸歯", "鉱歯", "鋸主", "歯状"])
    if "全縁" in segment:
        margin_values.append("全縁")
    if has_serration:
        margin_values.append("鋸歯縁")
    if "波状" in segment:
        margin_values.append("波状")
    if has_any(segment, ["掌状裂", "深裂", "浅裂", "切れ込み", "分裂"]):
        margin_values.append("掌状裂")

    serration_values = []
    for term, value in [("細鋸歯", "細鋸歯"), ("重鋸歯", "重鋸歯"), ("粗鋸歯", "粗鋸歯")]:
        if term in segment:
            serration_values.append(value)
    if has_serration and not serration_values:
        serration_values.append("あり")
    if "全縁" in segment and not has_serration:
        serration_values.append("なし")

    variation_notes = []
    if len(set(margin_values)) > 1:
        variation_notes.append("葉縁候補が複数検出")
    if has_any(segment, ["時に", "ことがある", "個体", "変化", "若", "老木", "徒長枝", "切れ込みがない", "切れ込みが入る"]):
        variation_notes.append("条件差・変異を示す語を検出")

    return {
        "leaf_persistence": join_unique(leaf_persistence),
        "leaf_type": join_unique(leaf_type_values),
        "leaf_complexity": join_unique(leaf_complexity),
        "leaf_arrangement": join_unique(arrangement_values),
        "leaf_margin": join_unique(margin_values),
        "serration": join_unique(serration_values),
        "variation_notes": join_unique(variation_notes),
        "trait_terms_detected": join_unique(terms),
    }


def detected_terms(text: str) -> list[str]:
    terms = [term for term in TRAIT_TERMS if term in text]
    if "東生" in text:
        terms.append("東生(OCR束生候補)")
    if has_any(text, ["鉱歯", "鋸主", "歯状"]):
        terms.append("鋸歯(OCR候補)")
    return sorted(set(terms))


def values_from_terms(terms: list[str], ordered_values: list[str]) -> list[str]:
    return [value for value in ordered_values if value in terms]


def has_any(text: str, needles: list[str]) -> bool:
    return any(needle in text for needle in needles)


def join_unique(values: list[str]) -> str:
    deduped: list[str] = []
    for value in values:
        if value and value not in deduped:
            deduped.append(value)
    return ";".join(deduped)


def infer_confidence(hit: SpeciesHit, header: dict[str, str], traits: dict[str, str]) -> str:
    score = 0
    if hit.ja_name:
        score += 2
    if hit.scientific_name:
        score += 2
    if header.get("family_ocr"):
        score += 1
    if header.get("genus_ocr"):
        score += 1
    trait_fields = ["leaf_persistence", "leaf_type", "leaf_complexity", "leaf_arrangement", "leaf_margin", "serration"]
    score += sum(1 for field in trait_fields if traits.get(field))
    if score >= 8:
        return "high"
    if score >= 5:
        return "medium"
    return "low"


def needs_review_reason(hit: SpeciesHit, header: dict[str, str], traits: dict[str, str]) -> str:
    reasons = []
    if not hit.ja_name:
        reasons.append("樹種名未検出")
    if not hit.scientific_name:
        reasons.append("学名未検出")
    if not header.get("family_ocr"):
        reasons.append("科名未検出")
    if not any(traits.get(field) for field in ["leaf_arrangement", "leaf_margin", "serration", "leaf_complexity"]):
        reasons.append("葉形質が少ない")
    if traits.get("variation_notes"):
        reasons.append("変異表現あり")
    if not reasons:
        reasons.append("OCR候補のため要目視確認")
    return ";".join(reasons)


def snippet_around(text: str, start: int, end: int, radius: int = 90) -> str:
    snippet = text[max(0, start - radius) : min(len(text), end + radius)]
    return snippet[:260]


def natural_text_key(path: Path) -> tuple[int, int]:
    parsed = parse_text_filename(path)
    if not parsed:
        return (10**9, 0)
    return (int(parsed["scan_number"]), 0 if parsed["side"] == "left" else 1)


if __name__ == "__main__":
    raise SystemExit(main())
