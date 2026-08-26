import { catalogApi } from './api-client.mjs';
import { CATALOG_VIEWS, paramsToState, readRoute, writeRoute } from './state.mjs';

const VIEW_TITLES = {
  'catalog-1': ['Каталог 1', 'Последовательный переход от блока данных к конкретной группе индикаторов'],
  'catalog-2': ['Каталог 2', 'Конструктор выборки по тематике и атрибутам индикаторов'],
  'catalog-3': ['Каталог 3', 'Прямой поиск по названию, мнемонике и метаданным'],
  'catalog-4': ['Каталог 4', 'Последовательная навигация с быстрым переходом к поиску по выбранному разделу'],
};
const LEVELS = ['topic', 'theme', 'subtheme', 'subtheme2'];
const LEVEL_LABELS = { topic: 'Топики', theme: 'Темы', subtheme: 'Сабтемы', subtheme2: 'Сабтемы 2' };
const FACET_LABELS = {
  topic: 'Топики', theme: 'Темы', subtheme: 'Сабтемы', subtheme2: 'Сабтемы 2',
  source: 'Источники', frequency: 'Частоты', unit: 'Единицы измерения', geography: 'Географии',
};
const appState = new Map();
const nodeCache = new Map();
const expandedFacets = new Set();
let manifest;
let blocks = [];
let suggestionController;
let suggestionTimer;

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const fmt = value => Number(value || 0).toLocaleString('ru-RU');
const asList = value => Array.isArray(value) ? value : value ? [value] : [];

function mount(view) { return document.getElementById(`catalog-mount-${view}`); }
function currentState(view) { return appState.get(view) || {}; }

function header(view) {
  const [title, subtitle] = VIEW_TITLES[view];
  return `<div class="catalog-exp-head"><div><h1>${title}</h1><p>${subtitle}</p></div><span class="catalog-status-badge">Доступно · ${fmt(manifest?.queryableIndicators)}</span></div>`;
}

function searchBox(value = '', placeholder = 'Название, мнемоника или метаданные…', id = 'catalog-query') {
  return `<label class="catalog-searchbox"><span>⌕</span><input id="${id}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off"><kbd>Enter</kbd></label>`;
}

function blockRows() {
  return `<section class="catalog1-level" data-active-level="block"><div class="catalog1-level-head"><span>Блоки данных</span><small>${fmt(blocks.length)}</small></div><div class="catalog1-list">${blocks.map(block => `<button class="catalog1-row" data-block="${esc(block.alias)}"><span class="catalog1-chevron">›</span><span><b>${esc(block.name)}</b><small>${esc(block.description)}</small></span><em>${fmt(block.availableSeries ?? block.totalSeries)}</em></button>`).join('')}</div></section>`;
}

function card(indicator, fromView, fromState) {
  return `<article class="catalog-card" tabindex="0" data-series-id="${esc(indicator.seriesId)}" data-from-view="${esc(fromView)}" data-return-state="${esc(JSON.stringify(fromState))}"><div><h3>${esc(indicator.name)}</h3><div class="catalog-card-code">${esc(indicator.mnemonic)}</div><div class="catalog-card-meta"><span>${esc(indicator.geography?.name || indicator.geography?.code)}</span><span>${esc(indicator.frequency?.label)}</span><span>${esc(indicator.unit?.code)}</span><span>${esc(indicator.source?.label)}</span></div></div><span class="catalog-card-arrow">→</span></article>`;
}

function hasRefinement(state) {
  return Boolean(state.q || LEVELS.some(level => asList(state[level]).length) || ['source', 'frequency', 'unit', 'geography'].some(key => asList(state[key]).length));
}

function cards(response, view, state) {
  if (response.requiresRefinement) {
    const message = state.block && !hasRefinement({ ...state, block: null })
      ? 'Блок выбран. Уточните выбор тематикой, атрибутом или поисковым запросом.'
      : 'Сформируйте выборку с помощью фильтров или поискового запроса.';
    return `<div class="catalog-empty"><div><b>Нужны условия выборки</b>${message}</div></div>`;
  }
  if (!response.items?.length) return '<div class="catalog-empty"><div><b>Ничего не найдено</b>Измените запрос или снимите часть фильтров.</div></div>';
  return `<div class="catalog-result-head"><span>Найдено: ${fmt(response.total)}</span><span>по ${response.limit} на странице</span></div><div class="catalog-result-list">${response.items.map(item => card(item, view, state)).join('')}</div>${response.nextCursor ? `<button class="catalog-loadmore" data-next-cursor="${response.nextCursor}">Следующая страница</button>` : ''}`;
}

