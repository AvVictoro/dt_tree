const CYRILLIC_MAP = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'
};

export function normalizeSearch(value = '') {
  return String(value)
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[._/\\:;,+()\[\]{}|—–-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function transliterate(value = '') {
  return normalizeSearch(value).replace(/[а-я]/g, letter => CYRILLIC_MAP[letter] ?? letter);
}

export function searchableText(indicator) {
  const taxonomy = indicator.taxonomy4 || {};
  const parts = [
    indicator.mnemonic,
    indicator.name,
    indicator.conceptKey,
    indicator.indicatorCode,
    indicator.geography?.name,
    indicator.geography?.code,
    indicator.source?.code,
    indicator.source?.label,
    taxonomy.topic?.name,
    taxonomy.theme?.name,
    taxonomy.subtheme?.name,
    taxonomy.subtheme2?.name,
    ...(indicator.blocks?.all || []).flatMap(block => [block.alias, block.name])
  ];
  return normalizeSearch(parts.filter(Boolean).join(' '));
}

export function searchScore(indicator, query) {
  const raw = String(query || '').trim();
  const q = normalizeSearch(raw);
  if (!q) return 1;
  const mnemonic = normalizeSearch(indicator.mnemonic);
  const name = normalizeSearch(indicator.name);
  const text = indicator._searchText || searchableText(indicator);
  if (mnemonic === q) return 10_000;
  if (name === q) return 9_000;
  if (mnemonic.startsWith(q)) return 7_500;
  if (name.startsWith(q)) return 7_000;
  const tokens = q.split(' ').filter(Boolean);
  if (tokens.every(token => text.includes(token))) {
    return 5_000 + tokens.reduce((score, token) => score + (name.includes(token) ? 40 : 10), 0);
  }
  const latinQuery = transliterate(q);
  const latinText = transliterate(text);
  if (latinQuery && latinText.includes(latinQuery)) return 2_500;
  return 0;
}

export function rankIndicators(indicators, query) {
  return indicators
    .map(indicator => ({ indicator, score: searchScore(indicator, query) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.indicator.name.localeCompare(b.indicator.name, 'ru'));
}

export function encodeCursor(offset) {
  return Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64url');
}

export function decodeCursor(cursor) {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    return Number.isInteger(parsed.offset) && parsed.offset >= 0 ? parsed.offset : 0;
  } catch {
    return 0;
  }
}
