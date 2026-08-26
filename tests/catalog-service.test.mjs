import test from 'node:test';
import assert from 'node:assert/strict';
import { handleCatalogRequest } from '../server/catalog-service.mjs';

async function get(pathname) {
  const url = new URL(`http://local${pathname}`);
  return handleCatalogRequest({ pathname: url.pathname, searchParams: url.searchParams });
}

test('manifest exposes full control totals and local fixture size', async () => {
  const result = await get('/api/catalog/manifest');
  assert.equal(result.status, 200);
  assert.equal(result.payload.mode, 'file');
  assert.equal(result.payload.controlIndicators, 1_606_756);
  assert.equal(Number.isInteger(result.payload.queryableIndicators), true);
  assert.ok(result.payload.queryableIndicators >= 94_000);
  assert.equal(result.payload.fullDataReady, false);
});

test('all fifteen blocks are available', async () => {
  const result = await get('/api/catalog/blocks');
  assert.equal(result.payload.items.length, 15);
  assert.ok(result.payload.items.every(block => block.availableSeries > 0));
  const russianEconomy = result.payload.items.find(block => block.alias === 'BLOCK_02_RUSSIA_MACRO');
  assert.equal(russianEconomy.name, 'Российская экономика');
  assert.equal(russianEconomy.sourceName, 'Российская экономика: макроядро');
});

test('exact mnemonic is the first and only exact match', async () => {
  const mnemonic = 'OBJCPRM.RU75.RUB.TH.NA.M.DOM.A.AVG.NSA';
  const result = await get(`/api/catalog/search?q=${encodeURIComponent(mnemonic)}`);
  assert.equal(result.payload.items[0].mnemonic, mnemonic);
});

test('block-only query requests refinement instead of mass output', async () => {
  const result = await get('/api/catalog/indicators?block=BLOCK_11_WORLD_ECONOMY');
  assert.equal(result.payload.requiresRefinement, true);
  assert.equal(result.payload.items.length, 0);
  assert.ok(result.payload.total > 0);
});

test('catalog 4 may explicitly render an already selected block', async () => {
  const result = await get('/api/catalog/indicators?block=BLOCK_09_FIN_MARKETS&allowBlockOnly=1');
  assert.equal(result.payload.requiresRefinement, false);
  assert.equal(result.payload.total, 2_292);
  assert.equal(result.payload.items.length, 50);
  assert.ok(result.payload.items.every(item => item.blocks.all.some(block => block.alias === 'BLOCK_09_FIN_MARKETS')));
});

test('empty filter builder does not dump the complete catalog', async () => {
  const result = await get('/api/catalog/indicators');
  assert.equal(result.payload.requiresRefinement, true);
  assert.equal(result.payload.items.length, 0);
  assert.ok(result.payload.total >= 270);
});

test('OR inside one facet and AND between dimensions', async () => {
  const result = await get('/api/catalog/indicators?block=BLOCK_01_DOMCLICK&frequency=M&unit=RUB,TH&allowBlockOnly=1');
  assert.equal(result.payload.requiresRefinement, false);
  assert.ok(result.payload.items.length > 0);
  assert.ok(result.payload.items.every(item => item.frequency.code === 'M' && ['RUB', 'TH'].includes(item.unit.code)));
});

test('cursor pagination does not repeat the first page', async () => {
  const first = await get('/api/catalog/indicators?q=Домклик&limit=2');
  assert.equal(first.payload.items.length, 2);
  const second = await get(`/api/catalog/indicators?q=Домклик&limit=2&cursor=${first.payload.nextCursor}`);
  assert.notEqual(first.payload.items[0].seriesId, second.payload.items[0].seriesId);
});

test('metadata-only series opens without synthetic observations', async () => {
  const result = await get('/api/catalog/indicators/OBJCPRM.RU75.RUB.TH.NA.M.DOM.A.AVG.NSA');
  assert.equal(result.status, 200);
  assert.equal(result.payload.availability.hasTimeSeries, false);
  assert.equal(result.payload.availability.observationCount, 0);
});

test('facets expose four taxonomy groups and concrete geographies', async () => {
  const result = await get('/api/catalog/facets');
  assert.deepEqual(Object.keys(result.payload.taxonomy), ['topics', 'themes', 'subthemes', 'subthemes2']);
  assert.ok(result.payload.attributes.geographies.some(item => item.value === 'RU'));
  assert.ok(result.payload.taxonomy.subthemes2.length > 0);
});

test('hierarchy accepts explicit parent ids and synchronizes geographic leaves', async () => {
  const detail = await get('/api/catalog/indicators/OBJCPRM.RU75.RUB.TH.NA.M.DOM.A.AVG.NSA');
  const path = detail.payload.taxonomy4;
  const query = new URLSearchParams({
    level: 'subtheme2', blockId: 'BLOCK_01_DOMCLICK', topicId: path.topic.alias,
    themeId: path.theme.alias, subthemeId: path.subtheme.alias, geography: 'RU75',
  });
  const result = await get(`/api/catalog/hierarchy?${query}`);
  assert.ok(result.payload.items.some(item => item.alias === path.subtheme2.alias && item.geographyCode === 'RU75'));
});

test('three-level hierarchy is available for catalog 6', async () => {
  const result = await get('/api/catalog/hierarchy?taxonomy=3&level=topic');
  assert.equal(result.status, 200);
  assert.equal(result.payload.taxonomy, '3');
  assert.ok(result.payload.items.length > 0);
});

test('catalog 6 groups before pagination and expands group series', async () => {
  const result = await get('/api/catalog/groups?q=OBJCPRM.RU75.RUB.TH.NA.M.DOM.A.AVG.NSA&limit=1');
  assert.equal(result.status, 200);
  assert.equal(result.payload.items.length, 1);
  const group = result.payload.items[0];
  assert.ok(group.groupId);
  assert.ok(group.seriesCount >= 1);
  assert.equal(Object.hasOwn(group, '_score'), false);
  const series = await get(`/api/catalog/groups/${encodeURIComponent(group.groupId)}/series?limit=1`);
  assert.equal(series.status, 200);
  assert.equal(series.payload.items.length, 1);
  assert.ok(series.payload.total >= group.seriesCount);
  const facets = await get(`/api/catalog/groups/${encodeURIComponent(group.groupId)}/facets`);
  assert.ok(Array.isArray(facets.payload.facets.frequency));
});