function apiParams(state) {
  const allowed = ['q', 'block', ...LEVELS, 'source', 'frequency', 'unit', 'geography', 'cursor', 'limit'];
  return Object.fromEntries(allowed.filter(key => state[key]).map(key => [key, state[key]]));
}

function clearFrom(level, patch = {}) {
  const index = LEVELS.indexOf(level);
  if (index >= 0) LEVELS.slice(index).forEach(key => { patch[key] = null; });
  return patch;
}

function setState(view, patch, options = {}) {
  const next = { ...currentState(view), ...patch };
  Object.keys(next).forEach(key => (next[key] === '' || next[key] == null || (Array.isArray(next[key]) && !next[key].length)) && delete next[key]);
  appState.set(view, next);
  writeRoute(view, next, options);
  render(view);
}

function navigate(view, state = {}) {
  appState.set(view, state);
  writeRoute(view, state);
  window.goto?.(view);
  render(view);
}

function bindResults(root, view) {
  root.querySelectorAll('.catalog-card').forEach(element => {
    const open = () => navigate('catalog-indicator', { id: element.dataset.seriesId, from: element.dataset.fromView, returnState: element.dataset.returnState });
    element.addEventListener('click', open);
    element.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') open(); });
  });
  root.querySelector('.catalog-loadmore')?.addEventListener('click', event => setState(view, { cursor: event.currentTarget.dataset.nextCursor }));
}

async function initData() {
  if (manifest) return;
  [manifest, { items: blocks }] = await Promise.all([catalogApi.manifest(), catalogApi.blocks()]);
  blocks.forEach(block => nodeCache.set(block.alias, block));
}

function hierarchyParams(level, state, extra = {}) {
  const index = LEVELS.indexOf(level);
  return {
    level,
    taxonomy: 4,
    ...(state.block ? { blockId: state.block } : {}),
    ...Object.fromEntries(LEVELS.slice(0, index).filter(key => state[key]).map(key => [`${key}Id`, state[key]])),
    ...extra,
  };
}

async function loadLevel(level, state, extra = {}) {
  const response = await catalogApi.hierarchy(hierarchyParams(level, state, extra));
  response.items.forEach(item => nodeCache.set(item.alias, item));
  return response.items;
}

async function ensurePathNames(state) {
  for (const level of LEVELS) {
    if (!state[level]) break;
    if (!nodeCache.has(state[level])) await loadLevel(level, state);
  }
}

function breadcrumb(state) {
  const parts = ['<button data-back-level="block">Все блоки</button>'];
  if (state.block) parts.push(`<i>›</i><button data-back-level="topic">${esc(nodeCache.get(state.block)?.name || state.block)}</button>`);
  LEVELS.forEach((level, index) => {
    if (state[level]) parts.push(`<i>›</i><button data-back-level="${LEVELS[index + 1] || 'results'}">${esc(nodeCache.get(state[level])?.name || state[level])}</button>`);
  });
  return `<div class="catalog-breadcrumbs">${parts.join('')}</div>`;
}

function nextLevel(state) {
  return LEVELS.find(level => !state[level]) || null;
}

function bindBreadcrumb(root, view) {
  root.querySelectorAll('[data-back-level]').forEach(button => button.addEventListener('click', () => {
    const level = button.dataset.backLevel;
    if (level === 'block') setState(view, clearFrom('topic', { block: null, cursor: null, geography: null }));
    else if (LEVELS.includes(level)) setState(view, clearFrom(level, { cursor: null, geography: level === 'subtheme2' ? null : currentState(view).geography }));
  }));
}

function levelRows(level, items, { showSearchJump = false } = {}) {
  return `<section class="catalog1-level" data-active-level="${level}"><div class="catalog1-level-head"><span>${LEVEL_LABELS[level]}</span><span class="catalog1-level-actions"><small>${fmt(items.length)}</small>${showSearchJump ? '<button class="catalog-search-jump" data-jump-search>Перейти к поиску</button>' : ''}</span></div><div class="catalog1-list">${items.map(node => `<button class="catalog1-row" data-level="${level}" data-alias="${esc(node.alias)}" data-geography="${esc(node.geographyCode || '')}"><span class="catalog1-chevron">›</span><span><b>${esc(node.name)}</b></span><em>${fmt(node.count)}</em></button>`).join('') || '<div class="catalog-empty"><div><b>Нет доступных разделов</b>Для выбранного пути не найден следующий уровень.</div></div>'}</div></section>`;
}

