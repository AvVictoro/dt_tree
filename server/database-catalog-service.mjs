import { decodeCursor, encodeCursor } from '../catalog/lib/search.mjs';
import { displayBlockName } from './label-overrides.mjs';

let poolPromise;
async function pool() {
  poolPromise ||= import('@neondatabase/serverless').then(({ Pool }) => new Pool({ connectionString: process.env.DATABASE_URL }));
  return poolPromise;
}

function json(payload, status = 200) {
  return { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, max-age=15' }, payload };
}

function values(params, key) {
  const aliases = { block: ['block', 'blockId'], topic: ['topic', 'topicId'], theme: ['theme', 'themeId'], subtheme: ['subtheme', 'subthemeId'], subtheme2: ['subtheme2', 'subtheme2Id'] };
  return (aliases[key] || [key]).flatMap(param => params.getAll(param)).flatMap(value => value.split(',')).map(value => value.trim()).filter(Boolean);
}

const SIMPLE_COLUMNS = {
  source: 'i.source_code', frequency: 'i.frequency_code', unit: 'i.unit_code',
  geographyScope: 'i.geography_scope_alias', geography: 'i.geography_code',
};
const TAXONOMY_COLUMNS = { topic: 't.topic_alias', theme: 't.theme_alias', subtheme: 't.subtheme_alias', subtheme2: 't.subtheme2_alias' };

function filters(params, { omit = '', start = 1 } = {}) {
  const clauses = [`i.dataset_version_id = (SELECT id FROM catalog_dataset_version WHERE status='active')`];
  const args = [];
  const add = (clause, value) => { args.push(value); clauses.push(clause.replace('?', `$${start + args.length - 1}`)); };
  const query = params.get('q')?.trim();
  if (query && omit !== 'q') {
    const first = start + args.length;
    args.push(query, query, query, query);
    clauses.push(`(lower(i.mnemonic)=lower($${first}) OR i.mnemonic ILIKE '%' || $${first + 1} || '%' OR i.name ILIKE '%' || $${first + 2} || '%' OR i.search_vector @@ websearch_to_tsquery('russian', unaccent($${first + 3})))`);
  }
  for (const [key, column] of Object.entries(SIMPLE_COLUMNS)) {
    const selected = values(params, key); if (selected.length && key !== omit) add(`${column} = ANY(?::text[])`, selected);
  }
  for (const [key, column] of Object.entries(TAXONOMY_COLUMNS)) {
    const selected = values(params, key); if (selected.length && key !== omit) add(`${column} = ANY(?::text[])`, selected);
  }
  const selectedBlocks = values(params, 'block');
  if (selectedBlocks.length && omit !== 'block') add(`EXISTS (SELECT 1 FROM catalog_indicator_block ib WHERE ib.dataset_version_id=i.dataset_version_id AND ib.series_id=i.series_id AND ib.block_alias=ANY(?::text[]))`, selectedBlocks);
  return { sql: clauses.join(' AND '), args };
}

function mapIndicator(row) {
  const allBlocks = row.all_blocks || [];
  return {
    seriesId: row.series_id,
    mnemonic: row.mnemonic,
    name: row.name,
    conceptKey: row.concept_key,
    indicatorCode: row.indicator_code,
    geography: { code: row.geography_code, scopeAlias: row.geography_scope_alias, scope: row.geography_scope, name: row.geography_name, isRegional: row.is_regional_series },
    unit: { code: row.unit_code, label: row.unit_code || 'Не указана' },
    frequency: { code: row.frequency_code, label: row.frequency_code || 'Не указана' },
    source: { code: row.source_code, label: row.source_code || 'Не указан' },
    taxonomy4: {
      topic: { alias: row.topic_alias, name: row.topic_name }, theme: { alias: row.theme_alias, name: row.theme_name },
      subtheme: { alias: row.subtheme_alias, name: row.subtheme_name }, subtheme2: { alias: row.subtheme2_alias, name: row.subtheme2_name },
      pathId: row.path_id, pathAlias: row.path_alias, path: row.path_name,
    },
    blocks: {
      primary: allBlocks.find(block => block.role === 'primary') || null,
      secondary: allBlocks.filter(block => block.role === 'secondary'), all: allBlocks,
    },
    availability: { hasTimeSeries: row.has_time_series, observationCount: Number(row.observation_count || 0) },
  };
}

const CARD_SELECT = `
  SELECT i.*,t.path_id,t.path_alias,t.path_name,t.topic_alias,t.theme_alias,t.subtheme_alias,t.subtheme2_alias,
    nt.name topic_name,nth.name theme_name,ns.name subtheme_name,ns2.name subtheme2_name,
    coalesce(bl.all_blocks,'[]'::jsonb) all_blocks
  FROM catalog_indicator i
  JOIN catalog_indicator_taxonomy t ON t.dataset_version_id=i.dataset_version_id AND t.series_id=i.series_id AND t.taxonomy_levels=4
  LEFT JOIN catalog_taxonomy_node nt ON nt.dataset_version_id=i.dataset_version_id AND nt.taxonomy_levels=4 AND nt.level=1 AND nt.alias=t.topic_alias
  LEFT JOIN catalog_taxonomy_node nth ON nth.dataset_version_id=i.dataset_version_id AND nth.taxonomy_levels=4 AND nth.level=2 AND nth.alias=t.theme_alias
  LEFT JOIN catalog_taxonomy_node ns ON ns.dataset_version_id=i.dataset_version_id AND ns.taxonomy_levels=4 AND ns.level=3 AND ns.alias=t.subtheme_alias
  LEFT JOIN catalog_taxonomy_node ns2 ON ns2.dataset_version_id=i.dataset_version_id AND ns2.taxonomy_levels=4 AND ns2.level=4 AND ns2.alias=t.subtheme2_alias
  LEFT JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('alias',ib.block_alias,'name',b.name,'role',ib.role) ORDER BY ib.role) all_blocks FROM catalog_indicator_block ib JOIN catalog_data_block b ON b.dataset_version_id=ib.dataset_version_id AND b.alias=ib.block_alias WHERE ib.dataset_version_id=i.dataset_version_id AND ib.series_id=i.series_id) bl ON true`;

function baseIndicatorKeySql(alias = 'i') {
  return `CASE
    WHEN position(',' in ${alias}.mnemonic)>0 THEN btrim(split_part(${alias}.mnemonic, ',', 1))
    WHEN nullif(btrim(${alias}.indicator_code),'') IS NOT NULL THEN btrim(${alias}.indicator_code)
    WHEN position('.' in ${alias}.mnemonic)>0 THEN btrim(split_part(${alias}.mnemonic, '.', 1))
    ELSE coalesce(nullif(btrim(${alias}.mnemonic),''),${alias}.series_id::text)
  END`;
}

function groupPathKeySql(alias = 't') {
  return `coalesce(nullif(${alias}.path_id,''),concat_ws('|',${alias}.topic_alias,${alias}.theme_alias,${alias}.subtheme_alias),'unclassified')`;
}

function groupIdSql(indicatorAlias = 'i', taxonomyAlias = 't') {
  return `((${baseIndicatorKeySql(indicatorAlias)}) || '::' || (${groupPathKeySql(taxonomyAlias)}))`;
}

const BASE_INDICATOR_KEY_SQL = baseIndicatorKeySql();
const GROUP_ID_SQL = groupIdSql();
const FEATURED_GROUPS_CTE = `featured_source AS (
    SELECT ${groupIdSql('fi', 'ft')} group_id
    FROM catalog_indicator fi
    JOIN catalog_indicator_taxonomy ft ON ft.dataset_version_id=fi.dataset_version_id AND ft.series_id=fi.series_id AND ft.taxonomy_levels=3
    WHERE fi.dataset_version_id=(SELECT id FROM catalog_dataset_version WHERE status='active')
  ), featured_groups AS (
    SELECT group_id FROM featured_source GROUP BY group_id ORDER BY count(*) DESC,group_id LIMIT 500
  )`;

function groupMemberClause(parameterIndex) {
  const path = `coalesce(nullif(t3.path_id,''),concat_ws('|',t3.topic_alias,t3.theme_alias,t3.subtheme_alias),'unclassified')`;
  return `EXISTS (SELECT 1 FROM catalog_indicator_taxonomy t3 WHERE t3.dataset_version_id=i.dataset_version_id AND t3.series_id=i.series_id AND t3.taxonomy_levels=3 AND ((${BASE_INDICATOR_KEY_SQL}) || '::' || (${path}))=$${parameterIndex})`;
}

export async function handleDatabaseCatalogRequest({ method = 'GET', pathname, searchParams }) {
  if (method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  const db = await pool();
  const route = pathname.replace(/^\/api\/catalog\/?/, '').replace(/\/$/, '');
  if (!route || route === 'health') return json({ ok: true, mode: 'database' });
  if (route === 'manifest') {
    const { rows } = await db.query(`SELECT version_label,taxonomy_levels,indicator_count,control_totals FROM catalog_dataset_version WHERE status='active'`);
    if (!rows[0]) return json({ error: 'No active catalog version' }, 503);
    const controlIndicators = Number(rows[0].control_totals?.indicators || 1_606_756);
    const queryableIndicators = Number(rows[0].indicator_count);
    return json({ mode: 'database', controlIndicators, queryableIndicators, dataVersion: rows[0].version_label, fullDataReady: queryableIndicators === controlIndicators, taxonomyMode: rows[0].taxonomy_levels === 3 ? 'three-level' : 'four-level', threeLevelAvailable: true, totals: rows[0].control_totals });
  }
  if (route === 'blocks') {
    const { rows } = await db.query(`SELECT alias,coalesce(source_name,name) "sourceName",name,description,primary_indicator_count "primarySeries",membership_indicator_count "totalSeries",primary_indicator_count "availableSeries" FROM catalog_data_block WHERE dataset_version_id=(SELECT id FROM catalog_dataset_version WHERE status='active') ORDER BY sort_order`);
    return json({ items: rows.map(row => ({ ...row, name: displayBlockName(row.alias, row.sourceName) })) });
  }
  if (route === 'hierarchy') {
    const taxonomy = searchParams.get('taxonomy') === '3' ? 3 : 4;
    const levels = taxonomy === 3 ? ['topic', 'theme', 'subtheme'] : ['topic', 'theme', 'subtheme', 'subtheme2'];
    const level = levels.includes(searchParams.get('level')) ? searchParams.get('level') : 'topic';
    const column = TAXONOMY_COLUMNS[level];
    const f = filters(searchParams);
    const { rows } = await db.query(`SELECT n.node_id id,n.alias,n.name,count(*)::bigint count,CASE WHEN count(DISTINCT i.geography_code)=1 THEN min(i.geography_code) END "geographyCode" FROM catalog_indicator i JOIN catalog_indicator_taxonomy t ON t.dataset_version_id=i.dataset_version_id AND t.series_id=i.series_id AND t.taxonomy_levels=${taxonomy} JOIN catalog_taxonomy_node n ON n.dataset_version_id=i.dataset_version_id AND n.taxonomy_levels=${taxonomy} AND n.alias=${column} WHERE ${f.sql} GROUP BY n.node_id,n.alias,n.name ORDER BY count DESC,n.name`, f.args);
    return json({ level, taxonomy: String(taxonomy), items: rows.map(row => ({ ...row, count: Number(row.count) })) });
  }
  if (route === 'groups') {
    const featured = searchParams.get('featured') === '1';
    const f = filters(searchParams, { omit: 'q' });
    const query = searchParams.get('q')?.trim();
    const queryIndex = f.args.length + 1;
    const searchMatch = query
      ? `(lower(i.mnemonic)=lower($${queryIndex}) OR i.mnemonic ILIKE '%' || $${queryIndex} || '%' OR i.name ILIKE '%' || $${queryIndex} || '%' OR i.search_vector @@ websearch_to_tsquery('russian',unaccent($${queryIndex})))`
      : 'true';
    const groupArgs = query ? [...f.args, query] : f.args;
    const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') || 30)));
    const offset = decodeCursor(searchParams.get('cursor'));
    const { rows } = await db.query(`WITH ${featured ? `${FEATURED_GROUPS_CTE},` : ''} filtered AS (
      SELECT ${GROUP_ID_SQL} group_id,${BASE_INDICATOR_KEY_SQL} indicator_code,i.name,t.path_id,t.path_name,t.topic_alias,t.theme_alias,t.subtheme_alias,${searchMatch} search_match,
        nt.name topic_name,nth.name theme_name,ns.name subtheme_name
      FROM catalog_indicator i
      JOIN catalog_indicator_taxonomy t ON t.dataset_version_id=i.dataset_version_id AND t.series_id=i.series_id AND t.taxonomy_levels=3
      LEFT JOIN catalog_taxonomy_node nt ON nt.dataset_version_id=i.dataset_version_id AND nt.taxonomy_levels=3 AND nt.level=1 AND nt.alias=t.topic_alias
      LEFT JOIN catalog_taxonomy_node nth ON nth.dataset_version_id=i.dataset_version_id AND nth.taxonomy_levels=3 AND nth.level=2 AND nth.alias=t.theme_alias
      LEFT JOIN catalog_taxonomy_node ns ON ns.dataset_version_id=i.dataset_version_id AND ns.taxonomy_levels=3 AND ns.level=3 AND ns.alias=t.subtheme_alias
      WHERE ${f.sql}${featured ? ` AND ${GROUP_ID_SQL} IN (SELECT group_id FROM featured_groups)` : ''}
    ), grouped AS (
      SELECT group_id,indicator_code,mode() WITHIN GROUP (ORDER BY name) name,min(path_id) path_id,min(path_name) path_name,
        min(topic_alias) topic_alias,min(topic_name) topic_name,min(theme_alias) theme_alias,min(theme_name) theme_name,
        min(subtheme_alias) subtheme_alias,min(subtheme_name) subtheme_name,count(*)::bigint series_count,bool_or(search_match) matched
      FROM filtered GROUP BY group_id,indicator_code
    ) SELECT *,count(*) OVER() total FROM grouped WHERE matched ORDER BY path_name,name LIMIT ${limit} OFFSET ${offset}`, groupArgs);
    const total = Number(rows[0]?.total || 0);
    return json({ items: rows.map(row => ({
      groupId: row.group_id, indicatorCode: row.indicator_code, name: row.name, seriesCount: Number(row.series_count),
      taxonomy: { topic: { alias: row.topic_alias, name: row.topic_name }, theme: { alias: row.theme_alias, name: row.theme_name }, subtheme: { alias: row.subtheme_alias, name: row.subtheme_name }, pathId: row.path_id, path: row.path_name },
    })), total, limit, nextCursor: offset + limit < total ? encodeCursor(offset + limit) : null });
  }
  const flatGroupKind = route === 'group-series' ? 'series' : route === 'group-facets' ? 'facets' : null;
  const groupRoute = route.match(/^groups\/(.+)\/(series|facets)$/);
  if (groupRoute || flatGroupKind) {
    const groupId = flatGroupKind ? searchParams.get('groupId') : decodeURIComponent(groupRoute[1]);
    const groupKind = flatGroupKind || groupRoute[2];
    if (!groupId) return json({ error: 'Group id is required' }, 400);
    if (groupKind === 'facets') {
      const facets = {};
      for (const [key, column] of Object.entries(SIMPLE_COLUMNS)) {
        const f = filters(searchParams, { omit: key });
        const groupIndex = f.args.length + 1;
        const { rows } = await db.query(`SELECT ${column} value,count(*)::bigint count FROM catalog_indicator i JOIN catalog_indicator_taxonomy t ON t.dataset_version_id=i.dataset_version_id AND t.series_id=i.series_id AND t.taxonomy_levels=4 WHERE ${f.sql} AND ${groupMemberClause(groupIndex)} AND ${column} IS NOT NULL GROUP BY ${column} ORDER BY count DESC`, [...f.args, groupId]);
        facets[key] = rows.map(row => ({ value: row.value, label: row.value, count: Number(row.count) }));
      }
      return json({ facets });
    }
    const f = filters(searchParams);
    const groupIndex = f.args.length + 1;
    const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') || 50)));
    const offset = decodeCursor(searchParams.get('cursor'));
    const args = [...f.args, groupId];
    const { rows } = await db.query(`${CARD_SELECT} WHERE ${f.sql} AND ${groupMemberClause(groupIndex)} ORDER BY i.name,i.mnemonic LIMIT ${limit} OFFSET ${offset}`, args);
    const totalResult = await db.query(`SELECT count(*)::bigint count FROM catalog_indicator i JOIN catalog_indicator_taxonomy t ON t.dataset_version_id=i.dataset_version_id AND t.series_id=i.series_id AND t.taxonomy_levels=4 WHERE ${f.sql} AND ${groupMemberClause(groupIndex)}`, args);
    const total = Number(totalResult.rows[0].count);
    return json({ items: rows.map(mapIndicator), total, limit, nextCursor: offset + limit < total ? encodeCursor(offset + limit) : null });
  }
  const idMatch = route.match(/^indicators\/(.+)$/);
  if (idMatch || route === 'indicator') {
    const key = route === 'indicator' ? searchParams.get('id') : decodeURIComponent(idMatch[1]);
    if (!key) return json({ error: 'Indicator id is required' }, 400);
    const { rows } = await db.query(`${CARD_SELECT} WHERE i.dataset_version_id=(SELECT id FROM catalog_dataset_version WHERE status='active') AND (i.series_id::text=$1 OR i.mnemonic=$1) LIMIT 1`, [key]);
    return rows[0] ? json(mapIndicator(rows[0])) : json({ error: 'Indicator not found' }, 404);
  }
  if (route === 'facets') {
    const taxonomy = searchParams.get('taxonomy') === '3' ? 3 : 4;
    const taxonomyEntries = taxonomy === 3
      ? Object.entries(TAXONOMY_COLUMNS).filter(([key]) => key !== 'subtheme2')
      : Object.entries(TAXONOMY_COLUMNS);
    const facets = {};
    for (const [key, column] of Object.entries(SIMPLE_COLUMNS)) {
      const f = filters(searchParams, { omit: key });
      const { rows } = await db.query(`SELECT ${column} value,count(DISTINCT i.series_id)::bigint count FROM catalog_indicator i JOIN catalog_indicator_taxonomy t ON t.dataset_version_id=i.dataset_version_id AND t.series_id=i.series_id AND t.taxonomy_levels=${taxonomy} WHERE ${f.sql} AND ${column} IS NOT NULL GROUP BY ${column} ORDER BY count DESC LIMIT 100`, f.args);
      facets[key] = rows.map(row => ({ value: row.value, label: row.value, count: Number(row.count) }));
    }
    const taxonomyLevels = { topic: 1, theme: 2, subtheme: 3, subtheme2: 4 };
    for (const [key, column] of taxonomyEntries) {
      const f = filters(searchParams, { omit: key });
      const { rows } = await db.query(`SELECT ${column} value,n.name label,count(DISTINCT i.series_id)::bigint count FROM catalog_indicator i JOIN catalog_indicator_taxonomy t ON t.dataset_version_id=i.dataset_version_id AND t.series_id=i.series_id AND t.taxonomy_levels=${taxonomy} JOIN catalog_taxonomy_node n ON n.dataset_version_id=i.dataset_version_id AND n.taxonomy_levels=${taxonomy} AND n.level=${taxonomyLevels[key]} AND n.alias=${column} WHERE ${f.sql} AND ${column} IS NOT NULL GROUP BY ${column},n.name ORDER BY count DESC,n.name LIMIT 1000`, f.args);
      facets[key] = rows.map(row => ({ value: row.value, label: row.label, count: Number(row.count) }));
    }
    facets.subtheme2 ||= [];
    return json({ taxonomy: { topics: facets.topic, themes: facets.theme, subthemes: facets.subtheme, subthemes2: facets.subtheme2 }, attributes: { frequencies: facets.frequency, geographies: facets.geography, geographyScopes: facets.geographyScope, units: facets.unit, sources: facets.source }, facets });
  }
  if (route === 'suggest' || route === 'search' || route === 'indicators') {
    const refinementKeys = ['q', 'topic', 'theme', 'subtheme', 'subtheme2', 'source', 'frequency', 'unit', 'geographyScope', 'geography'];
    const noIntent = values(searchParams, 'block').length === 0 && !refinementKeys.some(key => values(searchParams, key).length);
    const blockOnly = values(searchParams, 'block').length && !refinementKeys.some(key => values(searchParams, key).length);
    const f = filters(searchParams);
    if (route === 'indicators' && (noIntent || blockOnly) && searchParams.get('allowBlockOnly') !== '1') {
      const totalResult = await db.query(`SELECT count(*)::bigint count FROM catalog_indicator i JOIN catalog_indicator_taxonomy t ON t.dataset_version_id=i.dataset_version_id AND t.series_id=i.series_id AND t.taxonomy_levels=4 WHERE ${f.sql}`, f.args);
      return json({ items: [], total: Number(totalResult.rows[0].count), limit: 50, nextCursor: null, requiresRefinement: true });
    }
    const limit = route === 'suggest' ? 8 : Math.min(100, Math.max(1, Number(searchParams.get('limit') || 50)));
    const offset = route === 'suggest' ? 0 : decodeCursor(searchParams.get('cursor'));
    const query = searchParams.get('q') || '';
    const order = query ? `CASE WHEN lower(i.mnemonic)=lower($${f.args.length + 1}) THEN 0 WHEN i.mnemonic ILIKE $${f.args.length + 2} || '%' THEN 1 WHEN i.name ILIKE $${f.args.length + 2} || '%' THEN 2 ELSE 3 END,i.name` : 'i.name';
    const queryArgs = query ? [...f.args, query, query] : f.args;
    const { rows } = await db.query(`${CARD_SELECT} WHERE ${f.sql} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`, queryArgs);
    if (route === 'suggest') return json({ items: rows.map(row => { const item = mapIndicator(row); return { seriesId: item.seriesId, mnemonic: item.mnemonic, name: item.name, geography: item.geography, frequency: item.frequency }; }) });
    const totalResult = await db.query(`SELECT count(*)::bigint count FROM catalog_indicator i JOIN catalog_indicator_taxonomy t ON t.dataset_version_id=i.dataset_version_id AND t.series_id=i.series_id AND t.taxonomy_levels=4 WHERE ${f.sql}`, f.args);
    const total = Number(totalResult.rows[0].count);
    return json({ items: rows.map(mapIndicator), total, limit, nextCursor: offset + limit < total ? encodeCursor(offset + limit) : null, requiresRefinement: false });
  }
  return json({ error: 'Catalog route not found' }, 404);
}
