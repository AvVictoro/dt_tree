export function getBaseIndicatorKey(series = {}) {
  const mnemonic = String(series.mnemonic || '').trim();
  if (mnemonic.includes(',')) return mnemonic.split(',')[0].trim();
  if (series.indicatorCode) return String(series.indicatorCode).trim();
  if (mnemonic.includes('.')) return mnemonic.split('.')[0].trim();
  return mnemonic || String(series.seriesId || '').trim();
}

function taxonomyPathKey(series = {}) {
  const taxonomy = series.taxonomy3 || {};
  return taxonomy.pathId || [taxonomy.topic?.alias, taxonomy.theme?.alias, taxonomy.subtheme?.alias].filter(Boolean).join('|') || 'unclassified';
}

export function getIndicatorGroupId(series = {}) {
  return `${getBaseIndicatorKey(series)}::${taxonomyPathKey(series)}`;
}

function canonicalName(nameCounts, fallback) {
  return [...nameCounts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0], 'ru'))[0]?.[0] || fallback;
}

export function groupSeries(seriesItems = []) {
  const groups = new Map();
  for (const series of seriesItems) {
    const groupId = getIndicatorGroupId(series);
    const baseKey = getBaseIndicatorKey(series);
    const current = groups.get(groupId) || {
      groupId,
      indicatorCode: baseKey,
      taxonomy: series.taxonomy3 || null,
      seriesCount: 0,
      series: [],
      _nameCounts: new Map(),
    };
    current.seriesCount += 1;
    current.series.push(series);
    const name = String(series.name || '').trim();
    if (name) current._nameCounts.set(name, (current._nameCounts.get(name) || 0) + 1);
    groups.set(groupId, current);
  }
  return [...groups.values()].map(group => {
    const { _nameCounts, ...clean } = group;
    return { ...clean, name: canonicalName(_nameCounts, group.indicatorCode) };
  });
}