function selectField(dimension, items, state, label) {
  const selected = asList(state[dimension])[0] || '';
  const options = [...items];
  if (selected && !options.some(item => item.value === selected)) options.unshift({ value: selected, label: selected, count: 0 });
  return `<label class="catalog-select"><span>${label}</span><select data-leaf-filter="${dimension}"><option value="">Все</option>${options.map(item => `<option value="${esc(item.value)}" ${selected === item.value ? 'selected' : ''}>${esc(item.label || item.value)} (${fmt(item.count)})</option>`).join('')}</select></label>`;
}

async function renderCatalog1(view = 'catalog-1', { searchJump = false } = {}) {
  const root = mount(view);
  const state = currentState(view);
  await ensurePathNames(state);
  const level = state.block ? nextLevel(state) : 'block';
  root.innerHTML = `${header(view)}${breadcrumb(state)}<div id="catalog1-stage">${state.block ? '<div class="catalog-empty">Загрузка уровня…</div>' : blockRows()}</div>`;
  bindBreadcrumb(root, view);
  root.querySelectorAll('[data-block]').forEach(button => button.addEventListener('click', () => setState(view, clearFrom('topic', { block: button.dataset.block, cursor: null, geography: null }))));
  if (!state.block) return;

  const stage = root.querySelector('#catalog1-stage');
  if (level) {
    const items = await loadLevel(level, state);
    stage.innerHTML = levelRows(level, items, { showSearchJump: searchJump });
    stage.querySelector('[data-jump-search]')?.addEventListener('click', () => setState(view, { mode: 'search', cursor: null }));
    stage.querySelectorAll('[data-level]').forEach(button => button.addEventListener('click', () => {
      const selectedLevel = button.dataset.level;
      const patch = clearFrom(LEVELS[LEVELS.indexOf(selectedLevel) + 1], { [selectedLevel]: button.dataset.alias, cursor: null });
      if (selectedLevel === 'subtheme2') patch.geography = button.dataset.geography || null;
      setState(view, patch);
    }));
    return;
  }

  const facetResponse = await catalogApi.facets(apiParams(state));
  const facets = facetResponse.facets || {};
  stage.innerHTML = `<div class="catalog1-results"><aside class="catalog-panel catalog1-leaf-filters"><div class="catalog-panel-title">Фильтры группы</div>${selectField('geography', facets.geography || [], state, 'География')}${selectField('frequency', facets.frequency || [], state, 'Частота')}${selectField('unit', facets.unit || [], state, 'Единица измерения')}<label class="catalog-select"><span>Поиск внутри группы</span><input data-leaf-query value="${esc(state.q || '')}" placeholder="Название или мнемоника"></label></aside><main id="catalog1-result-list"><div class="catalog-empty">Загрузка индикаторов…</div></main></div>`;
  stage.querySelectorAll('[data-leaf-filter]').forEach(select => select.addEventListener('change', async () => {
    const dimension = select.dataset.leafFilter;
    const patch = { [dimension]: select.value || null, cursor: null };
    if (dimension === 'geography' && select.value) {
      const matches = await loadLevel('subtheme2', { ...state, subtheme2: null }, { geography: select.value });
      if (matches[0]) patch.subtheme2 = matches[0].alias;
    }
    setState(view, patch);
  }));
  const query = stage.querySelector('[data-leaf-query]');
  query.addEventListener('keydown', event => { if (event.key === 'Enter') setState(view, { q: query.value.trim(), cursor: null }); });
  const response = await catalogApi.indicators({ ...apiParams(state), allowBlockOnly: 1 });
  const resultRoot = stage.querySelector('#catalog1-result-list');
  resultRoot.innerHTML = cards(response, view, state);
  bindResults(resultRoot, view);
}

function selectedWithFallback(items, selected) {
  const result = [...(items || [])];
  asList(selected).forEach(value => { if (!result.some(item => item.value === value)) result.unshift({ value, label: value, count: 0 }); });
  return result;
}

