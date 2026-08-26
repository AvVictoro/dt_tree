import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeCursor, encodeCursor, normalizeSearch, searchScore, transliterate } from '../catalog/lib/search.mjs';

const indicator = {
  mnemonic: 'OBJCPRM.RU75.RUB.TH.NA.M.DOM.A.AVG.NSA',
  name: 'Средняя стоимость объекта жилой недвижимости на первичном рынке',
  geography: { name: 'Забайкальский край', code: 'RU75' },
  source: { code: 'DOM', label: 'DOM' },
  taxonomy4: { topic: { name: 'Недвижимость и строительство' } },
  blocks: { all: [] },
};

test('нормализация учитывает пунктуацию, регистр и ё', () => {
  assert.equal(normalizeSearch('  СТАВКИ—По.Ипотеке  '), 'ставки по ипотеке');
  assert.equal(normalizeSearch('Объём'), 'объем');
});

test('транслитерация поддерживает латинский запрос к русскому имени', () => {
  assert.equal(transliterate('Москва'), 'moskva');
});

test('точная мнемоника имеет максимальный ранг', () => {
  assert.equal(searchScore(indicator, indicator.mnemonic), 10_000);
  assert.ok(searchScore(indicator, 'недвижимость первичном') > 0);
  assert.equal(searchScore(indicator, 'несуществующий термин'), 0);
});

test('курсор безопасно кодирует смещение', () => {
  assert.equal(decodeCursor(encodeCursor(125)), 125);
  assert.equal(decodeCursor('broken'), 0);
});
