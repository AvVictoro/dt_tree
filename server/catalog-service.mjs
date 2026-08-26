import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeCursor, encodeCursor, rankIndicators, searchableText } from '../catalog/lib/search.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let fixturePromise;

async function loadFixture() {
  fixturePromise ||= fs.readFile(path.join(root, 'catalog/demo/catalog-demo.json'), 'utf8').then(JSON.parse).then(data => {
    data.indicators.forEach(indicator => { indicator._searchText = searchableText(indicator); });
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

function values(params, key) {
  return params.getAll(key).flatMap(value => value.split(',')).map(value => value.trim()).filter(Boolean);
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

function hierarchyLevel(indicator, level, taxonomyMode) {
  const taxonomy = taxonomyMode === '3' ? indicator.taxonomy3 : indicator.taxonomy4;
  return taxonomy?.[level];
}

function hierarchyParents(indicator, level, taxonomyMode) {
  const levels = taxonomyMode === '3' ? ['topic', 'theme', 'subtheme'] : ['topic', 'theme', 'subtheme', 'subtheme2'];
  const index = levels.indexOf(level);
  const taxonomy = taxonomyMode === '3' ? indicator.taxonomy3 : indicator.taxonomy4;
  return levels.slice(0, index).map(item => taxonomy?.[item]?.alias).filter(Boolean);
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
  if (!route || route === 'health') return json({ ok: true, mode: 'demo', indicators: data.indicators.length });
  if (route === 'manifest') return json(data.manifest);
  if (route === 'blocks') return json({ items: data.blocks });

  if (route === 'hierarchy') {
    const level = searchParams.get('level') || 'topic';
    const taxonomyMode = searchParams.get('taxonomy') === '3' ? '3' : '4';
    const parent = searchParams.get('parent');
    const filtered = applyFilters(data.indicators, searchParams);
    const counts = new Map();
    for (const indicator of filtered) {
      if (parent && !hierarchyParents(indicator, level, taxonomyMode).includes(parent)) continue;
      const node = hierarchyLevel(indicator, level, taxonomyMode);
      if (!node?.alias) continue;
      const current = counts.get(node.alias) || { ...node, count: 0 };
      current.count += 1;
      counts.set(node.alias, current);
    }
    return json({ level, taxonomy: taxonomyMode, items: [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ru')) });
  }

  if (route === 'facets') {
    const facets = {};
    for (const [key, getter] of Object.entries(DIMENSIONS)) {
      const count = new Map();
      for (const indicator of applyFilters(data.indicators, searchParams, key)) {
        for (const value of getter(indicator).filter(Boolean)) {
          const current = count.get(value) || { value, label: FACET_LABELS[key]?.(indicator, value) || value, count: 0 };
          current.count += 1;
          count.set(value, current);
        }
      }
      facets[key] = [...count.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'ru'));
    }
    return json({ facets });
  }

  const idMatch = route.match(/^indicators\/(.+)$/);
  if (idMatch) {
    const key = decodeURIComponent(idMatch[1]);
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
    const filtered = applyFilters(data.indicators, searchParams);
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