function facetGroup(view, dimension, items, state, { searchable = false } = {}) {
  const key = `${view}:${dimension}`;
  const expanded = expandedFacets.has(key);
  const values = selectedWithFallback(items, state[dimension]);
  return `<div class="catalog-filter-group" data-facet-group="${dimension}"><h4><span>${FACET_LABELS[dimension]}</span>${asList(state[dimension]).length ? `<button data-clear-facet="${dimension}">сбросить</button>` : ''}</h4>${searchable ? `<input class="catalog-facet-search" data-facet-search="${dimension}" placeholder="Поиск по ${FACET_LABELS[dimension].toLowerCase()}">` : ''}<div class="catalog-facet-values ${expanded ? 'expanded' : ''}">${values.map((item, index) => `<label class="catalog-check ${!expanded && index >= 10 ? 'catalog-check-more' : ''}" data-facet-label="${esc(String(item.label || item.value).toLowerCase())}"><input type="checkbox" data-facet="${dimension}" value="${esc(item.value)}" ${asList(state[dimension]).includes(item.value) ? 'checked' : ''}><span>${esc(item.label || item.value)}</span><em>${fmt(item.count)}</em></label>`).join('') || '<span class="catalog-card-code">Нет вариантов</span>'}</div>${values.length > 10 ? `<button class="catalog-show-all" data-show-all="${dimension}">${expanded ? 'Свернуть' : `Показать все · ${fmt(values.length)}`}</button>` : ''}</div>`;
}

function bindFacetPanels(root, view) {
  root.querySelectorAll('[data-facet]').forEach(input => input.addEventListener('change', () => {
    const dimension = input.dataset.facet;
    const selected = [...root.querySelectorAll(`[data-facet="${dimension}"]:checked`)].map(item => item.value);
    setState(view, { [dimension]: selected, cursor: null });
  }));
  root.querySelectorAll('[data-clear-facet]').forEach(button => button.addEventListener('click', () => setState(view, { [button.dataset.clearFacet]: null, cursor: null })));
  root.querySelectorAll('[data-show-all]').forEach(button => button.addEventListener('click', () => {
    const key = `${view}:${button.dataset.showAll}`;
    expandedFacets.has(key) ? expandedFacets.delete(key) : expandedFacets.add(key);
    render(view);
  }));
  root.querySelectorAll('[data-facet-search]').forEach(input => input.addEventListener('input', () => {
    const group = input.closest('[data-facet-group]');
    const query = input.value.trim().toLowerCase();
    group.querySelectorAll('[data-facet-label]').forEach(label => { label.hidden = Boolean(query) && !label.dataset.facetLabel.includes(query); });
  }));
}

