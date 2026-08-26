#!/usr/bin/env python3
"""Stream the complete approved taxonomy into PostgreSQL.

Requires Python 3.10+ and ``psycopg[binary]``. Source ZIP files are read locally;
the importer does not fetch or parse any website. A new dataset version remains
in ``loading`` until all control totals pass, then activation is one transaction.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import pathlib
import sys
import uuid
import zipfile
from collections import Counter

EXPECTED = {
    "indicators": 1_606_756, "concepts": 21_665, "blocks": 15,
    "topics": 15, "themes": 50, "subthemes": 92, "subtheme2": 790,
    "active_paths": 18_636, "memberships": 3_165_548,
}

ROOT = pathlib.Path(__file__).resolve().parents[2]
LABEL_OVERRIDES = json.loads((ROOT / "catalog/config/label-overrides.json").read_text(encoding="utf-8"))


def display_block_name(alias, source_name):
    return LABEL_OVERRIDES.get("blocks", {}).get(alias, source_name)


def csv_members(archive_path: pathlib.Path, marker: str):
    with zipfile.ZipFile(archive_path) as archive:
        for name in sorted(item for item in archive.namelist() if marker in item and item.endswith(".csv")):
            with archive.open(name) as raw:
                reader = csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig", newline=""), delimiter=";")
                yield name, reader


def single_csv(archive_path: pathlib.Path, suffix: str):
    with zipfile.ZipFile(archive_path) as archive:
        name = next(item for item in archive.namelist() if item.endswith(suffix))
        with archive.open(name) as raw:
            yield from csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig", newline=""), delimiter=";")


def bool_value(value):
    return str(value or "").lower() in {"1", "true", "yes"}


def split_pipe(value):
    return [part.strip() for part in (value or "").split("|") if part.strip()]


def chunks(rows, size):
    batch = []
    for row in rows:
        batch.append(row)
        if len(batch) >= size:
            yield batch
            batch = []
    if batch:
        yield batch


def checkpoint(connection, version_id, stage, member, rows_loaded, completed=False):
    connection.execute("""
        INSERT INTO catalog_import_checkpoint(dataset_version_id,stage,source_member,rows_loaded,completed)
        VALUES (%s,%s,%s,%s,%s)
        ON CONFLICT (dataset_version_id,stage,source_member) DO UPDATE
        SET rows_loaded=excluded.rows_loaded, completed=excluded.completed, updated_at=now()
    """, (version_id, stage, member, rows_loaded, completed))


def load_blocks(connection, version_id, archive_path):
    rows = list(single_csv(archive_path, "data_block_summary.csv"))
    with connection.transaction():
        for row in rows:
            connection.execute("""
                INSERT INTO catalog_data_block(dataset_version_id,alias,sort_order,source_name,name,block_type,description,target_clients,inclusion_logic,pricing_note,primary_indicator_count,membership_indicator_count)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """, (version_id, row["alias"], int(row["sort_order"]), row["name"], display_block_name(row["alias"], row["name"]), row["block_type"], row["description"], row["target_clients"], row["inclusion_logic"], row["pricing_note"], int(row["primary_indicator_count"]), int(row["all_membership_indicator_count"])))
    return len(rows)


def block_payload(row):
    aliases = split_pipe(row.get("all_block_aliases"))
    primary = row.get("primary_block_alias")
    return {
        "series_id": row["id"], "mnemonic": row["mnemonics"], "name": row["name"],
        "legacy_path": row.get("legacy_path"), "concept_key": row.get("concept_key"),
        "indicator_code": row.get("indicator_code"), "geography_code": row.get("geography_code"),
        "geography_scope_alias": row.get("geography_scope_alias"), "geography_scope": row.get("geography_scope"),
        "geography_name": row.get("geography_name"), "geography_name_source": row.get("geography_name_source"),
        "is_regional_series": bool_value(row.get("is_regional_series")), "source_code": row.get("source_code"),
        "blocks": [{"alias": alias, "role": "primary" if alias == primary else "secondary"} for alias in aliases],
        "assignment_reason": row.get("assignment_reason"),
    }


def insert_block_batch(connection, version_id, payload):
    raw = json.dumps(payload, ensure_ascii=False)
    connection.execute("""
      WITH rows AS (SELECT * FROM jsonb_to_recordset(%s::jsonb) AS x(
        series_id uuid,mnemonic text,name text,legacy_path text,concept_key text,indicator_code text,
        geography_code text,geography_scope_alias text,geography_scope text,geography_name text,
        geography_name_source text,is_regional_series boolean,source_code text,blocks jsonb,assignment_reason text))
      INSERT INTO catalog_indicator(dataset_version_id,series_id,mnemonic,name,legacy_path,concept_key,indicator_code,geography_code,geography_scope_alias,geography_scope,geography_name,geography_name_source,is_regional_series,source_code)
      SELECT %s,series_id,mnemonic,name,legacy_path,concept_key,indicator_code,geography_code,geography_scope_alias,geography_scope,geography_name,geography_name_source,is_regional_series,source_code FROM rows
      ON CONFLICT (dataset_version_id,series_id) DO NOTHING
    """, (raw, version_id))
    connection.execute("""
      WITH rows AS (SELECT * FROM jsonb_to_recordset(%s::jsonb) AS x(series_id uuid,blocks jsonb,assignment_reason text))
      INSERT INTO catalog_indicator_block(dataset_version_id,series_id,block_alias,role,assignment_reason)
      SELECT %s,r.series_id,b.alias,b.role,r.assignment_reason
      FROM rows r CROSS JOIN LATERAL jsonb_to_recordset(r.blocks) AS b(alias text,role text)
      ON CONFLICT DO NOTHING
    """, (raw, version_id))


def taxonomy_payload(row, levels):
    names = ["topic", "theme", "subtheme"] + (["subtheme2"] if levels == 4 else [])
    nodes = [{
        "level": index + 1, "node_id": row.get(f"{name}_id") or row.get(f"{name}_alias"),
        "alias": row.get(f"{name}_alias"), "name": row.get(name),
        "type_alias": row.get(f"{name}_type_alias"), "type": row.get(f"{name}_type"),
    } for index, name in enumerate(names)]
    return {
        "series_id": row["id"], "unit_code": row.get("unit_code"), "frequency_code": row.get("frequency_code"),
        "source_code": row.get("source_code"), "path_id": row.get("thematic_path_id"),
        "path_alias": row.get("thematic_path_alias"), "path_name": row.get("thematic_path"),
        "topic_alias": row.get("topic_alias"), "theme_alias": row.get("theme_alias"),
        "subtheme_alias": row.get("subtheme_alias"), "subtheme2_alias": row.get("subtheme2_alias") if levels == 4 else None,
        "semantic_subtheme2_alias": row.get("semantic_subtheme2_alias"),
        "classification_confidence": row.get("classification_confidence"), "classification_method": row.get("classification_method"),
        "classification_rule": row.get("classification_rule"), "review_required": bool_value(row.get("review_required")),
        "nodes": nodes,
    }


def insert_taxonomy_batch(connection, version_id, levels, payload):
    raw = json.dumps(payload, ensure_ascii=False)
    connection.execute("""
      WITH rows AS (SELECT * FROM jsonb_to_recordset(%s::jsonb) AS x(series_id uuid,unit_code text,frequency_code text,source_code text))
      UPDATE catalog_indicator i SET unit_code=coalesce(r.unit_code,i.unit_code), frequency_code=coalesce(r.frequency_code,i.frequency_code), source_code=coalesce(r.source_code,i.source_code)
      FROM rows r WHERE i.dataset_version_id=%s AND i.series_id=r.series_id
    """, (raw, version_id))
    connection.execute("""
      WITH rows AS (SELECT * FROM jsonb_to_recordset(%s::jsonb) AS x(nodes jsonb)), nodes AS (
        SELECT DISTINCT n.level,n.node_id,n.alias,n.name,n.type_alias,n.type FROM rows r CROSS JOIN LATERAL jsonb_to_recordset(r.nodes) AS n(level smallint,node_id text,alias text,name text,type_alias text,type text))
      INSERT INTO catalog_taxonomy_node(dataset_version_id,taxonomy_levels,level,node_id,alias,name,node_type_alias,node_type)
      SELECT %s,%s,level,node_id,alias,name,type_alias,type FROM nodes WHERE alias IS NOT NULL
      ON CONFLICT DO NOTHING
    """, (raw, version_id, levels))
    connection.execute("""
      WITH rows AS (SELECT * FROM jsonb_to_recordset(%s::jsonb) AS x(nodes jsonb)), expanded AS (
        SELECT r.nodes, n.level,n.alias FROM rows r CROSS JOIN LATERAL jsonb_to_recordset(r.nodes) AS n(level smallint,alias text)), edges AS (
        SELECT DISTINCT a.level AS parent_level,a.alias AS parent_alias,b.level AS child_level,b.alias AS child_alias FROM expanded a JOIN expanded b ON a.nodes=b.nodes AND b.level=a.level+1)
      INSERT INTO catalog_taxonomy_edge(dataset_version_id,taxonomy_levels,parent_level,parent_alias,child_level,child_alias)
      SELECT %s,%s,parent_level,parent_alias,child_level,child_alias FROM edges WHERE parent_alias IS NOT NULL AND child_alias IS NOT NULL ON CONFLICT DO NOTHING
    """, (raw, version_id, levels))
    connection.execute("""
      WITH rows AS (SELECT * FROM jsonb_to_recordset(%s::jsonb) AS x(
        series_id uuid,path_id text,path_alias text,path_name text,topic_alias text,theme_alias text,subtheme_alias text,subtheme2_alias text,
        semantic_subtheme2_alias text,classification_confidence text,classification_method text,classification_rule text,review_required boolean))
      INSERT INTO catalog_indicator_taxonomy(dataset_version_id,series_id,taxonomy_levels,path_id,path_alias,path_name,topic_alias,theme_alias,subtheme_alias,subtheme2_alias,semantic_subtheme2_alias,classification_confidence,classification_method,classification_rule,review_required)
      SELECT %s,series_id,%s,path_id,path_alias,path_name,topic_alias,theme_alias,subtheme_alias,subtheme2_alias,semantic_subtheme2_alias,classification_confidence,classification_method,classification_rule,review_required FROM rows
      ON CONFLICT (dataset_version_id,series_id,taxonomy_levels) DO UPDATE SET path_alias=excluded.path_alias,path_name=excluded.path_name
    """, (raw, version_id, levels))


def stream_stage(connection, version_id, archive, marker, stage, transform, insert, batch_size):
    total = 0
    for member, reader in csv_members(archive, marker):
        member_total = 0
        for batch in chunks((transform(row) for row in reader), batch_size):
            with connection.transaction():
                insert(connection, version_id, batch)
                member_total += len(batch); total += len(batch)
                checkpoint(connection, version_id, stage, member, member_total)
            print(f"{stage}: {total:,}", file=sys.stderr)
        with connection.transaction(): checkpoint(connection, version_id, stage, member, member_total, True)
    return total


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--taxonomy", required=True, type=pathlib.Path)
    parser.add_argument("--blocks", required=True, type=pathlib.Path)
    parser.add_argument("--taxonomy3", type=pathlib.Path)
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL"))
    parser.add_argument("--version", default=os.getenv("CATALOG_DATASET_VERSION", "taxonomy-final-2026-08-25"))
    parser.add_argument("--batch-size", type=int, default=10_000)
    parser.add_argument("--migration", type=pathlib.Path, default=pathlib.Path("migrations/001_catalog.sql"))
    args = parser.parse_args()
    if not args.database_url:
        parser.error("DATABASE_URL or --database-url is required")
    try:
        import psycopg
    except ImportError as error:
        raise SystemExit("Install importer dependency: pip install 'psycopg[binary]'") from error

    version_id = uuid.uuid4()
    with psycopg.connect(args.database_url, autocommit=True) as connection:
        connection.execute(args.migration.read_text(encoding="utf-8"))
        connection.execute("INSERT INTO catalog_dataset_version(id,version_label,status,control_totals) VALUES (%s,%s,'loading',%s::jsonb)", (version_id, args.version, json.dumps(EXPECTED)))
        block_count = load_blocks(connection, version_id, args.blocks)
        indicator_count = stream_stage(connection, version_id, args.blocks, "indicator_data_block_assignment_part_", "blocks", block_payload, insert_block_batch, args.batch_size)
        taxonomy_count = stream_stage(connection, version_id, args.taxonomy, "indicator_taxonomy_assignment_part_", "taxonomy4", lambda row: taxonomy_payload(row, 4), lambda conn, vid, batch: insert_taxonomy_batch(conn, vid, 4, batch), args.batch_size)
        taxonomy3_count = 0
        if args.taxonomy3:
            taxonomy3_count = stream_stage(connection, version_id, args.taxonomy3, "indicator_taxonomy_assignment_3_levels_part_", "taxonomy3", lambda row: taxonomy_payload(row, 3), lambda conn, vid, batch: insert_taxonomy_batch(conn, vid, 3, batch), args.batch_size)
        measured = connection.execute("""
          SELECT
            (SELECT count(*) FROM catalog_indicator WHERE dataset_version_id=%s) indicators,
            (SELECT count(DISTINCT concept_key) FROM catalog_indicator WHERE dataset_version_id=%s) concepts,
            (SELECT count(*) FROM catalog_indicator_block WHERE dataset_version_id=%s) memberships,
            (SELECT count(DISTINCT path_alias) FROM catalog_indicator_taxonomy WHERE dataset_version_id=%s AND taxonomy_levels=4) active_paths,
            (SELECT count(*) FROM catalog_taxonomy_node WHERE dataset_version_id=%s AND taxonomy_levels=4 AND level=1) topics,
            (SELECT count(*) FROM catalog_taxonomy_node WHERE dataset_version_id=%s AND taxonomy_levels=4 AND level=2) themes,
            (SELECT count(*) FROM catalog_taxonomy_node WHERE dataset_version_id=%s AND taxonomy_levels=4 AND level=3) subthemes,
            (SELECT count(*) FROM catalog_taxonomy_node WHERE dataset_version_id=%s AND taxonomy_levels=4 AND level=4) subtheme2
        """, (version_id,) * 8).fetchone()
        checks = {
            "blocks": block_count, "indicators": measured[0], "concepts": measured[1],
            "memberships": measured[2], "active_paths": measured[3], "topics": measured[4],
            "themes": measured[5], "subthemes": measured[6], "subtheme2": measured[7],
            "taxonomy4_rows": taxonomy_count, "taxonomy3_rows": taxonomy3_count,
        }
        valid = all(checks[key] == expected for key, expected in EXPECTED.items()) and taxonomy_count == EXPECTED["indicators"] and (not args.taxonomy3 or taxonomy3_count == EXPECTED["indicators"])
        if not valid:
            connection.execute("UPDATE catalog_dataset_version SET status='failed',validation_report=%s::jsonb WHERE id=%s", (json.dumps(checks), version_id))
            raise SystemExit(f"Control totals failed: {checks}")
        with connection.transaction():
            connection.execute("UPDATE catalog_dataset_version SET status='archived' WHERE status='active'")
            connection.execute("UPDATE catalog_dataset_version SET status='active',activated_at=now(),indicator_count=%s,concept_count=%s,membership_count=%s,validation_report=%s::jsonb WHERE id=%s", (indicator_count, checks["concepts"], checks["memberships"], json.dumps(checks), version_id))
        print(json.dumps({"status": "active", "versionId": str(version_id), **checks}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
