import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('shell exposes the legacy catalog and ten catalog variants', async () => {
  const html = await fs.readFile(new URL('../datatracker-agent-v6.html', import.meta.url), 'utf8');
  const navigation = [...html.matchAll(/class="nav-item(?: active)?" data-view="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(navigation, ['home', 'catalog', 'catalog-1', 'catalog-2', 'catalog-3', 'catalog-4', 'catalog-5', 'catalog-6', 'catalog-7', 'catalog-8', 'catalog-9', 'catalog-10']);
  for (const view of ['catalog-1', 'catalog-2', 'catalog-3', 'catalog-4', 'catalog-5', 'catalog-6', 'catalog-7', 'catalog-8', 'catalog-9', 'catalog-10', 'catalog-indicator']) {
    assert.match(html, new RegExp(`id="catalog-mount-${view}"`));
  }
  assert.doesNotMatch(html, /id="catalog-mount-catalog"/);
  for (const legacyId of ['cat-input', 'catalog-sidebar', 'cat-tree', 'cat-selbar']) assert.match(html, new RegExp(`id="${legacyId}"`));
});

test('new catalog module does not intercept or render the legacy catalog', async () => {
  const source = await fs.readFile(new URL('../catalog/main.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /renderOverview/);
  assert.doesNotMatch(source, /\['home',\s*'catalog'/);
  assert.match(source, /\['catalog-1', 'catalog-2', 'catalog-3', 'catalog-4', 'catalog-5', 'catalog-6', 'catalog-7', 'catalog-8', 'catalog-9', 'catalog-10'\]/);
  assert.doesNotMatch(source, /3 уровня|4 уровня|catalog-direct-examples/);
  for (const label of ['Топики', 'Темы', 'Сабтемы', 'Сабтемы 2']) assert.match(source, new RegExp(label));
});

test('catalogs 5, 6 and 7 expose their required contracts', async () => {
  const source = await fs.readFile(new URL('../catalog/main.mjs', import.meta.url), 'utf8');
  assert.match(source, /Блоки данных/);
  assert.match(source, /Таксономия/);
  assert.match(source, /Атрибуты/);
  assert.match(source, /Агрегация|агрегация до пагинации/);
  assert.match(source, /Выбрано \$\{all\.length\}\/10/);
  assert.match(source, /Демо-данные/);
  assert.match(source, /CATALOG7_LAYOUT_KEY/);
});

test('catalog 5 follows the legacy database catalog presentation', async () => {
  const source = await fs.readFile(new URL('../catalog/main.mjs', import.meta.url), 'utf8');
  assert.match(source, /catalog5BlockList/);
  assert.match(source, /class="catalog-source/);
  assert.match(source, /class="catalog-results" id="catalog5-results"/);
  assert.match(source, /class="catalog-group"/);
  assert.match(source, /class="catalog-result-row"/);
  assert.match(source, /data-c5-mode="taxonomy"/);
  assert.match(source, /data-c5-mode="attributes"/);
  assert.doesNotMatch(source, /compactBlockList/);
});

test('catalog 8 combines catalog 5 layout with catalog 6 aggregation', async () => {
  const source = await fs.readFile(new URL('../catalog/main.mjs', import.meta.url), 'utf8');
  assert.match(source, /async function renderCatalog8/);
  assert.match(source, /catalog8BlockList/);
  assert.match(source, /class="catalog5-layout catalog8-layout"/);
  assert.match(source, /data-c8-mode="taxonomy"/);
  assert.match(source, /data-c8-mode="attributes"/);
  assert.match(source, /catalogApi\.groups\(params\)/);
  assert.match(source, /Series агрегируются в индикаторы до пагинации/);
  assert.match(source, /bindGroupCards\(resultRoot, view\)/);
});

test('catalog 9 drills down in the left column and keeps only attribute filters', async () => {
  const source = await fs.readFile(new URL('../catalog/main.mjs', import.meta.url), 'utf8');
  assert.match(source, /async function renderCatalog9/);
  assert.match(source, /function catalog9Breadcrumb/);
  assert.match(source, /function catalog9HierarchyList/);
  assert.match(source, /catalog9BlockList/);
  assert.match(source, /Выберите блок данных/);
  assert.match(source, /Последовательный выбор «Блоки данных → Топики → Темы → Сабтемы»/);
  assert.match(source, /facetGroups\(view, ATTRIBUTE_DIMENSIONS, facets, state\)/);
  assert.doesNotMatch(source, /data-c9-mode=/);
  assert.match(source, /catalogApi\.groups\(params\)/);
  assert.match(source, /bindGroupCards\(resultRoot, view\)/);
});

test('catalog 10 adds featured indicators, scoped search and spotlight modal', async () => {
  const source = await fs.readFile(new URL('../catalog/main.mjs', import.meta.url), 'utf8');
  assert.match(source, /async function renderCatalog10/);
  assert.match(source, /Часто используемые/);
  assert.match(source, /500 индикаторов/);
  assert.match(source, /data-c10-scope="global"/);
  assert.match(source, /data-c10-scope="block"/);
  assert.match(source, /function openCatalog10Spotlight/);
  assert.match(source, /async function openCatalog10IndicatorModal/);
  assert.match(source, /event\.shiftKey && event\.key\.toLowerCase\(\) === 'k'/);
  assert.match(source, /params\.featured = 1/);
  assert.doesNotMatch(source, /Все блоки данных/);
  const html = await fs.readFile(new URL('../datatracker-agent-v6.html', import.meta.url), 'utf8');
  assert.match(html, /catalog10-active/);
  assert.match(html, /<div class="top-actions">\s*<button[^>]+data-c10-open-spotlight/);
});

test('catalog 4 combines sequential navigation with prefiltered search mode', async () => {
  const source = await fs.readFile(new URL('../catalog/main.mjs', import.meta.url), 'utf8');
  assert.match(source, /data-jump-search>Перейти к поиску/);
  assert.match(source, /mode === 'search'/);
  assert.match(source, /allowBlockOnly: true/);
  assert.match(source, /Вернуться к навигации/);
});

test('heavy application datasets are not loaded by the catalog shell', async () => {
  const html = await fs.readFile(new URL('../datatracker-agent-v6.html', import.meta.url), 'utf8');
  for (const source of ['domclick-data.js', 'bank-reports-data.js', 'regional-economy-data.js', 'macro-scenario-data.js', 'banking-liquidity-data.js', 'analytics-apps.js']) {
    assert.doesNotMatch(html, new RegExp(`<script[^>]+${source.replace('.', '\\.')}[^>]*>`));
  }
});
