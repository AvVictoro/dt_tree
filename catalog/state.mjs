export const CATALOG_VIEWS = new Set(['catalog-1', 'catalog-2', 'catalog-3', 'catalog-4', 'catalog-5', 'catalog-6', 'catalog-7', 'catalog-indicator']);

export function readRoute() {
  const raw = location.hash.startsWith('#/') ? location.hash.slice(2) : '';
  const [path = '', query = ''] = raw.split('?');
  const view = CATALOG_VIEWS.has(path) ? path : null;
  const params = new URLSearchParams(query);
  return { view, params };
}

export function writeRoute(view, state = {}, { replace = false } = {}) {
  const params = new URLSearchParams();
  Object.entries(state).forEach(([key, value]) => {
    const list = Array.isArray(value) ? value : [value];
    list.filter(item => item !== undefined && item !== null && item !== '').forEach(item => params.append(key, String(item)));
  });
  const hash = `#/${view}${params.size ? `?${params}` : ''}`;
  history[replace ? 'replaceState' : 'pushState'](null, '', hash);
}

export function paramsToState(params) {
  const state = {};
  for (const key of new Set(params.keys())) {
    const all = params.getAll(key);
    state[key] = all.length > 1 ? all : all[0];
  }
  return state;
}
