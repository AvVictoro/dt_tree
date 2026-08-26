import test from 'node:test';
import assert from 'node:assert/strict';
import { getBaseIndicatorKey, getIndicatorGroupId, groupSeries } from '../catalog/lib/grouping.mjs';

const taxonomy3 = {
  pathId: 'rates-money-market', path: 'Финансовые рынки › Ставки › Денежный рынок',
  topic: { alias: 'markets', name: 'Финансовые рынки' },
  theme: { alias: 'rates', name: 'Ставки' },
  subtheme: { alias: 'money', name: 'Денежный рынок' },
};

test('base indicator key follows the documented priority', () => {
  assert.equal(getBaseIndicatorKey({ mnemonic: 'RATE,RU,M', indicatorCode: 'OTHER' }), 'RATE');
  assert.equal(getBaseIndicatorKey({ mnemonic: 'RATE.RU.M', indicatorCode: 'CODE' }), 'CODE');
  assert.equal(getBaseIndicatorKey({ mnemonic: 'RATE.RU.M' }), 'RATE');
  assert.equal(getBaseIndicatorKey({ mnemonic: 'RATE' }), 'RATE');
});

test('series are grouped by base key and three-level taxonomy path', () => {
  const members = [
    { seriesId: '1', mnemonic: 'RATE,RU,M', name: 'Ставка', taxonomy3 },
    { seriesId: '2', mnemonic: 'RATE,US,M', name: 'Ставка', taxonomy3 },
    { seriesId: '3', mnemonic: 'RATE,CN,Q', name: 'Процентная ставка', taxonomy3 },
  ];
  const groups = groupSeries(members);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].seriesCount, 3);
  assert.equal(groups[0].name, 'Ставка');
  assert.equal(groups[0].groupId, getIndicatorGroupId(members[0]));
});

test('same base key in another taxonomy path creates another group', () => {
  const a = { seriesId: '1', mnemonic: 'RATE,RU,M', name: 'Ставка', taxonomy3 };
  const b = { ...a, seriesId: '2', taxonomy3: { ...taxonomy3, pathId: 'bank-rates' } };
  assert.equal(groupSeries([a, b]).length, 2);
});
