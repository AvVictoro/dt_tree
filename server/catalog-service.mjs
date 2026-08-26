import fs from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { decodeCursor, encodeCursor, rankIndicators, searchableText, searchScore } from '../catalog/lib/search.mjs';
import { getIndicatorGroupId, groupSeries } from '../catalog/lib/grouping.mjs';
import { displayBlockName } from './label-overrides.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let fixturePromise;

async function loadFixture() {
  fixturePromise ||= fs.readFile(path.join(root, 'catalog/data/catalog-data.json.gz')).then(buffer => JSON.parse(gunzipSync(buffer).toString('utf8'))).then(data => {
    data.indicators.forEach(indicator => {
      indicator.taxonomy3 = data.taxonomy3Paths?.[indicator.taxonomy3PathId] || null;
      indicator._searchText = searchableText(indicator);
    });
    data.mnemonicIndex = new Map(data.indicators.map(indicator => [String(indicator.mnemonic || '').toLocaleLowerCase('ru-RU'), indicator]));
    data.blocks = data.blocks.map(block => {
      const sourceName = block.sourceName || block.name;
      return { ...block, sourceName, name: displayBlockName(block.alias, sourceName) };
    });
    data.indicators.forEach(indicator => {
      for (const block of [indicator.blocks?.primary, ...(indicator.blocks?.secondary || []), ...(indicator.blocks?.all || [])].filter(Boolean)) {
        block.sourceName ||= block.name;
        block.name = displayBlockName(block.alias, block.sourceName);
      }
    });
    return data;
  });
  return fixturePromise;
}

const DIMENSIONS = {
  block: indicator => (indicator.blocks?.all || []).map(item => item.alias),
  topic: indicator => [indicator.taxonomy4?.topic?.alias],
  theme: indicator => [indicator.taxonomy4?.theme?.alias],
  subtheme: indicator => [indicator.taxonomy4?.subtheme?.alias],
  subtheme2: indicator => [indicator.taxonomy4?.subtheme2?.alias],
  source: indicator => [indicator.source?.code],
  frequency: indicator => [indicator.frequency?.code],
  unit: indicator => [indicator.unit?.code],
  geographyScope: indicator => [indicator.geography?.scopeAlias],
  geography: indicator => [indicator.geography?.code],
};

const GROUP_DIMENSIONS = {
  ...DIMENSIONS,
  topic: indicator => [indicator.taxonomy3?.topic?.alias],
  theme: indicator => [indicator.taxonomy3?.theme?.alias],
  subtheme: indicator => [indicator.taxonomy3?.subtheme?.alias],
  subtheme2: () => [],
};

const SERIES_DIMENSIONS = {
  source: DIMENSIONS.source,
  frequency: DIMENSIONS.frequency,
  unit: DIMENSIONS.unit,
  geographyScope: DIMENSIONS.geographyScope,
  geography: DIMENSIONS.geography,
};

const FACET_LABELS = {
  block: (indicator, value) => (indicator.blocks?.all || []).find(item => item.alias === value)?.name || value,
  topic: indicator => indicator.taxonomy4?.topic?.name,
  theme: indicator => indicator.taxonomy4?.theme?.name,
  subtheme: indicator => indicator.taxonomy4?.subtheme?.name,
  subtheme2: indicator => indicator.taxonomy4?.subtheme2?.name,
  source: indicator => indicator.source?.label,
  frequency: indicator => indicator.frequency?.label,
  unit: indicator => indicator.unit?.label,
  geographyScope: indicator => indicator.geography?.scope,
  geography: indicator => indicator.geography?.name,
};

const GROUP_FACET_LABELS = {
  ...FACET_LABELS,
  topic: indicator => indicator.taxonomy3?.topic?.name,
  theme: indicator => indicator.taxonomy3?.theme?.name,
  subtheme: indicator => indicator.taxonomy3?.subtheme?.name,
};

function values(params, key) {
  const aliases = { block: ['block', 'blockId'], topic: ['topic', 'topicId'], theme: ['theme', 'themeId'], subtheme: ['subtheme', 'subthemeId'], subtheme2: ['subtheme2', 'subtheme2Id'] };
  return (aliases[key] || [key]).flatMap(param => params.getAll(param)).flatMap(value => value.split(',')).map(value => value.trim()).filter(Boolean);
}

function applyFilters(indicators, params, omit = '') {
  return indicators.filter(indicator => Object.entries(DIMENSIONS).every(([key, getter]) => {
    if (key === omit) return true;
    const selected = values(params, key);
    if (!selected.length) return true;
    const actual = getter(indicator).filter(Boolean);
    return selected.some(value => actual.includes(value));
  }));
}

function applyGroupFilters(indicators, params, omit = '') {
  return indicators.filter(indicator => Object.entries(GROUP_DIMENSIONS).every(([key, getter]) => {
    if (key === omit) return true;
    const selected = values(params, key);
    if (!selected.length) return true;
    return selected.some(value => getter(indicator).filter(Boolean).includes(value));
  }));
}

