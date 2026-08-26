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
  assert.equal(result.payload.totals.indicators, 1_606_756);
  assert.ok(result.payload.demoIndicators >= 270);
});

test('all fifteen blocks are available', async () => {
  const result = await get('/api/catalog/blocks');
  assert.equal(result.payload.items.length, 15);
  assert.ok(result.payload.items.every(block => block.demoSeries > 0));
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

test('empty filter builder does not dump the complete catalog', async () => {
  const result = await get('/api/catalog/indicators');
  assert.equal(result.payload.requiresRefinement, true);
  assert.equal(result.payload.items.length, 0);
  assert.ok(result.payload.total >= 14_355);
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
