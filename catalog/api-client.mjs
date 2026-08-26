const cache = new Map();

function queryString(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    const list = Array.isArray(value) ? value : [value];
    list.filter(item => item !== undefined && item !== null && item !== '').forEach(item => search.append(key, String(item)));
  });
  const value = search.toString();
  return value ? `?${value}` : '';
}

async function request(route, params = {}, options = {}) {
  const url = `/api/catalog/${route}${queryString(params)}`;
  const cacheKey = `${options.method || 'GET'}:${url}`;
  if (!options.signal && cache.has(cacheKey)) return cache.get(cacheKey);
  const promise = fetch(url, {
    headers: { accept: 'application/json', ...(options.headers || {}) },
    ...options,
  }).then(async response => {
    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json') ? await response.json() : { error: await response.text() };
    if (!response.ok) {
      const detail = typeof payload.error === 'string' ? payload.error : payload.error?.message;
      throw new Error(detail || `Ошибка API ${response.status}`);
    }
    return payload;
  });
  if (!options.signal && (options.method || 'GET') === 'GET') cache.set(cacheKey, promise);
  return promise;
}

export const catalogApi = {
  manifest: () => request('manifest'),
  blocks: () => request('blocks'),
  hierarchy: params => request('hierarchy', params),
  facets: params => request('facets', params),
  indicators: params => request('indicators', params),
  search: params => request('search', params),
  suggest: (q, signal) => request('suggest', { q }, { signal }),
  indicator: id => request('indicator', { id }),
  groups: params => request('groups', params),
  groupSeries: (groupId, params) => request('group-series', { groupId, ...params }),
  groupFacets: (groupId, params) => request('group-facets', { groupId, ...params }),
};
