export const MAX_SELECTION = 10;

export function smallestFreeSlot(selection) {
  const used = new Set([...selection.values()].map(item => item.slot));
  for (let slot = 0; slot < MAX_SELECTION; slot += 1) if (!used.has(slot)) return slot;
  return -1;
}

export function addSelection(selection, indicator) {
  const id = String(indicator.seriesId);
  if (selection.has(id)) return { added: false, reason: 'exists', item: selection.get(id) };
  const slot = smallestFreeSlot(selection);
  if (slot < 0) return { added: false, reason: 'limit' };
  const item = { indicator, slot, includeInData: true };
  selection.set(id, item);
  return { added: true, item };
}

export function removeSelection(selection, seriesId) {
  return selection.delete(String(seriesId));
}

export function toggleInclude(selection, seriesId, included) {
  const item = selection.get(String(seriesId));
  if (!item) return false;
  item.includeInData = Boolean(included);
  return true;
}

export function selectedItems(selection, { includedOnly = false } = {}) {
  return [...selection.values()]
    .filter(item => !includedOnly || item.includeInData)
    .sort((a, b) => a.slot - b.slot);
}