async function renderCatalog2(view = 'catalog-2', { embedded = false, allowBlockOnly = false } = {}) {
  const root = mount(view);
  const state = currentState(view);
  const context = [state.block, ...LEVELS.map(level => state[level])].filter(Boolean).map(alias => nodeCache.get(alias)?.name || alias).join(' › ');
  const modeBar = embedded ? `<div class="catalog-modebar"><button data-catalog4-back>← Вернуться к навигации</button><span>${esc(context)}</span></div>` : '';
  root.innerHTML = `${header(view)}${modeBar}<div class="catalog-chipbar"><button class="catalog-chip ${!state.block ? 'active' : ''}" data-block="">Все блоки</button>${blocks.map(block => `<button class="catalog-chip ${asList(state.block).includes(block.alias) ? 'active' : ''}" data-block="${esc(block.alias)}">${esc(block.name)}</button>`).join('')}</div>${searchBox(state.q)}<div class="catalog-layout three"><aside class="catalog-panel sticky" id="catalog-attribute-filter"><div class="catalog-empty">Загрузка фильтров…</div></aside><main id="catalog-filter-results"><div class="catalog-empty">Подготавливаю выборку…</div></main><aside class="catalog-panel sticky" id="catalog-taxonomy-filter"><div class="catalog-empty">Загрузка тематик…</div></aside></div>`;
  root.querySelector('[data-catalog4-back]')?.addEventListener('click', () => setState(view, { mode: null, cursor: null }));
  root.querySelectorAll('[data-block]').forEach(button => button.addEventListener('click', () => setState(view, clearFrom('topic', { block: button.dataset.block || null, geography: null, cursor: null }))));
  const input = root.querySelector('#catalog-query');
  input.addEventListener('keydown', event => { if (event.key === 'Enter') setState(view, { q: input.value.trim(), cursor: null }); });
  const [facetResponse, resultResponse] = await Promise.all([
    catalogApi.facets(apiParams(state)),
    catalogApi.indicators({ ...apiParams(state), ...(allowBlockOnly ? { allowBlockOnly: 1 } : {}) }),
  ]);
  const facets = facetResponse.facets || {};
  const attributeRoot = root.querySelector('#catalog-attribute-filter');
  attributeRoot.innerHTML = `<div class="catalog-panel-title">Атрибуты</div>${facetGroup(view, 'geography', facets.geography, state, { searchable: true })}${facetGroup(view, 'frequency', facets.frequency, state)}${facetGroup(view, 'unit', facets.unit, state, { searchable: true })}${facetGroup(view, 'source', facets.source, state, { searchable: true })}`;
  const taxonomyRoot = root.querySelector('#catalog-taxonomy-filter');
  taxonomyRoot.innerHTML = `<div class="catalog-panel-title">Таксономия</div>${facetGroup(view, 'topic', facets.topic, state, { searchable: true })}${facetGroup(view, 'theme', facets.theme, state, { searchable: true })}${facetGroup(view, 'subtheme', facets.subtheme, state, { searchable: true })}${facetGroup(view, 'subtheme2', facets.subtheme2, state, { searchable: true })}`;
  bindFacetPanels(root, view);
  const resultRoot = root.querySelector('#catalog-filter-results');
  resultRoot.innerHTML = cards(resultResponse, view, state);
  bindResults(resultRoot, view);
}

async function renderCatalog3() {
  const view = 'catalog-3';
  const root = mount(view);
  const state = currentState(view);
  root.innerHTML = `${header(view)}<div class="catalog-direct"><div class="catalog-direct-copy"><h2>Какой показатель вы ищете?</h2><p>Введите название, мнемонику, регион, источник или экономический термин</p></div><div class="catalog-suggest">${searchBox(state.q, 'Название, мнемоника, регион или термин', 'catalog-direct-query')}<div id="catalog-suggestions"></div></div><div id="catalog-direct-results" style="margin-top:18px"></div></div>`;
  const input = root.querySelector('#catalog-direct-query');
  const suggestionRoot = root.querySelector('#catalog-suggestions');
  const resultRoot = root.querySelector('#catalog-direct-results');
  let active = -1;
  const submit = value => setState(view, { q: value.trim(), cursor: null });
  const suggest = () => {
    clearTimeout(suggestionTimer); suggestionController?.abort();
    const query = input.value.trim();
    if (!query) { suggestionRoot.innerHTML = ''; return; }
    suggestionTimer = setTimeout(async () => {
      suggestionController = new AbortController();
      try {
        const response = await catalogApi.suggest(query, suggestionController.signal);
        active = -1;
        suggestionRoot.innerHTML = response.items.length ? `<div class="catalog-suggest-list">${response.items.map((item, index) => `<button class="catalog-suggestion" data-suggestion="${index}" data-mnemonic="${esc(item.mnemonic)}"><span><b>${esc(item.name)}</b><span>${esc(item.geography?.name)} · ${esc(item.frequency?.label)}</span></span><code>${esc(item.mnemonic)}</code></button>`).join('')}</div>` : '';
        suggestionRoot.querySelectorAll('[data-suggestion]').forEach(button => button.addEventListener('mousedown', event => { event.preventDefault(); submit(button.dataset.mnemonic); }));
      } catch (error) { if (error.name !== 'AbortError') suggestionRoot.innerHTML = `<div class="catalog-error">${esc(error.message)}</div>`; }
    }, 200);
  };
  input.addEventListener('input', suggest);
  input.addEventListener('keydown', event => {
    const items = [...suggestionRoot.querySelectorAll('[data-suggestion]')];
    if (event.key === 'ArrowDown' && items.length) { event.preventDefault(); active = (active + 1) % items.length; }
    else if (event.key === 'ArrowUp' && items.length) { event.preventDefault(); active = (active - 1 + items.length) % items.length; }
    else if (event.key === 'Enter') { event.preventDefault(); submit(active >= 0 ? items[active].dataset.mnemonic : input.value); return; }
    else if (event.key === 'Escape') { suggestionRoot.innerHTML = ''; return; }
    items.forEach((item, index) => item.classList.toggle('active', index === active));
  });
  if (state.q) {
    const response = await catalogApi.search(apiParams(state));
    resultRoot.innerHTML = cards(response, view, state);
    bindResults(resultRoot, view);
  }
  setTimeout(() => input.focus(), 0);
}

