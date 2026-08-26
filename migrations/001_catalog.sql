CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE TABLE IF NOT EXISTS catalog_dataset_version (
  id uuid PRIMARY KEY,
  version_label text NOT NULL UNIQUE,
  source_sha256 text,
  status text NOT NULL CHECK (status IN ('loading', 'validated', 'active', 'failed', 'archived')),
  taxonomy_levels smallint NOT NULL DEFAULT 4 CHECK (taxonomy_levels IN (3, 4)),
  indicator_count bigint NOT NULL DEFAULT 0,
  concept_count bigint NOT NULL DEFAULT 0,
  membership_count bigint NOT NULL DEFAULT 0,
  control_totals jsonb NOT NULL DEFAULT '{}'::jsonb,
  validation_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS catalog_one_active_version
  ON catalog_dataset_version ((status)) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS catalog_data_block (
  dataset_version_id uuid NOT NULL REFERENCES catalog_dataset_version(id) ON DELETE CASCADE,
  alias text NOT NULL,
  sort_order integer NOT NULL,
  name text NOT NULL,
  block_type text,
  description text,
  target_clients text,
  inclusion_logic text,
  pricing_note text,
  primary_indicator_count bigint NOT NULL DEFAULT 0,
  membership_indicator_count bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (dataset_version_id, alias)
);

CREATE TABLE IF NOT EXISTS catalog_taxonomy_node (
  dataset_version_id uuid NOT NULL REFERENCES catalog_dataset_version(id) ON DELETE CASCADE,
  taxonomy_levels smallint NOT NULL CHECK (taxonomy_levels IN (3, 4)),
  level smallint NOT NULL CHECK (level BETWEEN 1 AND 4),
  node_id text NOT NULL,
  alias text NOT NULL,
  name text NOT NULL,
  node_type_alias text,
  node_type text,
  series_count bigint NOT NULL DEFAULT 0,
  concept_count bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (dataset_version_id, taxonomy_levels, level, alias)
);

CREATE INDEX IF NOT EXISTS catalog_taxonomy_node_parent_lookup
  ON catalog_taxonomy_node (dataset_version_id, taxonomy_levels, level, alias);

CREATE TABLE IF NOT EXISTS catalog_taxonomy_edge (
  dataset_version_id uuid NOT NULL REFERENCES catalog_dataset_version(id) ON DELETE CASCADE,
  taxonomy_levels smallint NOT NULL CHECK (taxonomy_levels IN (3, 4)),
  parent_level smallint NOT NULL,
  parent_alias text NOT NULL,
  child_level smallint NOT NULL,
  child_alias text NOT NULL,
  series_count bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (dataset_version_id, taxonomy_levels, parent_alias, child_alias)
);

CREATE INDEX IF NOT EXISTS catalog_taxonomy_edge_parent
  ON catalog_taxonomy_edge (dataset_version_id, taxonomy_levels, parent_alias, child_level);

CREATE TABLE IF NOT EXISTS catalog_indicator (
  dataset_version_id uuid NOT NULL REFERENCES catalog_dataset_version(id) ON DELETE CASCADE,
  series_id uuid NOT NULL,
  mnemonic text NOT NULL,
  name text NOT NULL,
  legacy_path text,
  concept_key text,
  indicator_code text,
  geography_code text,
  geography_scope_alias text,
  geography_scope text,
  geography_name text,
  geography_name_source text,
  is_regional_series boolean NOT NULL DEFAULT false,
  unit_code text,
  frequency_code text,
  source_code text,
  has_time_series boolean NOT NULL DEFAULT false,
  observation_count bigint NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(mnemonic, '')), 'A') ||
    setweight(to_tsvector('russian', unaccent(coalesce(name, ''))), 'A') ||
    setweight(to_tsvector('simple', unaccent(coalesce(geography_name, '') || ' ' || coalesce(source_code, ''))), 'B')
  ) STORED,
  PRIMARY KEY (dataset_version_id, series_id),
  UNIQUE (dataset_version_id, mnemonic)
);

CREATE INDEX IF NOT EXISTS catalog_indicator_search_gin
  ON catalog_indicator USING gin (search_vector);
CREATE INDEX IF NOT EXISTS catalog_indicator_name_trgm
  ON catalog_indicator USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS catalog_indicator_mnemonic_trgm
  ON catalog_indicator USING gin (mnemonic gin_trgm_ops);
CREATE INDEX IF NOT EXISTS catalog_indicator_attributes
  ON catalog_indicator (dataset_version_id, source_code, frequency_code, unit_code, geography_scope_alias);
CREATE INDEX IF NOT EXISTS catalog_indicator_geography
  ON catalog_indicator (dataset_version_id, geography_code);

CREATE TABLE IF NOT EXISTS catalog_indicator_taxonomy (
  dataset_version_id uuid NOT NULL REFERENCES catalog_dataset_version(id) ON DELETE CASCADE,
  series_id uuid NOT NULL,
  taxonomy_levels smallint NOT NULL CHECK (taxonomy_levels IN (3, 4)),
  path_id text,
  path_alias text NOT NULL,
  path_name text,
  topic_alias text NOT NULL,
  theme_alias text NOT NULL,
  subtheme_alias text NOT NULL,
  subtheme2_alias text,
  semantic_subtheme2_alias text,
  classification_confidence text,
  classification_method text,
  classification_rule text,
  review_required boolean NOT NULL DEFAULT false,
  PRIMARY KEY (dataset_version_id, series_id, taxonomy_levels),
  FOREIGN KEY (dataset_version_id, series_id) REFERENCES catalog_indicator(dataset_version_id, series_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS catalog_indicator_taxonomy_path
  ON catalog_indicator_taxonomy (dataset_version_id, taxonomy_levels, topic_alias, theme_alias, subtheme_alias, subtheme2_alias, series_id);

CREATE TABLE IF NOT EXISTS catalog_indicator_block (
  dataset_version_id uuid NOT NULL REFERENCES catalog_dataset_version(id) ON DELETE CASCADE,
  series_id uuid NOT NULL,
  block_alias text NOT NULL,
  role text NOT NULL CHECK (role IN ('primary', 'secondary')),
  assignment_reason text,
  PRIMARY KEY (dataset_version_id, series_id, block_alias),
  FOREIGN KEY (dataset_version_id, series_id) REFERENCES catalog_indicator(dataset_version_id, series_id) ON DELETE CASCADE,
  FOREIGN KEY (dataset_version_id, block_alias) REFERENCES catalog_data_block(dataset_version_id, alias) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS catalog_indicator_block_lookup
  ON catalog_indicator_block (dataset_version_id, block_alias, role, series_id);

CREATE TABLE IF NOT EXISTS catalog_observation (
  dataset_version_id uuid NOT NULL REFERENCES catalog_dataset_version(id) ON DELETE CASCADE,
  series_id uuid NOT NULL,
  observed_at date NOT NULL,
  value numeric,
  status text,
  PRIMARY KEY (dataset_version_id, series_id, observed_at),
  FOREIGN KEY (dataset_version_id, series_id) REFERENCES catalog_indicator(dataset_version_id, series_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS catalog_import_checkpoint (
  dataset_version_id uuid NOT NULL REFERENCES catalog_dataset_version(id) ON DELETE CASCADE,
  stage text NOT NULL,
  source_member text NOT NULL,
  rows_loaded bigint NOT NULL DEFAULT 0,
  completed boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (dataset_version_id, stage, source_member)
);

CREATE OR REPLACE VIEW catalog_active_version AS
SELECT * FROM catalog_dataset_version WHERE status = 'active';