function attributeFacets(indicators, params) {
  const facets = {};
  for (const [key, getter] of Object.entries(SERIES_DIMENSIONS)) {
    const counts = new Map();
    for (const indicator of applyGroupFilters(indicators, params, key)) {
      for (const value of getter(indicator).filter(Boolean)) {
        const current = counts.get(value) || { value, label: FACET_LABELS[key]?.(indicator, value) || value, count: 0 };
        current.count += 1;
        counts.set(value, current);
      }
    }
    facets[key] = [...counts.values()].sort((a, b) => b.count - a.count || String(a.label).localeCompare(String(b.label), 'ru'));
  }
  return facets;
}

function compact(indicator) {
  const { _searchText, ...clean } = indicator;
  return clean;
}

function paginate(items, params) {
  const limit = Math.min(100, Math.max(1, Number(params.get('limit') || 50)));
  const offset = decodeCursor(params.get('cursor'));
  const page = items.slice(offset, offset + limit);
  return {
    items: page.map(item => compact(item.indicator || item)),
    total: items.length,
    limit,
    nextCursor: offset + limit < items.length ? encodeCursor(offset + limit) : null,
  };
}

function paginateGroups(items, params) {
  const limit = Math.min(100, Math.max(1, Number(params.get('limit') || 30)));
  const offset = decodeCursor(params.get('cursor'));
  const page = items.slice(offset, offset + limit).map(group => {
    const { series, _score, ...summary } = group;
    return summary;
  });
  return { items: page, total: items.length, limit, nextCursor: offset + limit < items.length ? encodeCursor(offset + limit) : null };
}

function hierarchyLevel(indicator, level, taxonomyMode) {
  const taxonomy = taxonomyMode === '3' ? indicator.taxonomy3 : indicator.taxonomy4;
  return taxonomy?.[level];
}

function json(payload, status = 200, headers = {}) {
  return { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }, payload };
}