async function renderIndicator() {
  const view = 'catalog-indicator';
  const root = mount(view);
  const state = currentState(view);
  const indicator = await catalogApi.indicator(state.id);
  const taxonomy = indicator.taxonomy4;
  const backLabel = VIEW_TITLES[state.from]?.[0] || 'Каталог 1';
  root.innerHTML = `<div class="catalog-detail"><button class="catalog-detail-back">← Вернуться: ${esc(backLabel)}</button><section class="catalog-detail-hero"><span class="catalog-status-badge">${esc(manifest.dataVersion)}</span><h1>${esc(indicator.name)}</h1><div class="catalog-detail-code">${esc(indicator.mnemonic)}</div><div class="catalog-detail-grid"><div class="catalog-detail-field"><small>Источник</small><b>${esc(indicator.source?.label)}</b></div><div class="catalog-detail-field"><small>География</small><b>${esc(indicator.geography?.name || indicator.geography?.code)}</b></div><div class="catalog-detail-field"><small>Частота</small><b>${esc(indicator.frequency?.label)}</b></div><div class="catalog-detail-field"><small>Единица</small><b>${esc(indicator.unit?.code)}</b></div><div class="catalog-detail-field"><small>Код показателя</small><b>${esc(indicator.indicatorCode)}</b></div><div class="catalog-detail-field"><small>Концепт</small><b>${esc(indicator.conceptKey)}</b></div></div><div class="catalog-path"><b>Тематический путь:</b> ${esc(taxonomy?.path || [taxonomy?.topic?.name, taxonomy?.theme?.name, taxonomy?.subtheme?.name, taxonomy?.subtheme2?.name].filter(Boolean).join(' › '))}<br><b>Блоки:</b> ${esc((indicator.blocks?.all || []).map(block => block.name).join(' · '))}</div>${indicator.availability?.hasTimeSeries ? '<div id="catalog-indicator-chart"></div>' : '<div class="catalog-no-chart">Для этой записи доступны классификационные метаданные. Наблюдения временного ряда отсутствуют, поэтому график не строится.</div>'}</section></div>`;
  root.querySelector('.catalog-detail-back').addEventListener('click', () => {
    let returnState = {};
    try { returnState = JSON.parse(state.returnState || '{}'); } catch { returnState = {}; }
    navigate(state.from && CATALOG_VIEWS.has(state.from) ? state.from : 'catalog-1', returnState);
  });
}

async function render(view) {
  const root = mount(view);
  if (!root) return;
  root.innerHTML = '<div class="catalog-empty">Загрузка каталога…</div>';
  try {
    await initData();
    if (view === 'catalog-1') await renderCatalog1(view);
    if (view === 'catalog-2') await renderCatalog2(view);
    if (view === 'catalog-3') await renderCatalog3();
    if (view === 'catalog-4') {
      if (currentState(view).mode === 'search') await renderCatalog2(view, { embedded: true, allowBlockOnly: true });
      else await renderCatalog1(view, { searchJump: true });
    }
    if (view === 'catalog-indicator') await renderIndicator();
  } catch (error) {
    root.innerHTML = `<div class="catalog-error"><b>Каталог не загрузился.</b> ${esc(error.message)}</div>`;
  }
}

async function activateRoute() {
  const route = readRoute();
  if (!route.view) return;
  appState.set(route.view, paramsToState(route.params));
  window.goto?.(route.view);
  await render(route.view);
}

document.addEventListener('click', event => {
  const item = event.target.closest('.nav-item[data-view]');
  if (!item || !['catalog-1', 'catalog-2', 'catalog-3', 'catalog-4'].includes(item.dataset.view)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  navigate(item.dataset.view, currentState(item.dataset.view));
}, true);

window.addEventListener('popstate', activateRoute);
window.addEventListener('hashchange', activateRoute);
window.catalogApp = { render, navigate, activateRoute };
activateRoute();
