#!/usr/bin/env python3
"""Build a small, deterministic catalog fixture from the approved taxonomy archives.

The script never downloads data. It streams the supplied ZIP archives and keeps a
bounded number of real indicator rows per primary data block.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import pathlib
import zipfile
from collections import Counter
from datetime import datetime, timezone


EXACT_MNEMONIC = "OBJCPRM.RU75.RUB.TH.NA.M.DOM.A.AVG.NSA"
TOTALS = {
    "indicators": 1_606_756,
    "concepts": 21_665,
    "blocks": 15,
    "topics": 15,
    "themes": 50,
    "subthemes": 92,
    "subtheme2": 790,
    "activePaths": 18_636,
    "memberships": 3_165_548,
}

FREQUENCIES = {
    "A": "Годовая",
    "SA": "Полугодовая",
    "Q": "Квартальная",
    "M": "Месячная",
    "W": "Недельная",
    "D": "Дневная",
    "NA": "Не указана",
}

ROOT = pathlib.Path(__file__).resolve().parents[2]
LABEL_OVERRIDES = json.loads((ROOT / "catalog/config/label-overrides.json").read_text(encoding="utf-8"))


def display_block_name(alias: str, source_name: str):
    return LABEL_OVERRIDES.get("blocks", {}).get(alias, source_name)


def iter_csv_members(archive_path: pathlib.Path, marker: str):
    with zipfile.ZipFile(archive_path) as archive:
        names = sorted(
            name for name in archive.namelist()
            if marker in name and name.lower().endswith(".csv")
        )
        for name in names:
            with archive.open(name) as raw:
                text = io.TextIOWrapper(raw, encoding="utf-8-sig", newline="")
                yield from csv.DictReader(text, delimiter=";")


def read_single_csv(archive_path: pathlib.Path, suffix: str):
    with zipfile.ZipFile(archive_path) as archive:
        name = next(name for name in archive.namelist() if name.endswith(suffix))
        with archive.open(name) as raw:
            text = io.TextIOWrapper(raw, encoding="utf-8-sig", newline="")
            return list(csv.DictReader(text, delimiter=";"))


def split_pipe(value: str):
    return [item.strip() for item in (value or "").split("|") if item.strip()]


def compact_node(row, prefix):
    return {
        "id": row.get(f"{prefix}_id") or row.get(f"{prefix}_alias"),
        "alias": row.get(f"{prefix}_alias") or "",
        "name": row.get(prefix) or "",
    }


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--taxonomy", required=True, type=pathlib.Path)
    parser.add_argument("--blocks", required=True, type=pathlib.Path)
    parser.add_argument("--taxonomy3", required=True, type=pathlib.Path)
    parser.add_argument("--output", required=True, type=pathlib.Path)
    parser.add_argument("--per-block", type=int, default=2000)
    return parser.parse_args()


def main():
    args = parse_args()
    block_rows = read_single_csv(args.blocks, "data_block_summary.csv")
    blocks = []
    for row in block_rows:
        alias = row.get("block_alias") or row.get("alias") or row.get("primary_block_alias")
        if not alias:
            continue
        source_name = row.get("block") or row.get("name") or row.get("primary_block") or alias
        blocks.append({
            "alias": alias,
            "sourceName": source_name,
            "name": display_block_name(alias, source_name),
            "description": row.get("description") or row.get("definition") or "",
            "primarySeries": int(row.get("primary_indicator_count") or 0),
            "totalSeries": int(row.get("all_membership_indicator_count") or row.get("primary_indicator_count") or 0),
            "demoSeries": 0,
        })

    valid_aliases = {block["alias"] for block in blocks}
    quotas = Counter()
    selected_blocks = {}
    exact_id = None
    for row in iter_csv_members(args.blocks, "indicator_data_block_assignment_part_"):
        alias = row.get("primary_block_alias", "")
        if row.get("mnemonics") == EXACT_MNEMONIC:
            exact_id = row["id"]
        if alias in valid_aliases and quotas[alias] < args.per_block:
            selected_blocks[row["id"]] = row
            quotas[alias] += 1
        if exact_id and all(quotas[alias] >= args.per_block for alias in valid_aliases):
            break

    if exact_id and exact_id not in selected_blocks:
        for row in iter_csv_members(args.blocks, "indicator_data_block_assignment_part_"):
            if row["id"] == exact_id:
                selected_blocks[exact_id] = row
                break

    selected_ids = set(selected_blocks)
    taxonomy_rows = {}
    for row in iter_csv_members(args.taxonomy, "indicator_taxonomy_assignment_part_"):
        if row["id"] in selected_ids:
            taxonomy_rows[row["id"]] = row
            if len(taxonomy_rows) == len(selected_ids):
                break

    taxonomy3_rows = {}
    for row in iter_csv_members(args.taxonomy3, "indicator_taxonomy_assignment_3_levels_part_"):
        if row["id"] in selected_ids:
            taxonomy3_rows[row["id"]] = row
            if len(taxonomy3_rows) == len(selected_ids):
                break

    indicators = []
    for series_id in sorted(selected_ids):
        row = taxonomy_rows.get(series_id)
        block_row = selected_blocks[series_id]
        if not row:
            continue
        row3 = taxonomy3_rows.get(series_id, {})
        all_aliases = split_pipe(block_row.get("all_block_aliases", ""))
        all_names = split_pipe(block_row.get("all_blocks", ""))
        secondary_aliases = split_pipe(block_row.get("secondary_block_aliases", ""))
        secondary_names = split_pipe(block_row.get("secondary_blocks", ""))
        indicator = {
            "seriesId": series_id,
            "mnemonic": row.get("mnemonics", ""),
            "name": row.get("name", ""),
            "conceptKey": row.get("concept_key", ""),
            "indicatorCode": row.get("indicator_code", ""),
            "geography": {
                "code": row.get("geography_code", ""),
                "scopeAlias": row.get("geography_scope_alias", ""),
                "scope": row.get("geography_scope", ""),
                "name": row.get("geography_name", ""),
                "isRegional": row.get("is_regional_series", "").lower() in {"1", "true", "yes"},
            },
            "unit": {"code": row.get("unit_code", ""), "label": row.get("unit_code", "") or "Не указана"},
            "frequency": {
                "code": row.get("frequency_code", ""),
                "label": FREQUENCIES.get(row.get("frequency_code", ""), row.get("frequency_code", "") or "Не указана"),
            },
            "source": {"code": row.get("source_code", ""), "label": row.get("source_code", "") or "Не указан"},
            "taxonomy4": {
                "topic": compact_node(row, "topic"),
                "theme": compact_node(row, "theme"),
                "subtheme": compact_node(row, "subtheme"),
                "subtheme2": {
                    **compact_node(row, "subtheme2"),
                    "typeAlias": row.get("subtheme2_type_alias", ""),
                    "type": row.get("subtheme2_type", ""),
                },
                "pathId": row.get("thematic_path_id", ""),
                "pathAlias": row.get("thematic_path_alias", ""),
                "path": row.get("thematic_path", ""),
            },
            "taxonomy3": {
                "topic": compact_node(row3, "topic"),
                "theme": compact_node(row3, "theme"),
                "subtheme": compact_node(row3, "subtheme"),
                "pathId": row3.get("thematic_path_id", ""),
                "pathAlias": row3.get("thematic_path_alias", ""),
                "path": row3.get("thematic_path", ""),
            },
            "blocks": {
                "primary": {
                    "alias": block_row.get("primary_block_alias", ""),
                    "sourceName": block_row.get("primary_block", ""),
                    "name": display_block_name(block_row.get("primary_block_alias", ""), block_row.get("primary_block", "")),
                },
                "secondary": [
                    {"alias": alias, "sourceName": secondary_names[index] if index < len(secondary_names) else alias, "name": display_block_name(alias, secondary_names[index] if index < len(secondary_names) else alias)}
                    for index, alias in enumerate(secondary_aliases)
                ],
                "all": [
                    {"alias": alias, "sourceName": all_names[index] if index < len(all_names) else alias, "name": display_block_name(alias, all_names[index] if index < len(all_names) else alias)}
                    for index, alias in enumerate(all_aliases)
                ],
            },
            "classification": {
                "confidence": row.get("classification_confidence", ""),
                "method": row.get("classification_method", ""),
                "reviewRequired": row.get("review_required", "").lower() in {"1", "true", "yes"},
            },
            "availability": {"hasTimeSeries": False, "observationCount": 0},
        }
        indicators.append(indicator)

    demo_counts = Counter(item["blocks"]["primary"]["alias"] for item in indicators)
    for block in blocks:
        block["demoSeries"] = demo_counts[block["alias"]]

    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "manifest": {
            "mode": "demo",
            "datasetVersion": "taxonomy-final-2026-08-25",
            "taxonomyMode": "four-level",
            "threeLevelAvailable": True,
            "controlIndicators": TOTALS["indicators"],
            "queryableIndicators": len(indicators),
            "fullDataReady": False,
            "totals": TOTALS,
            "exactMnemonic": EXACT_MNEMONIC,
        },
        "blocks": blocks,
        "indicators": indicators,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "indicators": len(indicators),
        "blocks": {alias: demo_counts[alias] for alias in sorted(valid_aliases)},
        "exactMnemonicIncluded": any(item["mnemonic"] == EXACT_MNEMONIC for item in indicators),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
