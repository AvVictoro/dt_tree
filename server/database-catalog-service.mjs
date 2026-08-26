import { decodeCursor, encodeCursor } from '../catalog/lib/search.mjs';

let poolPromise;
async function pool() {
  poolPromise ||= import('@neondatabase/serverless').then(({ Pool }) => new Pool({ connectionString: process.env.DATABASE_URL }));
  return poolPromise;
}

function json(payload, status = 200) {
  return { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, max-age=15' }, payload };
}

function values(params, key) {
  return params.getAll(key).flatMap(value => value.split(',')).map(value => value.trim()).filter(Boolean);
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

export async function handleDatabaseCatalogRequest({ method = 'GET', pathname, searchParams }) {
  if (method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  const db = await pool();
  const route = pathname.replace(/^\/api\/catalog\/?/, '').replace(/\/$/, '');
  if (!route || route === 'health') return json({ ok: true, mode: 'database' });
  if (route === 'manifest') {
    const { rows } = await db.query(`SELECT version_label,taxonomy_levels,indicator_count,control_totals FROM catalog_dataset_version WHERE status='active'`);
    if (!rows[0]) return json({ error: 'No active catalog version' }, 503);
    return json({ datasetVersion: rows[0].version_label, taxonomyMode: rows[0].taxonomy_levels === 3 ? 'three-level' : 'four-level', threeLevelAvailable: true, demo: false, totals: rows[0].control_totals, demoIndicators: Number(rows[0].indicator_count) });
  }
  if (route === 'blocks') {
    const { rows } = await db.query(`SELECT alias,name,description,primary_indicator_count "primarySeries",membership_indicator_count "totalSeries",primary_indicator_count "demoSeries" FROM catalog_data_block WHERE dataset_version_id=(SELECT id FROM catalog_dataset_version WHERE status='active') ORDER BY sort_order`);
    return json({ items: rows });
  }
  if (route === 'hierarchy') {
    const taxonomy = searchParams.get('taxonomy') === '3' ? 3 : 4;
    const levels = taxonomy === 3 ? ['topic', 'theme', 'subtheme'] : ['topic', 'theme', 'subtheme', 'subtheme2'];
    const level = levels.includes(searchParams.get('level')) ? searchParams.get('level') : 'topic';
    const column = TAXONOMY_COLUMNS[level];
    const f = filters(searchParams);
    const { rows } = await db.query(`SELECT n.node_id id,n.alias,n.name,count(*)::bigint count FROM catalog_indicator i JOIN catalog_indicator_taxonomy t ON t.dataset_version_id=i.dataset_version_id AND t.series_id=i.series_id AND t.taxonomy_levels=${taxonomy} JOIN catalog_taxonomy_node n ON n.dataset_version_id=i.dataset_version_id AND n.taxonomy_levels=${taxonomy} AND n.alias=${column} WHERE ${f.sql} GROUP BY n.node_id,n.alias,n.name ORDER BY count DESC,n.name`, f.args);
    return json({ level, taxonomy: String(taxonomy), items: rows.map(row => ({ ...row, count: Number(row.count) })) });
  }
  const idMatch = route.match(/^indicators\/(.+)$/);
  if (idMatch) {
    const key = decodeURIComponent(idMatch[1]);
    const { rows } = await db.query(`${CARD_SELECT} WHERE i.dataset_version_id=(SELECT id FROM catalog_dataset_version WHERE status='active') AND (i.series_id::text=$1 OR i.mnemonic=$1) LIMIT 1`, [key]);
    return rows[0] ? json(mapIndicator(rows[0])) : json({ error: 'Indicator not found' }, 404);
  }
  if (route === 'facets') {
    const facets = {};
    for (const [key, column] of Object.entries(SIMPLE_COLUMNS)) {
      const f = filters(searchParams, { omit: key });
      const { rows } = await db.query(`SELECT ${column} value,count(*)::bigint count FROM catalog_indicator i JOIN catalog_indicator_taxonomy t ON t.dataset_version_id=i.dataset_version_id AND t.series_id=i.series_id AND t.taxonomy_levels=4 WHERE ${f.sql} AND ${column} IS NOT NULL GROUP BY ${column} ORDER BY count DESC LIMIT 50`, f.args);
      facets[key] = rows.map(row => ({ value: row.value, label: row.value, count: Number(row.count) }));
    }
    return json({ facets });
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
