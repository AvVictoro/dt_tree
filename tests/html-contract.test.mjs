import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('shell exposes exactly five requested primary navigation entries', async () => {
  const html = await fs.readFile(new URL('../datatracker-agent-v6.html', import.meta.url), 'utf8');
  const navigation = [...html.matchAll(/class="nav-item(?: active)?" data-view="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(navigation, ['home', 'catalog', 'catalog-1', 'catalog-2', 'catalog-3']);
  for (const view of ['catalog', 'catalog-1', 'catalog-2', 'catalog-3', 'catalog-indicator']) {
    assert.match(html, new RegExp(`id="catalog-mount-${view}"`));
  }
});

test('heavy application datasets are not loaded by the catalog shell', async () => {
  const html = await fs.readFile(new URL('../datatracker-agent-v6.html', import.meta.url), 'utf8');
  for (const source of ['domclick-data.js', 'bank-reports-data.js', 'regional-economy-data.js', 'macro-scenario-data.js', 'banking-liquidity-data.js', 'analytics-apps.js']) {
    assert.doesNotMatch(html, new RegExp(`<script[^>]+${source.replace('.', '\\.')}[^>]*>`));
  }
});
