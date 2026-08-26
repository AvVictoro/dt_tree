CREATE INDEX IF NOT EXISTS catalog_indicator_grouping
  ON catalog_indicator (dataset_version_id, indicator_code, series_id);

CREATE INDEX IF NOT EXISTS catalog_indicator_taxonomy3_grouping
  ON catalog_indicator_taxonomy (dataset_version_id, taxonomy_levels, path_id, topic_alias, theme_alias, subtheme_alias, series_id)
  WHERE taxonomy_levels = 3;
