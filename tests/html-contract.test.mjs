import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('shell exposes exactly five requested primary navigation entries', async () => {
  const html = await fs.readFile(new URL('../datatracker-agent-v6.html', import.meta.url), 'utf8');
  const navigation = [...html.matchAll(/class="nav-item(?: active)?" data-view="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(navigation, ['home', 'catalog', 'catalog-1', 'catalog-2', 'catalog-3']);
  for (const view of ['catalog-1', 'catalog-2', 'catalog-3', 'catalog-indicator']) {
    assert.match(html, new RegExp(`id="catalog-mount-${view}"`));
  }
  assert.doesNotMatch(html, /id="catalog-mount-catalog"/);
  for (const legacyId of ['cat-input', 'catalog-sidebar', 'cat-tree', 'cat-selbar']) assert.match(html, new RegExp(`id="${legacyId}"`));
});

test('new catalog module does not intercept or render the legacy catalog', async () => {
  const source = await fs.readFile(new URL('../catalog/main.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /renderOverview/);
  assert.doesNotMatch(source, /\['home',\s*'catalog'/);
  assert.match(source, /\['catalog-1', 'catalog-2', 'catalog-3'\]/);
  assert.doesNotMatch(source, /3 уровня|4 уровня|catalog-direct-examples/);
  for (const label of ['Топики', 'Темы', 'Сабтемы', 'Сабтемы 2']) assert.match(source, new RegExp(label));
});

test('heavy application datasets are not loaded by the catalog shell', async () => {
  const html = await fs.readFile(new URL('../datatracker-agent-v6.html', import.meta.url), 'utf8');
  for (const source of ['domclick-data.js', 'bank-reports-data.js', 'regional-economy-data.js', 'macro-scenario-data.js', 'banking-liquidity-data.js', 'analytics-apps.js']) {
    assert.doesNotMatch(html, new RegExp(`<script[^>]+${source.replace('.', '\\.')}[^>]*>`));
  }
});
