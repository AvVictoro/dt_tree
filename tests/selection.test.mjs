import test from 'node:test';
import assert from 'node:assert/strict';
import { addSelection, removeSelection, selectedItems, smallestFreeSlot, toggleInclude } from '../catalog/lib/selection.mjs';

test('selection keeps stable slots and reuses the smallest free slot', () => {
  const selection = new Map();
  addSelection(selection, { seriesId: 'a' });
  addSelection(selection, { seriesId: 'b' });
  addSelection(selection, { seriesId: 'c' });
  removeSelection(selection, 'b');
  assert.equal(smallestFreeSlot(selection), 1);
  assert.equal(addSelection(selection, { seriesId: 'd' }).item.slot, 1);
  assert.deepEqual(selectedItems(selection).map(item => [item.indicator.seriesId, item.slot]), [['a', 0], ['d', 1], ['c', 2]]);
});

test('selection enforces ten items and keeps include state independent', () => {
  const selection = new Map();
  for (let index = 0; index < 10; index += 1) assert.equal(addSelection(selection, { seriesId: String(index) }).added, true);
  assert.equal(addSelection(selection, { seriesId: 'overflow' }).reason, 'limit');
  toggleInclude(selection, '4', false);
  assert.equal(selection.size, 10);
  assert.equal(selectedItems(selection, { includedOnly: true }).length, 9);
});