export async function handleCatalogRequest({ method = 'GET', pathname, searchParams = new URLSearchParams(), body = null }) {
  if (process.env.DATABASE_URL && process.env.CATALOG_FORCE_DEMO !== '1') {
    const { handleDatabaseCatalogRequest } = await import('./database-catalog-service.mjs');
    return handleDatabaseCatalogRequest({ method, pathname, searchParams, body });
  }
  if (method !== 'GET' && method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const data = await loadFixture();
  const route = pathname.replace(/^\/api\/catalog\/?/, '').replace(/\/$/, '');
  if (!route || route === 'health') return json({ ok: true, mode: 'file', indicators: data.indicators.length });
  if (route === 'manifest') return json({
    mode: 'file',
    controlIndicators: Number(data.manifest?.controlIndicators || data.manifest?.totals?.indicators || 1_606_756),
    queryableIndicators: Number(data.manifest?.queryableIndicators || data.indicators.length),
    dataVersion: data.manifest?.datasetVersion || 'taxonomy-final-2026-08-25',
    fullDataReady: false,
    taxonomyMode: 'four-level',
    threeLevelAvailable: true,
    totals: data.manifest?.totals || {},
  });
  if (route === 'blocks') return json({ items: data.blocks });

  if (route === 'hierarchy') {
    const level = searchParams.get('level') || 'topic';
    const taxonomyMode = searchParams.get('taxonomy') === '3' ? '3' : '4';
    const filtered = taxonomyMode === '3' ? applyGroupFilters(data.indicators, searchParams) : applyFilters(data.indicators, searchParams);
    const counts = new Map();
    for (const indicator of filtered) {
      const node = hierarchyLevel(indicator, level, taxonomyMode);
      if (!node?.alias) continue;
      const current = counts.get(node.alias) || { ...node, count: 0, _geographies: new Set() };
      current.count += 1;
      if (indicator.geography?.code) current._geographies.add(indicator.geography.code);
      counts.set(node.alias, current);
    }
    const items = [...counts.values()].map(({ _geographies, ...node }) => ({
      ...node,
      geographyCode: _geographies.size === 1 ? [..._geographies][0] : null,
    })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ru'));
    return json({ level, taxonomy: taxonomyMode, items });
  }

  if (route === 'facets') {
    const groupedTaxonomy = searchParams.get('taxonomy') === '3';
    const dimensions = groupedTaxonomy ? GROUP_DIMENSIONS : DIMENSIONS;
    const labels = groupedTaxonomy ? GROUP_FACET_LABELS : FACET_LABELS;
    const facets = {};
    for (const [key, getter] of Object.entries(dimensions)) {
      const count = new Map();
      for (const indicator of (groupedTaxonomy ? applyGroupFilters(data.indicators, searchParams, key) : applyFilters(data.indicators, searchParams, key))) {
        for (const value of getter(indicator).filter(Boolean)) {
          const current = count.get(value) || { value, label: labels[key]?.(indicator, value) || value, count: 0 };
          current.count += 1;
          count.set(value, current);
        }
      }
      facets[key] = [...count.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'ru'));
    }
    return json({
      taxonomy: { topics: facets.topic, themes: facets.theme, subthemes: facets.subtheme, subthemes2: facets.subtheme2 || [] },
      attributes: { frequencies: facets.frequency, geographies: facets.geography, geographyScopes: facets.geographyScope, units: facets.unit, sources: facets.source },
      facets,
    });
  }

  if (route === 'groups') {
    const filtered = applyGroupFilters(data.indicators, searchParams);
    const query = searchParams.get('q') || '';
    const exactSeries = data.mnemonicIndex.get(query.toLocaleLowerCase('ru-RU'));
    const exactGroupId = exactSeries ? getIndicatorGroupId(exactSeries) : null;
    let groups = groupSeries(filtered).map(group => ({
      ...group,
      _score: exactGroupId ? Number(group.groupId === exactGroupId) : query ? group.series.reduce((score, series) => Math.max(score, searchScore(series, query)), 0) : 1,
    })).filter(group => group._score > 0);
    groups.sort((a, b) => b._score - a._score || (a.taxonomy?.path || '').localeCompare(b.taxonomy?.path || '', 'ru') || a.name.localeCompare(b.name, 'ru'));
    return json(paginateGroups(groups, searchParams));
  }

  const flatGroupKind = route === 'group-series' ? 'series' : route === 'group-facets' ? 'facets' : null;
  const groupRoute = route.match(/^groups\/(.+)\/(series|facets)$/);
  if (groupRoute || flatGroupKind) {
    const groupId = flatGroupKind ? searchParams.get('groupId') : decodeURIComponent(groupRoute[1]);
    const groupKind = flatGroupKind || groupRoute[2];
    if (!groupId) return json({ error: 'Group id is required' }, 400);
    const groupMembers = data.indicators.filter(indicator => getIndicatorGroupId(indicator) === groupId);
    if (!groupMembers.length) return json({ error: 'Indicator group not found' }, 404);
    if (groupKind === 'facets') return json({ facets: attributeFacets(groupMembers, searchParams) });
    const filtered = applyGroupFilters(groupMembers, searchParams);
    const query = searchParams.get('q') || '';
    const ranked = query ? rankIndicators(filtered, query) : filtered.map(indicator => ({ indicator, score: 1 }));
    return json({ ...paginate(ranked, searchParams), facets: attributeFacets(groupMembers, searchParams) });
  }

  const idMatch = route.match(/^indicators\/(.+)$/);
  if (idMatch || route === 'indicator') {
    const key = route === 'indicator' ? searchParams.get('id') : decodeURIComponent(idMatch[1]);
    if (!key) return json({ error: 'Indicator id is required' }, 400);
    const indicator = data.indicators.find(item => item.seriesId === key || item.mnemonic === key);
    return indicator ? json(compact(indicator)) : json({ error: 'Indicator not found' }, 404);
  }

  if (route === 'suggest') {
    const query = searchParams.get('q') || '';
    const ranked = rankIndicators(data.indicators, query).slice(0, 8);
    return json({ items: ranked.map(({ indicator, score }) => ({
      seriesId: indicator.seriesId,
      mnemonic: indicator.mnemonic,
      name: indicator.name,
      geography: indicator.geography,
      frequency: indicator.frequency,
      score,
    })) });
  }

  if (route === 'indicators' || route === 'search') {
    if (method === 'POST' && body && typeof body === 'object') {
      for (const [key, value] of Object.entries(body)) {
        const list = Array.isArray(value) ? value : [value];
        list.filter(Boolean).forEach(item => searchParams.append(key, String(item)));
      }
    }
    const query = searchParams.get('q') || '';
    const exactSeries = query ? data.mnemonicIndex.get(query.toLocaleLowerCase('ru-RU')) : null;
    const filtered = applyFilters(exactSeries ? [exactSeries] : data.indicators, searchParams);
    const refinementKeys = ['q', 'topic', 'theme', 'subtheme', 'subtheme2', 'source', 'frequency', 'unit', 'geographyScope', 'geography'];
    const noIntent = values(searchParams, 'block').length === 0 && !refinementKeys.some(key => values(searchParams, key).length > 0);
    const blockOnly = values(searchParams, 'block').length > 0 && !refinementKeys.some(key => values(searchParams, key).length > 0);
    if ((noIntent || blockOnly) && searchParams.get('allowBlockOnly') !== '1') {
      return json({ items: [], total: filtered.length, limit: 50, nextCursor: null, requiresRefinement: true });
    }
    const ranked = query ? rankIndicators(filtered, query) : filtered.map(indicator => ({ indicator, score: 1 }));
    return json({ ...paginate(ranked, searchParams), requiresRefinement: false });
  }

  return json({ error: 'Catalog route not found' }, 404);
}
