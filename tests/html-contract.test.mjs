import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('shell exposes the legacy catalog and seven catalog variants', async () => {
  const html = await fs.readFile(new URL('../datatracker-agent-v6.html', import.meta.url), 'utf8');
  const navigation = [...html.matchAll(/class="nav-item(?: active)?" data-view="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(navigation, ['home', 'catalog', 'catalog-1', 'catalog-2', 'catalog-3', 'catalog-4', 'catalog-5', 'catalog-6', 'catalog-7']);
  for (const view of ['catalog-1', 'catalog-2', 'catalog-3', 'catalog-4', 'catalog-5', 'catalog-6', 'catalog-7', 'catalog-indicator']) {
    assert.match(html, new RegExp(`id="catalog-mount-${view}"`));
  }
  assert.doesNotMatch(html, /id="catalog-mount-catalog"/);
  for (const legacyId of ['cat-input', 'catalog-sidebar', 'cat-tree', 'cat-selbar']) assert.match(html, new RegExp(`id="${legacyId}"`));
});

test('new catalog module does not intercept or render the legacy catalog', async () => {
  const source = await fs.readFile(new URL('../catalog/main.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /renderOverview/);
  assert.doesNotMatch(source, /\['home',\s*'catalog'/);
  assert.match(source, /\['catalog-1', 'catalog-2', 'catalog-3', 'catalog-4', 'catalog-5', 'catalog-6', 'catalog-7'\]/);
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
