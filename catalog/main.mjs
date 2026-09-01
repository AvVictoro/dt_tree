import { catalogApi } from './api-client.mjs';
import { CATALOG7_COLORS, CATALOG7_DATES, CATALOG7_SERIES } from './data/catalog7-timeseries.mjs';
import { addSelection, removeSelection, selectedItems, toggleInclude } from './lib/selection.mjs';
import { CATALOG_VIEWS, paramsToState, readRoute, writeRoute } from './state.mjs';

const VIEW_TITLES = {
  'catalog-1': ['Каталог 1', 'Последовательный переход от блока данных к конкретной группе индикаторов'],
  'catalog-2': ['Каталог 2', 'Конструктор выборки по тематике и атрибутам индикаторов'],
  'catalog-3': ['Каталог 3', 'Прямой поиск по названию, мнемонике и метаданным'],
  'catalog-4': ['Каталог 4', 'Последовательная навигация с быстрым переходом к поиску по выбранному разделу'],
  'catalog-5': ['Каталог 5', 'Быстрая выборка внутри одного блока данных с единым набором фильтров'],
  'catalog-6': ['Каталог 6', 'Трёхуровневая навигация по агрегированным группам показателей'],
  'catalog-7': ['Каталог 7', 'Выбор индикаторов и рабочая область для сопоставления данных'],
  'catalog-8': ['Каталог 8', 'Выборка агрегированных индикаторов внутри блока данных'],
  'catalog-9': ['Каталог 9', 'Последовательный выбор раздела с агрегированной выдачей индикаторов'],
  'catalog-10': ['Каталог 10', 'Компактная выдача, часто используемые индикаторы и быстрый поиск'],
};
const LEVELS = ['topic', 'theme', 'subtheme', 'subtheme2'];
const GROUP_LEVELS = ['topic', 'theme', 'subtheme'];
const LEVEL_LABELS = { topic: 'Топики', theme: 'Темы', subtheme: 'Сабтемы', subtheme2: 'Сабтемы 2' };
const FACET_LABELS = {
  topic: 'Топики', theme: 'Темы', subtheme: 'Сабтемы', subtheme2: 'Сабтемы 2',
  source: 'Источники', frequency: 'Частоты', unit: 'Единицы измерения', geographyScope: 'Типы географии', geography: 'Географии',
};
const ATTRIBUTE_DIMENSIONS = ['geographyScope', 'geography', 'frequency', 'unit', 'source'];
const appState = new Map();
const nodeCache = new Map();
const expandedFacets = new Set();
const catalog6Expanded = new Set();
const catalog6Panels = new Map();
const catalog8Expanded = new Set();
const catalog8Panels = new Map();
const catalog9Expanded = new Set();
const catalog9Panels = new Map();
const catalog10Expanded = new Set();
const catalog10Panels = new Map();
const catalog7Selection = new Map();
const CATALOG7_LAYOUT_KEY = 'dt.catalog7.layout.v1';
const DEFAULT_CATALOG7_LAYOUT = { showTaxonomy: true, showAttributes: true, showResults: true, showAnalysis: false, analysisWidth: 430, tab: 'list' };
let manifest;
let blocks = [];
let suggestionController;
let suggestionTimer;

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const fmt = value => Number(value || 0).toLocaleString('ru-RU');
const asList = value => Array.isArray(value) ? value : value ? [value] : [];

function ruPlural(value, one, few, many) {
  const number = Math.abs(Number(value || 0));
  const mod100 = number % 100;
  const mod10 = number % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

function indicatorCount(value) {
  return `${fmt(value)} ${ruPlural(value, 'индикатор', 'индикатора', 'индикаторов')}`;
}

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

function card(indicator, fromView, fromState, { selectable = false } = {}) {
  const selected = catalog7Selection.has(String(indicator.seriesId));
  const selector = selectable ? `<label class="catalog-card-selector" title="Добавить в рабочую область"><input type="checkbox" data-select-series="${esc(indicator.seriesId)}" ${selected ? 'checked' : ''}><span></span></label>` : '';
  return `<article class="catalog-card ${selectable ? 'selectable' : ''}" tabindex="0" data-series-id="${esc(indicator.seriesId)}" data-from-view="${esc(fromView)}" data-return-state="${esc(JSON.stringify(fromState))}">${selector}<div><h3>${esc(indicator.name)}</h3><div class="catalog-card-code">${esc(indicator.mnemonic)}</div><div class="catalog-card-meta"><span>${esc(indicator.geography?.name || indicator.geography?.code)}</span><span>${esc(indicator.frequency?.label)}</span><span>${esc(indicator.unit?.code)}</span><span>${esc(indicator.source?.label)}</span></div></div><span class="catalog-card-arrow">→</span></article>`;
}

function hasRefinement(state) {
  return Boolean(state.q || LEVELS.some(level => asList(state[level]).length) || ATTRIBUTE_DIMENSIONS.some(key => asList(state[key]).length));
}

function cards(response, view, state, options = {}) {
  if (response.requiresRefinement) {
    const message = state.block && !hasRefinement({ ...state, block: null })
      ? 'Блок выбран. Уточните выбор тематикой, атрибутом или поисковым запросом.'
      : 'Сформируйте выборку с помощью фильтров или поискового запроса.';
    return `<div class="catalog-empty"><div><b>Нужны условия выборки</b>${message}</div></div>`;
  }
  if (!response.items?.length) return '<div class="catalog-empty"><div><b>Ничего не найдено</b>Измените запрос или снимите часть фильтров.</div></div>';
  return `<div class="catalog-result-head"><span>Найдено: ${fmt(response.total)}</span><span>по ${response.limit} на странице</span></div><div class="catalog-result-list">${response.items.map(item => card(item, view, state, options)).join('')}</div>${response.nextCursor ? `<button class="catalog-loadmore" data-next-cursor="${response.nextCursor}">Следующая страница</button>` : ''}`;
}

function apiParams(state) {
  const allowed = ['q', 'block', ...LEVELS, ...ATTRIBUTE_DIMENSIONS, 'cursor', 'limit'];
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
  root.querySelectorAll('.catalog-card, .catalog-result-row[data-series-id]').forEach(element => {
    const open = () => navigate('catalog-indicator', { id: element.dataset.seriesId, from: element.dataset.fromView, returnState: element.dataset.returnState });
    element.addEventListener('click', event => { if (!event.target.closest('[data-select-series]')) open(); });
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

function facetGroup(view, dimension, items, state, { searchable = false, label = FACET_LABELS[dimension] } = {}) {
  const key = `${view}:${dimension}`;
  const expanded = expandedFacets.has(key);
  const values = selectedWithFallback(items, state[dimension]);
  return `<div class="catalog-filter-group" data-facet-group="${dimension}"><h4><span>${esc(label)}</span>${asList(state[dimension]).length ? `<button data-clear-facet="${dimension}">сбросить</button>` : ''}</h4>${searchable ? `<input class="catalog-facet-search" data-facet-search="${dimension}" placeholder="Поиск по ${esc(label.toLowerCase())}">` : ''}<div class="catalog-facet-values ${expanded ? 'expanded' : ''}">${values.map((item, index) => `<label class="catalog-check ${!expanded && index >= 10 ? 'catalog-check-more' : ''}" data-facet-label="${esc(String(item.label || item.value).toLowerCase())}"><input type="checkbox" data-facet="${dimension}" value="${esc(item.value)}" ${asList(state[dimension]).includes(item.value) ? 'checked' : ''}><span>${esc(item.label || item.value)}</span><em>${fmt(item.count)}</em></label>`).join('') || '<span class="catalog-card-code">Нет вариантов</span>'}</div>${values.length > 10 ? `<button class="catalog-show-all" data-show-all="${dimension}">${expanded ? 'Свернуть' : `Показать все · ${fmt(values.length)}`}</button>` : ''}</div>`;
}

function facetGroups(view, dimensions, facets, state, labels = {}) {
  return dimensions.map(dimension => facetGroup(view, dimension, facets[dimension], state, {
    searchable: ['topic', 'theme', 'subtheme', 'subtheme2', 'geography', 'unit', 'source'].includes(dimension),
    label: labels[dimension] || FACET_LABELS[dimension],
  })).join('');
}

function bindFacetPanels(root, view, { dependentTaxonomy = false, renderAfter = true } = {}) {
  root.querySelectorAll('[data-facet]').forEach(input => input.addEventListener('change', () => {
    const dimension = input.dataset.facet;
    const selected = [...root.querySelectorAll(`[data-facet="${dimension}"]:checked`)].map(item => item.value);
    const patch = { [dimension]: selected, cursor: null };
    if (dependentTaxonomy && LEVELS.includes(dimension)) {
      LEVELS.slice(LEVELS.indexOf(dimension) + 1).forEach(key => { patch[key] = null; });
    }
    if (renderAfter) setState(view, patch);
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
  attributeRoot.innerHTML = `<div class="catalog-panel-title">Атрибуты</div>${facetGroups(view, ATTRIBUTE_DIMENSIONS, facets, state)}`;
  const taxonomyRoot = root.querySelector('#catalog-taxonomy-filter');
  taxonomyRoot.innerHTML = `<div class="catalog-panel-title">Таксономия</div>${facetGroups(view, LEVELS, facets, state)}`;
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

function clearFilterPatch() {
  return Object.fromEntries([...LEVELS, ...ATTRIBUTE_DIMENSIONS, 'cursor'].map(key => [key, null]));
}

function catalogBlockList(state, prefix, unitLabel) {
  return `<aside class="catalog-sidebar catalog5-blocks"><div class="catalog-filter-title">Блоки данных</div><div class="catalog5-block-list">${blocks.map((block, index) => `<button type="button" data-${prefix}-block="${esc(block.alias)}" class="catalog-source ${state.block === block.alias ? 'active' : ''}"><span class="catalog-source-icon">${String(index + 1).padStart(2, '0')}</span><span>${esc(block.name)}<small>${fmt(block.totalSeries ?? block.availableSeries)} ${unitLabel}</small></span><span>›</span></button>`).join('')}</div></aside>`;
}

function catalog5BlockList(state) {
  return catalogBlockList(state, 'c5', 'показателей');
}

function catalog8BlockList(state) {
  return catalogBlockList(state, 'c8', 'series');
}

function catalog9BlockList(state) {
  return catalogBlockList(state, 'c9', 'series');
}

function catalog5ResultRow(indicator, view, state) {
  const taxonomy = indicator.taxonomy4 || {};
  const path = ['topic', 'theme', 'subtheme', 'subtheme2'].map(level => taxonomy[level]?.name).filter(Boolean);
  const meta = [indicator.mnemonic, path.join(' › ')].filter(Boolean).join(' · ');
  return `<article class="catalog-result-row" tabindex="0" data-series-id="${esc(indicator.seriesId)}" data-from-view="${esc(view)}" data-return-state="${esc(JSON.stringify(state))}"><span class="catalog5-row-open" aria-hidden="true">›</span><div><div class="title">${esc(indicator.name)}</div><div class="meta">${esc(meta)}</div></div><span class="source-pill">${esc(indicator.source?.label || 'Источник')}</span></article>`;
}

function catalog5Results(response, view, state) {
  if (!response.items?.length) return '<div class="catalog-empty"><div><b>Ничего не найдено</b>Измените запрос или снимите часть фильтров.</div></div>';
  const groups = new Map();
  response.items.forEach(indicator => {
    const topic = indicator.taxonomy4?.topic?.name || 'Без топика';
    const theme = indicator.taxonomy4?.theme?.name || 'Без темы';
    const key = `${topic}||${theme}`;
    if (!groups.has(key)) groups.set(key, { topic, theme, items: [] });
    groups.get(key).items.push(indicator);
  });
  const body = [...groups.values()].map((group, index) => `<details class="catalog-group" ${state.q || index < 2 ? 'open' : ''}><summary><span>${esc(group.topic)} · ${esc(group.theme)}</span><span class="catalog-group-count">${fmt(group.items.length)}</span></summary>${group.items.map(indicator => catalog5ResultRow(indicator, view, state)).join('')}</details>`).join('');
  return `${body}${response.nextCursor ? `<button class="catalog-loadmore" data-next-cursor="${esc(response.nextCursor)}">Следующая страница</button>` : ''}`;
}

async function renderCatalog5() {
  const view = 'catalog-5';
  const root = mount(view);
  const state = currentState(view);
  if (!state.block && blocks[0]) {
    setState(view, { block: blocks[0].alias }, { replace: true });
    return;
  }
  const filterMode = state.filterMode === 'attributes' ? 'attributes' : 'taxonomy';
  const activeBlock = blocks.find(block => block.alias === state.block);
  root.innerHTML = `<div class="catalog5-head"><h1 class="h1">Каталог 5</h1><p class="h1-sub">Поиск по блокам данных, таксономии и атрибутам показателей</p></div><div class="cat-top catalog5-search"><div class="cat-search"><span class="sp">⌕</span><input id="catalog5-query" value="${esc(state.q || '')}" placeholder="Поиск внутри выбранного блока…" autocomplete="off"><span class="cnt" id="catalog5-count">${fmt(activeBlock?.totalSeries ?? activeBlock?.availableSeries)} показателей</span></div></div><div class="catalog5-layout">${catalog5BlockList(state)}<main class="catalog-results" id="catalog5-results"><div class="catalog-results-head"><b>${esc(activeBlock?.name || 'Показатели')}</b><span class="count">загрузка…</span></div><div class="catalog-empty"><div><b>Подготавливаю выборку…</b>Загружаю индикаторы и доступные фильтры.</div></div></main><aside class="catalog-sidebar catalog5-filter-sidebar" id="catalog5-filter"><div class="catalog5-segment"><button type="button" data-c5-mode="taxonomy" class="${filterMode === 'taxonomy' ? 'active' : ''}">Таксономия</button><button type="button" data-c5-mode="attributes" class="${filterMode === 'attributes' ? 'active' : ''}">Атрибуты</button></div><div id="catalog5-filter-content"><div class="catalog-empty"><div><b>Фильтры</b>Загружаю доступные значения.</div></div></div></aside></div>`;
  const input = root.querySelector('#catalog5-query');
  input.addEventListener('keydown', event => { if (event.key === 'Enter') setState(view, { q: input.value.trim(), cursor: null }); });
  root.querySelectorAll('[data-c5-mode]').forEach(button => button.addEventListener('click', () => setState(view, { filterMode: button.dataset.c5Mode }, { replace: true })));
  root.querySelectorAll('[data-c5-block]').forEach(button => button.addEventListener('click', () => setState(view, {
    ...clearFilterPatch(), block: button.dataset.c5Block, q: null,
  })));
  if (!state.block) return;
  const [facetResponse, resultResponse] = await Promise.all([
    catalogApi.facets(apiParams(state)),
    catalogApi.indicators({ ...apiParams(state), allowBlockOnly: 1 }),
  ]);
  const facets = facetResponse.facets || {};
  const filterRoot = root.querySelector('#catalog5-filter-content');
  filterRoot.innerHTML = filterMode === 'taxonomy'
    ? `<div class="catalog-filter-title">Таксономия</div>${facetGroups(view, LEVELS.filter(level => facets[level]?.length), facets, state)}`
    : `<div class="catalog-filter-title">Атрибуты</div>${facetGroups(view, ATTRIBUTE_DIMENSIONS, facets, state)}`;
  bindFacetPanels(filterRoot, view, { dependentTaxonomy: true });
  const resultRoot = root.querySelector('#catalog5-results');
  resultRoot.innerHTML = `<div class="catalog-results-head"><b>${esc(activeBlock?.name || 'Показатели')}</b><span class="count">${fmt(resultResponse.total)} найдено</span></div>${catalog5Results(resultResponse, view, state)}`;
  root.querySelector('#catalog5-count').textContent = `${fmt(resultResponse.total)} показателей`;
  bindResults(resultRoot, view);
}

function groupHierarchyParams(level, state) {
  const index = GROUP_LEVELS.indexOf(level);
  return {
    level, taxonomy: 3,
    ...(state.block ? { blockId: state.block } : {}),
    ...Object.fromEntries(GROUP_LEVELS.slice(0, index).filter(key => state[key]).map(key => [`${key}Id`, state[key]])),
  };
}

async function loadGroupLevel(level, state) {
  const response = await catalogApi.hierarchy(groupHierarchyParams(level, state));
  response.items.forEach(item => nodeCache.set(`3:${item.alias}`, item));
  return response.items;
}

function groupBreadcrumb(state) {
  const parts = ['<button data-c6-back="topic">Все темы</button>'];
  GROUP_LEVELS.forEach((level, index) => {
    if (state[level]) parts.push(`<i>›</i><button data-c6-back="${GROUP_LEVELS[index + 1] || 'results'}">${esc(nodeCache.get(`3:${state[level]}`)?.name || state[level])}</button>`);
  });
  return `<div class="catalog-breadcrumbs">${parts.join('')}</div>`;
}

function groupSummary(group, view, state) {
  const expanded = groupViewContext(view).expanded.has(group.groupId);
  const seriesLabel = ['catalog-8', 'catalog-9', 'catalog-10'].includes(view) ? 'series' : ruPlural(group.seriesCount, 'ряд', 'ряда', 'рядов');
  return `<article class="catalog6-group" data-group-id="${esc(group.groupId)}"><button class="catalog6-group-head" data-toggle-group aria-expanded="${expanded}"><span><b>${esc(group.name)}</b><code>${esc(group.indicatorCode)}</code><small>${esc(group.taxonomy?.path || [group.taxonomy?.topic?.name, group.taxonomy?.theme?.name, group.taxonomy?.subtheme?.name].filter(Boolean).join(' › '))}</small></span><span><em>${fmt(group.seriesCount)} ${seriesLabel}</em><i>${expanded ? '−' : '+'}</i></span></button><div class="catalog6-group-body" ${expanded ? '' : 'hidden'}>${expanded ? `<div class="catalog-empty">Загрузка ${seriesLabel}…</div>` : ''}</div></article>`;
}

function groupViewContext(view) {
  if (view === 'catalog-10') return { expanded: catalog10Expanded, panels: catalog10Panels };
  if (view === 'catalog-9') return { expanded: catalog9Expanded, panels: catalog9Panels };
  if (view === 'catalog-8') return { expanded: catalog8Expanded, panels: catalog8Panels };
  return { expanded: catalog6Expanded, panels: catalog6Panels };
}

function groupSeriesParams(panel, cursor = null) {
  return { q: panel.q, ...panel.filters, cursor, limit: 20 };
}

function groupFacetSelect(key, items, selected) {
  if (!items || items.length <= 1) return '';
  return `<label class="catalog-select"><span>${FACET_LABELS[key]}</span><select data-group-series-filter="${key}"><option value="">Все</option>${items.map(item => `<option value="${esc(item.value)}" ${selected === item.value ? 'selected' : ''}>${esc(item.label || item.value)} (${fmt(item.count)})</option>`).join('')}</select></label>`;
}

function renderGroupPanel(groupId, body, panel, view) {
  const items = panel.items || [];
  const isAggregatedCatalog = ['catalog-8', 'catalog-9', 'catalog-10'].includes(view);
  const memberLabel = isAggregatedCatalog ? 'Series' : 'Рядов';
  const emptyMemberLabel = isAggregatedCatalog ? 'Series' : 'Ряды';
  const groupLabel = isAggregatedCatalog ? 'индикатора' : 'группы';
  body.innerHTML = `<div class="catalog6-series-tools"><label class="catalog-select"><span>Поиск внутри ${groupLabel}</span><input data-group-series-query value="${esc(panel.q || '')}" placeholder="Мнемоника, география или название"></label>${ATTRIBUTE_DIMENSIONS.map(key => groupFacetSelect(key, panel.facets?.[key], panel.filters?.[key])).join('')}</div><div class="catalog6-series-result">${items.length ? `<div class="catalog-result-head"><span>${memberLabel}: ${fmt(panel.total)}</span><span>показано ${fmt(items.length)}</span></div><div class="catalog-result-list">${items.map(item => card(item, view, currentState(view))).join('')}</div>${panel.nextCursor ? '<button class="catalog-loadmore" data-group-more>Показать ещё</button>' : ''}` : `<div class="catalog-empty"><div><b>${emptyMemberLabel} не найдены</b>Измените фильтры внутри ${groupLabel}.</div></div>`}</div>`;
  const query = body.querySelector('[data-group-series-query]');
  query?.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    panel.q = query.value.trim(); panel.items = []; panel.cursor = null;
    loadGroupPanel(groupId, body, { view });
  });
  body.querySelectorAll('[data-group-series-filter]').forEach(select => select.addEventListener('change', () => {
    panel.filters[select.dataset.groupSeriesFilter] = select.value || null;
    panel.items = []; panel.cursor = null;
    loadGroupPanel(groupId, body, { view });
  }));
  body.querySelector('[data-group-more]')?.addEventListener('click', () => loadGroupPanel(groupId, body, { view, append: true, cursor: panel.nextCursor }));
  bindResults(body, view);
}

async function loadGroupPanel(groupId, body, { view = 'catalog-6', append = false, cursor = null } = {}) {
  const context = groupViewContext(view);
  const isAggregatedCatalog = ['catalog-8', 'catalog-9', 'catalog-10'].includes(view);
  const panel = context.panels.get(groupId) || { q: '', filters: {}, items: [], cursor: null, facets: null };
  context.panels.set(groupId, panel);
  body.hidden = false;
  body.innerHTML = `<div class="catalog-empty">${isAggregatedCatalog ? 'Загрузка series индикатора…' : 'Загрузка рядов группы…'}</div>`;
  try {
    const [series, facetResponse] = await Promise.all([
      catalogApi.groupSeries(groupId, groupSeriesParams(panel, cursor)),
      catalogApi.groupFacets(groupId, groupSeriesParams(panel)),
    ]);
    panel.items = append ? [...panel.items, ...series.items] : series.items;
    panel.total = series.total;
    panel.nextCursor = series.nextCursor;
    panel.facets = facetResponse.facets || series.facets || {};
    renderGroupPanel(groupId, body, panel, view);
  } catch (error) {
    body.innerHTML = `<div class="catalog-error"><b>Не удалось загрузить ${isAggregatedCatalog ? 'series' : 'ряды'}.</b> ${esc(error.message)} <button data-group-retry>Повторить</button></div>`;
    body.querySelector('[data-group-retry]')?.addEventListener('click', () => loadGroupPanel(groupId, body, { view }));
  }
}

function bindGroupCards(root, view = 'catalog-6') {
  const context = groupViewContext(view);
  root.querySelectorAll('.catalog6-group').forEach(group => {
    const groupId = group.dataset.groupId;
    const body = group.querySelector('.catalog6-group-body');
    group.querySelector('[data-toggle-group]').addEventListener('click', () => {
      if (context.expanded.has(groupId)) {
        context.expanded.delete(groupId); body.hidden = true;
        group.querySelector('[data-toggle-group]').setAttribute('aria-expanded', 'false');
        group.querySelector('[data-toggle-group] i').textContent = '+';
      } else {
        context.expanded.add(groupId);
        group.querySelector('[data-toggle-group]').setAttribute('aria-expanded', 'true');
        group.querySelector('[data-toggle-group] i').textContent = '−';
        loadGroupPanel(groupId, body, { view });
      }
    });
    if (context.expanded.has(groupId)) loadGroupPanel(groupId, body, { view });
  });
}

async function renderCatalog6() {
  const view = 'catalog-6';
  const root = mount(view);
  const state = currentState(view);
  const level = GROUP_LEVELS.find(key => !state[key]);
  const showGroups = !level || Boolean(state.q);
  root.innerHTML = `${header(view)}<div class="catalog-chipbar"><button class="catalog-chip ${!state.block ? 'active' : ''}" data-c6-block="">Все блоки</button>${blocks.map(block => `<button class="catalog-chip ${state.block === block.alias ? 'active' : ''}" data-c6-block="${esc(block.alias)}">${esc(block.name)}</button>`).join('')}</div>${searchBox(state.q, 'Поиск по любой серии внутри группы…', 'catalog6-query')}${groupBreadcrumb(state)}<div id="catalog6-stage"><div class="catalog-empty">Загрузка…</div></div>`;
  root.querySelectorAll('[data-c6-block]').forEach(button => button.addEventListener('click', () => setState(view, { ...clearFilterPatch(), block: button.dataset.c6Block || null, q: null })));
  const input = root.querySelector('#catalog6-query');
  input.addEventListener('keydown', event => { if (event.key === 'Enter') setState(view, { q: input.value.trim(), cursor: null }); });
  root.querySelectorAll('[data-c6-back]').forEach(button => button.addEventListener('click', () => {
    const target = button.dataset.c6Back;
    const index = GROUP_LEVELS.indexOf(target);
    const patch = { q: null, cursor: null };
    (index < 0 ? GROUP_LEVELS : GROUP_LEVELS.slice(index)).forEach(key => { patch[key] = null; });
    setState(view, patch);
  }));
  const stage = root.querySelector('#catalog6-stage');
  if (!showGroups) {
    const items = await loadGroupLevel(level, state);
    stage.innerHTML = levelRows(level, items).replaceAll('data-level=', 'data-c6-level=');
    stage.querySelectorAll('[data-c6-level]').forEach(button => button.addEventListener('click', () => {
      const selectedLevel = button.dataset.c6Level;
      const patch = { [selectedLevel]: button.dataset.alias, q: null, cursor: null };
      GROUP_LEVELS.slice(GROUP_LEVELS.indexOf(selectedLevel) + 1).forEach(key => { patch[key] = null; });
      setState(view, patch);
    }));
    return;
  }
  const params = { ...apiParams(state), taxonomy: 3 };
  const [facetResponse, groupResponse] = await Promise.all([catalogApi.facets(params), catalogApi.groups(params)]);
  const facets = facetResponse.facets || {};
  stage.innerHTML = `<div class="catalog-layout"><aside class="catalog-panel sticky"><div class="catalog-panel-title">Атрибуты групп</div>${facetGroups(view, ATTRIBUTE_DIMENSIONS, facets, state)}</aside><main id="catalog6-groups">${groupResponse.items?.length ? `<div class="catalog-result-head"><span>Групп: ${fmt(groupResponse.total)}</span><span>агрегация до пагинации</span></div>${groupResponse.items.map(group => groupSummary(group, view, state)).join('')}${groupResponse.nextCursor ? `<button class="catalog-loadmore" data-next-cursor="${groupResponse.nextCursor}">Следующая страница групп</button>` : ''}` : '<div class="catalog-empty"><div><b>Группы не найдены</b>Измените путь, фильтры или поисковый запрос.</div></div>'}</main></div>`;
  bindFacetPanels(stage, view);
  stage.querySelector('[data-next-cursor]')?.addEventListener('click', event => setState(view, { cursor: event.currentTarget.dataset.nextCursor }));
  bindGroupCards(stage);
}

async function renderCatalog8() {
  const view = 'catalog-8';
  const root = mount(view);
  const state = currentState(view);
  if (!state.block && blocks[0]) {
    setState(view, { block: blocks[0].alias }, { replace: true });
    return;
  }
  const filterMode = state.filterMode === 'attributes' ? 'attributes' : 'taxonomy';
  const activeBlock = blocks.find(block => block.alias === state.block);
  root.innerHTML = `<div class="catalog5-head"><h1 class="h1">Каталог 8</h1><p class="h1-sub">Поиск по блокам данных с агрегацией series в индикаторы</p></div><div class="cat-top catalog5-search"><div class="cat-search"><span class="sp">⌕</span><input id="catalog8-query" value="${esc(state.q || '')}" placeholder="Поиск по индикаторам и входящим series…" autocomplete="off"><span class="cnt" id="catalog8-count">агрегация…</span></div></div><div class="catalog5-layout catalog8-layout">${catalog8BlockList(state)}<main class="catalog-results" id="catalog8-results"><div class="catalog-results-head"><b>${esc(activeBlock?.name || 'Индикаторы')}</b><span class="count">загрузка…</span></div><div class="catalog-empty"><div><b>Агрегирую series…</b>Формирую индикаторы до пагинации.</div></div></main><aside class="catalog-sidebar catalog5-filter-sidebar" id="catalog8-filter"><div class="catalog5-segment"><button type="button" data-c8-mode="taxonomy" class="${filterMode === 'taxonomy' ? 'active' : ''}">Таксономия</button><button type="button" data-c8-mode="attributes" class="${filterMode === 'attributes' ? 'active' : ''}">Атрибуты</button></div><div id="catalog8-filter-content"><div class="catalog-empty"><div><b>Фильтры</b>Загружаю доступные значения.</div></div></div></aside></div>`;
  const input = root.querySelector('#catalog8-query');
  input.addEventListener('keydown', event => { if (event.key === 'Enter') setState(view, { q: input.value.trim(), cursor: null }); });
  root.querySelectorAll('[data-c8-mode]').forEach(button => button.addEventListener('click', () => setState(view, { filterMode: button.dataset.c8Mode }, { replace: true })));
  root.querySelectorAll('[data-c8-block]').forEach(button => button.addEventListener('click', () => {
    catalog8Expanded.clear();
    catalog8Panels.clear();
    setState(view, { ...clearFilterPatch(), block: button.dataset.c8Block, q: null });
  }));
  const params = { ...apiParams(state), taxonomy: 3 };
  const [facetResponse, groupResponse] = await Promise.all([
    catalogApi.facets(params),
    catalogApi.groups(params),
  ]);
  const facets = facetResponse.facets || {};
  const filterRoot = root.querySelector('#catalog8-filter-content');
  filterRoot.innerHTML = filterMode === 'taxonomy'
    ? `<div class="catalog-filter-title">Таксономия</div>${facetGroups(view, GROUP_LEVELS.filter(level => facets[level]?.length), facets, state)}`
    : `<div class="catalog-filter-title">Атрибуты</div>${facetGroups(view, ATTRIBUTE_DIMENSIONS, facets, state)}`;
  bindFacetPanels(filterRoot, view, { dependentTaxonomy: true });
  const resultRoot = root.querySelector('#catalog8-results');
  resultRoot.innerHTML = `<div class="catalog-results-head"><b>${esc(activeBlock?.name || 'Индикаторы')}</b><span class="count">${indicatorCount(groupResponse.total)}</span></div><div class="catalog8-aggregation-note">Series агрегируются в индикаторы до пагинации. Раскройте индикатор, чтобы увидеть входящие series.</div>${groupResponse.items?.length ? groupResponse.items.map(group => groupSummary(group, view, state)).join('') : '<div class="catalog-empty"><div><b>Индикаторы не найдены</b>Измените блок, фильтры или поисковый запрос.</div></div>'}${groupResponse.nextCursor ? `<button class="catalog-loadmore" data-c8-next-cursor="${esc(groupResponse.nextCursor)}">Следующая страница индикаторов</button>` : ''}`;
  root.querySelector('#catalog8-count').textContent = indicatorCount(groupResponse.total);
  resultRoot.querySelector('[data-c8-next-cursor]')?.addEventListener('click', event => setState(view, { cursor: event.currentTarget.dataset.c8NextCursor }));
  bindGroupCards(resultRoot, view);
}

function catalog9LeftLevel(state) {
  if (!state.block) return 'block';
  if (!state.topic) return 'topic';
  if (!state.theme) return 'theme';
  return 'subtheme';
}

async function ensureCatalog9PathNames(state) {
  for (const level of GROUP_LEVELS) {
    if (!state[level]) break;
    if (!nodeCache.has(`3:${state[level]}`)) await loadGroupLevel(level, state);
  }
}

function catalog9Breadcrumb(state) {
  const parts = [state.block
    ? '<button type="button" data-c9-back="block">Блоки данных</button>'
    : '<span class="current">Блоки данных</span>'];
  if (state.block) {
    const blockName = blocks.find(block => block.alias === state.block)?.name || state.block;
    parts.push(`<i>›</i>${state.topic ? `<button type="button" data-c9-back="topic">${esc(blockName)}</button>` : `<span class="current">${esc(blockName)}</span>`}`);
  }
  if (state.topic) {
    const topicName = nodeCache.get(`3:${state.topic}`)?.name || state.topic;
    parts.push(`<i>›</i>${state.theme ? `<button type="button" data-c9-back="theme">${esc(topicName)}</button>` : `<span class="current">${esc(topicName)}</span>`}`);
  }
  if (state.theme) {
    const themeName = nodeCache.get(`3:${state.theme}`)?.name || state.theme;
    parts.push(`<i>›</i>${state.subtheme ? `<button type="button" data-c9-back="subtheme">${esc(themeName)}</button>` : `<span class="current">${esc(themeName)}</span>`}`);
  }
  if (state.subtheme) {
    const subthemeName = nodeCache.get(`3:${state.subtheme}`)?.name || state.subtheme;
    parts.push(`<i>›</i><span class="current">${esc(subthemeName)}</span>`);
  }
  return `<nav class="catalog9-breadcrumb" aria-label="Путь по каталогу">${parts.join('')}</nav>`;
}

function catalog9HierarchyList(level, items, state) {
  return `<aside class="catalog-sidebar catalog5-blocks"><div class="catalog-filter-title">${LEVEL_LABELS[level]}</div><div class="catalog5-block-list">${items.map((item, index) => `<button type="button" data-c9-level="${level}" data-c9-alias="${esc(item.alias)}" class="catalog-source ${state[level] === item.alias ? 'active' : ''}"><span class="catalog-source-icon">${String(index + 1).padStart(2, '0')}</span><span>${esc(item.name)}<small>${fmt(item.count)} series</small></span><span>›</span></button>`).join('') || '<div class="catalog-empty"><div><b>Нет доступных разделов</b>Для выбранного пути следующий уровень не найден.</div></div>'}</div></aside>`;
}

function resetCatalog9Groups() {
  catalog9Expanded.clear();
  catalog9Panels.clear();
}

function catalog9BackPatch(target) {
  if (target === 'block') return { ...clearFilterPatch(), block: null };
  const index = GROUP_LEVELS.indexOf(target);
  const patch = { cursor: null };
  if (index >= 0) GROUP_LEVELS.slice(index).forEach(level => { patch[level] = null; });
  return patch;
}

async function renderCatalog9() {
  const view = 'catalog-9';
  const root = mount(view);
  const state = currentState(view);
  const activeBlock = blocks.find(block => block.alias === state.block);
  if (state.block) await ensureCatalog9PathNames(state);
  const leftLevel = catalog9LeftLevel(state);
  const leftPlaceholder = leftLevel === 'block'
    ? catalog9BlockList(state)
    : `<aside class="catalog-sidebar catalog5-blocks"><div class="catalog-filter-title">${LEVEL_LABELS[leftLevel]}</div><div class="catalog-empty"><div><b>Загрузка разделов…</b>Формирую следующий уровень выбранного пути.</div></div></aside>`;
  const resultPlaceholder = state.block
    ? '<div class="catalog-results-head"><b>Индикаторы</b><span class="count">агрегация…</span></div><div class="catalog-empty"><div><b>Агрегирую series…</b>Формирую индикаторы для выбранного раздела.</div></div>'
    : '<div class="catalog-empty catalog9-start"><div><b>Выберите блок данных</b>После выбора блока здесь появятся агрегированные индикаторы.</div></div>';
  root.innerHTML = `<div class="catalog5-head"><h1 class="h1">Каталог 9</h1><p class="h1-sub">Последовательный выбор «Блоки данных → Топики → Темы → Сабтемы»</p></div><div class="cat-top catalog5-search"><div class="cat-search"><span class="sp">⌕</span><input id="catalog9-query" value="${esc(state.q || '')}" placeholder="Поиск по индикаторам и входящим series…" autocomplete="off"><span class="cnt" id="catalog9-count">${state.block ? 'агрегация…' : 'выберите блок'}</span></div></div>${catalog9Breadcrumb(state)}<div class="catalog5-layout catalog9-layout"><div id="catalog9-navigation">${leftPlaceholder}</div><main class="catalog-results" id="catalog9-results">${resultPlaceholder}</main><aside class="catalog-sidebar catalog5-filter-sidebar" id="catalog9-filter"><div class="catalog-filter-title">Атрибуты</div><div id="catalog9-filter-content">${state.block ? '<div class="catalog-empty"><div><b>Загрузка атрибутов…</b>Подбираю доступные значения.</div></div>' : '<div class="catalog-empty"><div><b>Выберите блок данных</b>Фильтры станут доступны после выбора блока.</div></div>'}</div></aside></div>`;
  const input = root.querySelector('#catalog9-query');
  input.addEventListener('keydown', event => { if (event.key === 'Enter') setState(view, { q: input.value.trim(), cursor: null }); });
  root.querySelectorAll('[data-c9-back]').forEach(button => button.addEventListener('click', () => {
    resetCatalog9Groups();
    setState(view, catalog9BackPatch(button.dataset.c9Back));
  }));
  root.querySelectorAll('[data-c9-block]').forEach(button => button.addEventListener('click', () => {
    resetCatalog9Groups();
    setState(view, { ...clearFilterPatch(), block: button.dataset.c9Block });
  }));
  if (!state.block) return;

  const params = { ...apiParams(state), taxonomy: 3 };
  const [leftItems, facetResponse, groupResponse] = await Promise.all([
    loadGroupLevel(leftLevel, state),
    catalogApi.facets(params),
    catalogApi.groups(params),
  ]);
  const navigationRoot = root.querySelector('#catalog9-navigation');
  navigationRoot.innerHTML = catalog9HierarchyList(leftLevel, leftItems, state);
  navigationRoot.querySelectorAll('[data-c9-level]').forEach(button => button.addEventListener('click', () => {
    const selectedLevel = button.dataset.c9Level;
    const patch = { [selectedLevel]: button.dataset.c9Alias, cursor: null };
    GROUP_LEVELS.slice(GROUP_LEVELS.indexOf(selectedLevel) + 1).forEach(level => { patch[level] = null; });
    resetCatalog9Groups();
    setState(view, patch);
  }));

  const facets = facetResponse.facets || {};
  const filterRoot = root.querySelector('#catalog9-filter-content');
  filterRoot.innerHTML = facetGroups(view, ATTRIBUTE_DIMENSIONS, facets, state);
  bindFacetPanels(filterRoot, view);

  const resultRoot = root.querySelector('#catalog9-results');
  resultRoot.innerHTML = `<div class="catalog-results-head"><b>${esc(activeBlock?.name || 'Индикаторы')}</b><span class="count">${indicatorCount(groupResponse.total)}</span></div><div class="catalog8-aggregation-note">Series агрегируются в индикаторы до пагинации. Выдача соответствует выбранному уровню пути.</div>${groupResponse.items?.length ? groupResponse.items.map(group => groupSummary(group, view, state)).join('') : '<div class="catalog-empty"><div><b>Индикаторы не найдены</b>Измените раздел, атрибуты или поисковый запрос.</div></div>'}${groupResponse.nextCursor ? `<button class="catalog-loadmore" data-c9-next-cursor="${esc(groupResponse.nextCursor)}">Следующая страница индикаторов</button>` : ''}`;
  root.querySelector('#catalog9-count').textContent = indicatorCount(groupResponse.total);
  resultRoot.querySelector('[data-c9-next-cursor]')?.addEventListener('click', event => setState(view, { cursor: event.currentTarget.dataset.c9NextCursor }));
  bindGroupCards(resultRoot, view);
}

let catalog10SpotlightController;
let catalog10SpotlightTimer;
let catalog10SpotlightItems = [];
let catalog10SpotlightIndex = -1;

function catalog10BlockList(state) {
  const featured = state.collection === 'frequent';
  return `<aside class="catalog-sidebar catalog5-blocks catalog10-blocks"><div class="catalog-filter-title">Блоки данных</div><div class="catalog5-block-list"><button type="button" data-c10-featured class="catalog-source catalog10-featured ${featured ? 'active' : ''}"><span class="catalog-source-icon">★</span><span>Часто используемые<small>500 индикаторов</small></span><span class="catalog10-pinned">●</span></button><div class="catalog10-block-divider"><span>Все блоки данных</span></div>${blocks.map((block, index) => `<button type="button" data-c10-block="${esc(block.alias)}" class="catalog-source ${state.block === block.alias ? 'active' : ''}"><span class="catalog-source-icon">${String(index + 1).padStart(2, '0')}</span><span>${esc(block.name)}<small>${fmt(block.totalSeries ?? block.availableSeries)} series</small></span><span>›</span></button>`).join('')}</div></aside>`;
}

function catalog10Breadcrumb(state) {
  if (state.collection === 'frequent') return '<nav class="catalog9-breadcrumb catalog10-breadcrumb" aria-label="Путь по каталогу"><span class="current">★ Часто используемые</span><span class="catalog10-path-note">500 индикаторов с наибольшим покрытием series</span></nav>';
  const parts = [state.block
    ? '<button type="button" data-c10-back="block">Блоки данных</button>'
    : '<span class="current">Блоки данных</span>'];
  if (state.block) {
    const blockName = blocks.find(block => block.alias === state.block)?.name || state.block;
    parts.push(`<i>›</i>${state.topic ? `<button type="button" data-c10-back="topic">${esc(blockName)}</button>` : `<span class="current">${esc(blockName)}</span>`}`);
  }
  if (state.topic) {
    const topicName = nodeCache.get(`3:${state.topic}`)?.name || state.topic;
    parts.push(`<i>›</i>${state.theme ? `<button type="button" data-c10-back="theme">${esc(topicName)}</button>` : `<span class="current">${esc(topicName)}</span>`}`);
  }
  if (state.theme) {
    const themeName = nodeCache.get(`3:${state.theme}`)?.name || state.theme;
    parts.push(`<i>›</i>${state.subtheme ? `<button type="button" data-c10-back="subtheme">${esc(themeName)}</button>` : `<span class="current">${esc(themeName)}</span>`}`);
  }
  if (state.subtheme) parts.push(`<i>›</i><span class="current">${esc(nodeCache.get(`3:${state.subtheme}`)?.name || state.subtheme)}</span>`);
  return `<nav class="catalog9-breadcrumb catalog10-breadcrumb" aria-label="Путь по каталогу">${parts.join('')}</nav>`;
}

function catalog10HierarchyList(level, items, state) {
  return `<aside class="catalog-sidebar catalog5-blocks catalog10-blocks"><div class="catalog-filter-title">${LEVEL_LABELS[level]}</div><div class="catalog5-block-list">${items.map((item, index) => `<button type="button" data-c10-level="${level}" data-c10-alias="${esc(item.alias)}" class="catalog-source ${state[level] === item.alias ? 'active' : ''}"><span class="catalog-source-icon">${String(index + 1).padStart(2, '0')}</span><span>${esc(item.name)}<small>${fmt(item.count)} series</small></span><span>›</span></button>`).join('') || '<div class="catalog-empty"><div><b>Нет доступных разделов</b>Для выбранного пути следующий уровень не найден.</div></div>'}</div></aside>`;
}

function resetCatalog10Groups() {
  catalog10Expanded.clear();
  catalog10Panels.clear();
}

function catalog10BackPatch(target) {
  if (target === 'block') return { ...clearFilterPatch(), block: null, collection: 'blocks', searchScope: 'block' };
  const index = GROUP_LEVELS.indexOf(target);
  const patch = { cursor: null };
  if (index >= 0) GROUP_LEVELS.slice(index).forEach(level => { patch[level] = null; });
  return patch;
}

function catalog10QueryParams(state) {
  const params = apiParams(state);
  const globalSearch = state.searchScope === 'global';
  if (globalSearch) ['block', ...GROUP_LEVELS].forEach(key => { delete params[key]; });
  else if (state.collection === 'frequent') {
    delete params.block;
    GROUP_LEVELS.forEach(key => { delete params[key]; });
    params.featured = 1;
  }
  return { ...params, taxonomy: 3, limit: 50 };
}

function catalog10SearchBar(state) {
  const globalSearch = state.searchScope === 'global';
  return `<div class="catalog10-searchbar"><span class="catalog10-search-icon">⌕</span><input id="catalog10-query" value="${esc(state.q || '')}" placeholder="Поиск по индикаторам и входящим series…" autocomplete="off"><div class="catalog10-search-scope" role="radiogroup" aria-label="Область поиска"><button type="button" role="radio" aria-checked="${globalSearch}" data-c10-scope="global" class="${globalSearch ? 'active' : ''}">Глобальный</button><button type="button" role="radio" aria-checked="${!globalSearch}" data-c10-scope="block" class="${!globalSearch ? 'active' : ''}">Блок данных</button></div><span class="catalog10-count" id="catalog10-count">подготовка…</span></div>`;
}

function ensureCatalog10Overlays() {
  if (!document.getElementById('catalog10-spotlight')) {
    document.body.insertAdjacentHTML('beforeend', `<div class="catalog10-overlay" id="catalog10-spotlight" aria-hidden="true"><section class="catalog10-spotlight-panel" role="dialog" aria-modal="true" aria-label="Быстрый поиск индикаторов"><div class="catalog10-spotlight-search"><span>⌕</span><input id="catalog10-spotlight-input" placeholder="Введите название или мнемонику индикатора" autocomplete="off"><kbd>esc</kbd></div><div class="catalog10-spotlight-results" id="catalog10-spotlight-results"><div class="catalog10-spotlight-empty"><b>Быстрый поиск по всему каталогу</b><span>Начните вводить название или мнемонику индикатора</span></div></div><footer><span>↑↓ выбрать</span><span>enter открыть карточку</span><span>esc закрыть</span></footer></section></div><div class="catalog10-overlay" id="catalog10-indicator-modal" aria-hidden="true"><section class="catalog10-indicator-panel" role="dialog" aria-modal="true" aria-label="Карточка индикатора"><button type="button" class="catalog10-modal-close" data-c10-modal-close aria-label="Закрыть">×</button><div id="catalog10-indicator-content"></div></section></div>`);
    const spotlight = document.getElementById('catalog10-spotlight');
    const modal = document.getElementById('catalog10-indicator-modal');
    spotlight.addEventListener('mousedown', event => { if (event.target === spotlight) closeCatalog10Spotlight(); });
    modal.addEventListener('mousedown', event => { if (event.target === modal) closeCatalog10IndicatorModal(); });
    modal.querySelector('[data-c10-modal-close]').addEventListener('click', closeCatalog10IndicatorModal);
    const input = document.getElementById('catalog10-spotlight-input');
    input.addEventListener('input', () => scheduleCatalog10Spotlight(input.value));
    input.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown') { event.preventDefault(); moveCatalog10Spotlight(1); }
      if (event.key === 'ArrowUp') { event.preventDefault(); moveCatalog10Spotlight(-1); }
      if (event.key === 'Enter' && catalog10SpotlightItems[catalog10SpotlightIndex]) {
        event.preventDefault(); openCatalog10IndicatorModal(catalog10SpotlightItems[catalog10SpotlightIndex].seriesId);
      }
    });
  }
}

function openCatalog10Spotlight() {
  ensureCatalog10Overlays();
  const spotlight = document.getElementById('catalog10-spotlight');
  const input = document.getElementById('catalog10-spotlight-input');
  spotlight.classList.add('open');
  spotlight.setAttribute('aria-hidden', 'false');
  input.value = '';
  catalog10SpotlightItems = [];
  catalog10SpotlightIndex = -1;
  document.getElementById('catalog10-spotlight-results').innerHTML = '<div class="catalog10-spotlight-empty"><b>Быстрый поиск по всему каталогу</b><span>Начните вводить название или мнемонику индикатора</span></div>';
  setTimeout(() => input.focus(), 0);
}

function closeCatalog10Spotlight() {
  const spotlight = document.getElementById('catalog10-spotlight');
  if (!spotlight) return;
  catalog10SpotlightController?.abort();
  spotlight.classList.remove('open');
  spotlight.setAttribute('aria-hidden', 'true');
}

function closeCatalog10IndicatorModal() {
  const modal = document.getElementById('catalog10-indicator-modal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

function setCatalog10SpotlightIndex(index) {
  const buttons = [...document.querySelectorAll('[data-c10-spotlight-result]')];
  if (!buttons.length) { catalog10SpotlightIndex = -1; return; }
  catalog10SpotlightIndex = (index + buttons.length) % buttons.length;
  buttons.forEach((button, buttonIndex) => button.classList.toggle('active', buttonIndex === catalog10SpotlightIndex));
  buttons[catalog10SpotlightIndex].scrollIntoView({ block: 'nearest' });
}

function moveCatalog10Spotlight(direction) {
  setCatalog10SpotlightIndex(catalog10SpotlightIndex + direction);
}

function scheduleCatalog10Spotlight(value) {
  clearTimeout(catalog10SpotlightTimer);
  catalog10SpotlightController?.abort();
  const query = value.trim();
  const root = document.getElementById('catalog10-spotlight-results');
  if (!query) {
    catalog10SpotlightItems = [];
    catalog10SpotlightIndex = -1;
    root.innerHTML = '<div class="catalog10-spotlight-empty"><b>Быстрый поиск по всему каталогу</b><span>Начните вводить название или мнемонику индикатора</span></div>';
    return;
  }
  root.innerHTML = '<div class="catalog10-spotlight-empty"><b>Ищу индикаторы…</b><span>Сопоставляю название, мнемонику и метаданные</span></div>';
  catalog10SpotlightTimer = setTimeout(async () => {
    catalog10SpotlightController = new AbortController();
    try {
      const response = await catalogApi.suggest(query, catalog10SpotlightController.signal);
      catalog10SpotlightItems = response.items || [];
      catalog10SpotlightIndex = catalog10SpotlightItems.length ? 0 : -1;
      root.innerHTML = catalog10SpotlightItems.length ? `<div class="catalog10-spotlight-section"><span>Индикаторы</span><em>${catalog10SpotlightItems.length}</em></div>${catalog10SpotlightItems.map((item, index) => `<button type="button" class="catalog10-spotlight-item ${index === 0 ? 'active' : ''}" data-c10-spotlight-result="${esc(item.seriesId)}"><span class="catalog10-spotlight-item-icon">↗</span><span><b>${esc(item.name)}</b><small>${esc([item.mnemonic, item.geography?.name, item.frequency?.label].filter(Boolean).join(' · '))}</small></span><code>${esc(item.mnemonic)}</code></button>`).join('')}` : '<div class="catalog10-spotlight-empty"><b>Совпадений не найдено</b><span>Попробуйте другое название или мнемонику</span></div>';
      root.querySelectorAll('[data-c10-spotlight-result]').forEach(button => {
        button.addEventListener('mouseenter', () => setCatalog10SpotlightIndex(catalog10SpotlightItems.findIndex(item => String(item.seriesId) === button.dataset.c10SpotlightResult)));
        button.addEventListener('click', () => openCatalog10IndicatorModal(button.dataset.c10SpotlightResult));
      });
    } catch (error) {
      if (error.name !== 'AbortError') root.innerHTML = `<div class="catalog-error">${esc(error.message)}</div>`;
    }
  }, 180);
}

async function openCatalog10IndicatorModal(seriesId) {
  ensureCatalog10Overlays();
  closeCatalog10Spotlight();
  const modal = document.getElementById('catalog10-indicator-modal');
  const content = document.getElementById('catalog10-indicator-content');
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  content.innerHTML = '<div class="catalog-empty"><div><b>Загрузка карточки…</b>Получаю метаданные индикатора.</div></div>';
  try {
    const indicator = await catalogApi.indicator(seriesId);
    const taxonomy = indicator.taxonomy4 || {};
    content.innerHTML = `<div class="catalog10-modal-kicker">Карточка индикатора</div><h2>${esc(indicator.name)}</h2><code class="catalog10-modal-code">${esc(indicator.mnemonic)}</code><div class="catalog10-modal-grid"><div><small>Источник</small><b>${esc(indicator.source?.label)}</b></div><div><small>География</small><b>${esc(indicator.geography?.name || indicator.geography?.code)}</b></div><div><small>Частота</small><b>${esc(indicator.frequency?.label)}</b></div><div><small>Единица</small><b>${esc(indicator.unit?.code || indicator.unit?.label)}</b></div><div><small>Код показателя</small><b>${esc(indicator.indicatorCode)}</b></div><div><small>Наблюдений</small><b>${fmt(indicator.availability?.observationCount)}</b></div></div><div class="catalog10-modal-path"><small>Тематический путь</small><span>${esc(taxonomy.path || [taxonomy.topic?.name, taxonomy.theme?.name, taxonomy.subtheme?.name, taxonomy.subtheme2?.name].filter(Boolean).join(' › '))}</span></div><div class="catalog10-modal-status">${indicator.availability?.hasTimeSeries ? 'Временной ряд доступен' : 'Доступны классификационные метаданные'}</div>`;
  } catch (error) {
    content.innerHTML = `<div class="catalog-error"><b>Карточка не загрузилась.</b> ${esc(error.message)}</div>`;
  }
}

async function renderCatalog10() {
  const view = 'catalog-10';
  const root = mount(view);
  const state = currentState(view);
  if (!state.collection && !state.block) {
    setState(view, { collection: 'frequent', searchScope: 'block' }, { replace: true });
    return;
  }
  ensureCatalog10Overlays();
  if (state.block) await ensureCatalog9PathNames(state);
  const featured = state.collection === 'frequent';
  const blocksLevel = !state.block;
  const leftLevel = state.block ? catalog9LeftLevel(state) : 'block';
  const leftPlaceholder = blocksLevel
    ? catalog10BlockList(state)
    : `<aside class="catalog-sidebar catalog5-blocks catalog10-blocks"><div class="catalog-filter-title">${LEVEL_LABELS[leftLevel]}</div><div class="catalog-empty"><div><b>Загрузка разделов…</b>Формирую следующий уровень пути.</div></div></aside>`;
  const scopeIsGlobal = state.searchScope === 'global';
  const needsGlobalQuery = scopeIsGlobal && !state.q;
  const hasScopedResults = featured || Boolean(state.block);
  const shouldLoad = !needsGlobalQuery && (scopeIsGlobal || hasScopedResults);
  const resultPlaceholder = needsGlobalQuery
    ? '<div class="catalog-empty catalog10-start"><div><b>Введите запрос для глобального поиска</b>Поиск будет выполнен по всему каталогу независимо от выбранного блока.</div></div>'
    : shouldLoad
      ? '<div class="catalog-empty"><div><b>Подготавливаю компактную выдачу…</b>Агрегирую series в индикаторы.</div></div>'
      : '<div class="catalog-empty catalog10-start"><div><b>Выберите блок данных</b>После выбора блока появится агрегированная выдача.</div></div>';
  root.innerHTML = `<div class="catalog10-head"><div><h1 class="h1">Каталог 10</h1><p class="h1-sub">Компактная навигация и быстрый доступ к часто используемым индикаторам</p></div><button type="button" class="catalog10-spotlight-trigger" data-c10-open-spotlight><span>⌕</span>Быстрый поиск <kbd>⌘⇧K</kbd></button></div>${catalog10SearchBar(state)}${catalog10Breadcrumb(state)}<div class="catalog5-layout catalog9-layout catalog10-layout"><div id="catalog10-navigation" class="catalog9-navigation">${leftPlaceholder}</div><main class="catalog-results" id="catalog10-results">${resultPlaceholder}</main><aside class="catalog-sidebar catalog5-filter-sidebar" id="catalog10-filter"><div class="catalog-filter-title">Атрибуты</div><div id="catalog10-filter-content">${shouldLoad ? '<div class="catalog-empty"><div><b>Загрузка атрибутов…</b>Подбираю доступные значения.</div></div>' : '<div class="catalog-empty"><div><b>Фильтры пока недоступны</b>Выберите блок или выполните глобальный поиск.</div></div>'}</div></aside></div>`;
  root.querySelector('[data-c10-open-spotlight]').addEventListener('click', openCatalog10Spotlight);
  const input = root.querySelector('#catalog10-query');
  input.addEventListener('keydown', event => { if (event.key === 'Enter') setState(view, { q: input.value.trim(), cursor: null }); });
  root.querySelectorAll('[data-c10-scope]').forEach(button => button.addEventListener('click', () => {
    resetCatalog10Groups();
    setState(view, { searchScope: button.dataset.c10Scope, cursor: null });
  }));
  root.querySelectorAll('[data-c10-back]').forEach(button => button.addEventListener('click', () => {
    resetCatalog10Groups();
    setState(view, catalog10BackPatch(button.dataset.c10Back));
  }));
  root.querySelector('[data-c10-featured]')?.addEventListener('click', () => {
    resetCatalog10Groups();
    setState(view, { ...clearFilterPatch(), block: null, collection: 'frequent', q: null, searchScope: 'block' });
  });
  root.querySelectorAll('[data-c10-block]').forEach(button => button.addEventListener('click', () => {
    resetCatalog10Groups();
    setState(view, { ...clearFilterPatch(), block: button.dataset.c10Block, collection: null, q: null, searchScope: 'block' });
  }));
  if (!shouldLoad) {
    root.querySelector('#catalog10-count').textContent = needsGlobalQuery ? 'введите запрос' : 'выберите блок';
    return;
  }

  const params = catalog10QueryParams(state);
  const requests = [catalogApi.facets(params), catalogApi.groups(params)];
  if (state.block) requests.unshift(loadGroupLevel(leftLevel, state));
  const responses = await Promise.all(requests);
  const leftItems = state.block ? responses[0] : null;
  const facetResponse = responses[state.block ? 1 : 0];
  const groupResponse = responses[state.block ? 2 : 1];
  if (state.block) {
    const navigationRoot = root.querySelector('#catalog10-navigation');
    navigationRoot.innerHTML = catalog10HierarchyList(leftLevel, leftItems, state);
    navigationRoot.querySelectorAll('[data-c10-level]').forEach(button => button.addEventListener('click', () => {
      const selectedLevel = button.dataset.c10Level;
      const patch = { [selectedLevel]: button.dataset.c10Alias, cursor: null };
      GROUP_LEVELS.slice(GROUP_LEVELS.indexOf(selectedLevel) + 1).forEach(level => { patch[level] = null; });
      resetCatalog10Groups();
      setState(view, patch);
    }));
  }
  const facets = facetResponse.facets || {};
  const filterRoot = root.querySelector('#catalog10-filter-content');
  filterRoot.innerHTML = facetGroups(view, ATTRIBUTE_DIMENSIONS, facets, state);
  bindFacetPanels(filterRoot, view);
  const activeBlock = blocks.find(block => block.alias === state.block);
  const resultTitle = scopeIsGlobal ? `Глобальный поиск · ${state.q}` : featured ? 'Часто используемые' : activeBlock?.name || 'Индикаторы';
  const resultRoot = root.querySelector('#catalog10-results');
  resultRoot.innerHTML = `<div class="catalog-results-head"><b>${esc(resultTitle)}</b><span class="count">${indicatorCount(groupResponse.total)}</span></div>${groupResponse.items?.length ? groupResponse.items.map(group => groupSummary(group, view, state)).join('') : '<div class="catalog-empty"><div><b>Индикаторы не найдены</b>Измените путь, атрибуты или поисковый запрос.</div></div>'}${groupResponse.nextCursor ? `<button class="catalog-loadmore" data-c10-next-cursor="${esc(groupResponse.nextCursor)}">Следующие индикаторы</button>` : ''}`;
  root.querySelector('#catalog10-count').textContent = indicatorCount(groupResponse.total);
  resultRoot.querySelector('[data-c10-next-cursor]')?.addEventListener('click', event => setState(view, { cursor: event.currentTarget.dataset.c10NextCursor }));
  bindGroupCards(resultRoot, view);
}

function loadCatalog7Layout() {
  try { return { ...DEFAULT_CATALOG7_LAYOUT, ...JSON.parse(localStorage.getItem(CATALOG7_LAYOUT_KEY) || '{}') }; }
  catch { return { ...DEFAULT_CATALOG7_LAYOUT }; }
}

function saveCatalog7Layout(layout) {
  localStorage.setItem(CATALOG7_LAYOUT_KEY, JSON.stringify(layout));
}

function selectedSeriesData(item) {
  return { ...item, dates: CATALOG7_DATES, values: CATALOG7_SERIES[item.slot], color: CATALOG7_COLORS[item.slot] };
}

function catalog7Workbench(layout) {
  const all = selectedItems(catalog7Selection);
  const included = selectedItems(catalog7Selection, { includedOnly: true }).map(selectedSeriesData);
  let content = '';
  if (layout.tab === 'table') {
    content = included.length ? `<div class="catalog7-demo-label" title="Для прототипа выбранным индикаторам назначаются фиксированные демонстрационные временные ряды.">Демо-данные · фиксированные ряды</div><div class="catalog7-table-wrap"><table><thead><tr><th>Период</th>${included.map(item => `<th title="${esc(item.indicator.name)}"><span>${esc(item.indicator.name)}</span><code>${esc(item.indicator.mnemonic)}</code></th>`).join('')}</tr></thead><tbody>${CATALOG7_DATES.map((date, index) => `<tr><td>${date}</td>${included.map(item => `<td>${String(item.values[index]).replace('.', ',')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<div class="catalog-empty"><div><b>Нет рядов в таблице</b>Отметьте «Включить в данные» у выбранных индикаторов.</div></div>';
  } else if (layout.tab === 'chart') {
    content = included.length ? '<div class="catalog7-demo-label" title="Для прототипа выбранным индикаторам назначаются фиксированные демонстрационные временные ряды.">Демо-данные · фиксированные ряды</div><div id="catalog7-chart" role="img" aria-label="Сравнение выбранных индикаторов"></div>' : '<div class="catalog-empty"><div><b>Нет рядов на графике</b>Отметьте «Включить в данные» у выбранных индикаторов.</div></div>';
  } else {
    content = all.length ? `<div class="catalog7-selected-list">${all.map(item => `<article><span class="catalog7-series-color" style="--series-color:${CATALOG7_COLORS[item.slot]}"></span><label title="Включить в таблицу и график"><input type="checkbox" data-c7-include="${esc(item.indicator.seriesId)}" ${item.includeInData ? 'checked' : ''}><span>В данные</span></label><div><b>${esc(item.indicator.name)}</b><code>${esc(item.indicator.mnemonic)}</code></div><button data-c7-remove="${esc(item.indicator.seriesId)}" aria-label="Удалить индикатор">×</button></article>`).join('')}</div>` : '<div class="catalog-empty"><div><b>Рабочая область пуста</b>Выберите индикаторы флажками в результатах.</div></div>';
  }
  return `<div class="catalog7-workbench-head"><div><b>Выбрано ${all.length}/10</b><span>${included.length} включено в данные</span></div>${all.length ? '<button data-c7-clear>Очистить</button>' : ''}</div><div class="catalog7-tabs" role="tablist">${[['list','Список'],['table','Таблица'],['chart','График']].map(([key, label]) => `<button role="tab" data-c7-tab="${key}" aria-selected="${layout.tab === key}" class="${layout.tab === key ? 'active' : ''}">${label}</button>`).join('')}</div><div class="catalog7-tab-content">${content}</div>`;
}

function drawCatalog7Chart(root) {
  const dom = root.querySelector('#catalog7-chart');
  if (!dom || !window.echarts) return;
  const included = selectedItems(catalog7Selection, { includedOnly: true }).map(selectedSeriesData);
  const chart = window.echarts.getInstanceByDom(dom) || window.echarts.init(dom);
  chart.setOption({
    backgroundColor: 'transparent', color: included.map(item => item.color),
    tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } }, legend: { type: 'scroll', textStyle: { color: '#99a7bc' } },
    grid: { left: 46, right: 22, top: 58, bottom: 38 },
    xAxis: { type: 'category', data: CATALOG7_DATES, axisLabel: { color: '#71819a' }, axisLine: { lineStyle: { color: '#354157' } } },
    yAxis: { type: 'value', scale: true, axisLabel: { color: '#71819a' }, splitLine: { lineStyle: { color: 'rgba(120,140,170,.16)' } } },
    series: included.map(item => ({ name: item.indicator.name, type: 'line', showSymbol: false, smooth: .2, data: item.values, lineStyle: { width: 2 } })),
  }, true);
  requestAnimationFrame(() => chart.resize());
}

function bindCatalog7Workbench(root, layout) {
  root.querySelectorAll('[data-c7-tab]').forEach(button => button.addEventListener('click', () => {
    layout.tab = button.dataset.c7Tab; saveCatalog7Layout(layout); refreshCatalog7Workbench(root, layout);
  }));
  root.querySelectorAll('[data-c7-include]').forEach(input => input.addEventListener('change', () => {
    toggleInclude(catalog7Selection, input.dataset.c7Include, input.checked); refreshCatalog7Workbench(root, layout);
  }));
  root.querySelectorAll('[data-c7-remove]').forEach(button => button.addEventListener('click', () => {
    removeSelection(catalog7Selection, button.dataset.c7Remove);
    const resultCheckbox = root.querySelector(`[data-select-series="${CSS.escape(button.dataset.c7Remove)}"]`);
    if (resultCheckbox) resultCheckbox.checked = false;
    refreshCatalog7Workbench(root, layout);
  }));
  root.querySelector('[data-c7-clear]')?.addEventListener('click', () => {
    catalog7Selection.clear(); root.querySelectorAll('[data-select-series]').forEach(input => { input.checked = false; }); refreshCatalog7Workbench(root, layout);
  });
  drawCatalog7Chart(root);
}

function refreshCatalog7Workbench(root, layout) {
  const workbench = root.querySelector('#catalog7-workbench');
  if (workbench) { workbench.innerHTML = catalog7Workbench(layout); bindCatalog7Workbench(root, layout); }
  root.querySelectorAll('[data-c7-count]').forEach(node => { node.textContent = `${catalog7Selection.size}/10`; });
}

function bindCatalog7Splitter(root, layout) {
  const splitter = root.querySelector('[data-c7-splitter]');
  if (!splitter) return;
  splitter.addEventListener('pointerdown', event => {
    splitter.setPointerCapture(event.pointerId);
    const move = moveEvent => {
      layout.analysisWidth = Math.max(320, Math.min(720, window.innerWidth - moveEvent.clientX - 28));
      root.querySelector('.catalog7-layout')?.style.setProperty('--analysis-width', `${layout.analysisWidth}px`);
      const chartDom = root.querySelector('#catalog7-chart');
      if (chartDom) window.echarts?.getInstanceByDom(chartDom)?.resize();
    };
    const up = () => { saveCatalog7Layout(layout); splitter.removeEventListener('pointermove', move); };
    splitter.addEventListener('pointermove', move); splitter.addEventListener('pointerup', up, { once: true });
  });
}

async function renderCatalog7() {
  const view = 'catalog-7';
  const root = mount(view);
  const state = currentState(view);
  const layout = loadCatalog7Layout();
  const layoutColumns = [layout.showTaxonomy && '220px', layout.showResults && 'minmax(360px,1fr)', layout.showAttributes && '220px', layout.showAnalysis ? '7px minmax(320px,var(--analysis-width))' : '44px'].filter(Boolean).join(' ');
  const layoutClasses = `${layout.showResults ? '' : ' results-hidden'}${layout.showAnalysis ? '' : ' analysis-hidden'}`;
  root.innerHTML = `${header(view)}<div class="catalog7-toolbar">${[['showTaxonomy','Таксономия'],['showAttributes','Атрибуты'],['showResults','Результаты'],['showAnalysis','Анализ']].map(([key, label]) => `<button data-c7-toggle="${key}" class="${layout[key] ? 'active' : ''}">${layout[key] ? 'Скрыть' : 'Показать'}: ${label}${key === 'showAnalysis' ? ' · <span data-c7-count>0/10</span>' : ''}</button>`).join('')}</div><div class="catalog-chipbar"><button class="catalog-chip ${!state.block ? 'active' : ''}" data-c7-block="">Все блоки</button>${blocks.map(block => `<button class="catalog-chip ${asList(state.block).includes(block.alias) ? 'active' : ''}" data-c7-block="${esc(block.alias)}">${esc(block.name)}</button>`).join('')}</div><div class="catalog7-layout${layoutClasses}" style="--analysis-width:${layout.analysisWidth}px;--catalog7-columns:${layoutColumns}">${layout.showTaxonomy ? '<aside class="catalog-panel catalog7-taxonomy" id="catalog7-taxonomy"><div class="catalog-empty">Загрузка таксономии…</div></aside>' : ''}${layout.showResults ? `<main class="catalog7-results">${searchBox(state.q, 'Поиск индикаторов…', 'catalog7-query')}<div id="catalog7-result-list"><div class="catalog-empty">Подготавливаю выборку…</div></div><div id="catalog7-selection-notice" aria-live="polite"></div></main>` : ''}${layout.showAttributes ? '<aside class="catalog-panel catalog7-attributes" id="catalog7-attributes"><div class="catalog-empty">Загрузка атрибутов…</div></aside>' : ''}${layout.showAnalysis ? '<div class="catalog7-splitter" data-c7-splitter title="Изменить ширину"></div><aside class="catalog-panel catalog7-analysis" id="catalog7-workbench"></aside>' : '<button class="catalog7-collapsed-rail" data-c7-expand-analysis aria-label="Развернуть аналитическую панель">Анализ <b data-c7-count>0/10</b></button>'}</div>`;
  root.querySelectorAll('[data-c7-toggle]').forEach(button => button.addEventListener('click', () => {
    const key = button.dataset.c7Toggle; layout[key] = !layout[key]; saveCatalog7Layout(layout); render(view);
  }));
  root.querySelector('[data-c7-expand-analysis]')?.addEventListener('click', () => { layout.showAnalysis = true; saveCatalog7Layout(layout); render(view); });
  root.querySelectorAll('[data-c7-block]').forEach(button => button.addEventListener('click', () => setState(view, { ...clearFilterPatch(), block: button.dataset.c7Block || null })));
  root.querySelector('#catalog7-query')?.addEventListener('keydown', event => { if (event.key === 'Enter') setState(view, { q: event.currentTarget.value.trim(), cursor: null }); });
  refreshCatalog7Workbench(root, layout);
  bindCatalog7Splitter(root, layout);
  if (!layout.showTaxonomy && !layout.showAttributes && !layout.showResults) return;
  const [facetResponse, resultResponse] = await Promise.all([
    (layout.showTaxonomy || layout.showAttributes) ? catalogApi.facets(apiParams(state)) : Promise.resolve({ facets: {} }),
    layout.showResults ? catalogApi.indicators(apiParams(state)) : Promise.resolve(null),
  ]);
  const facets = facetResponse.facets || {};
  if (layout.showTaxonomy) root.querySelector('#catalog7-taxonomy').innerHTML = `<div class="catalog-panel-title">Таксономия</div>${facetGroups(view, LEVELS, facets, state)}`;
  if (layout.showAttributes) root.querySelector('#catalog7-attributes').innerHTML = `<div class="catalog-panel-title">Атрибуты</div>${facetGroups(view, ATTRIBUTE_DIMENSIONS, facets, state)}`;
  bindFacetPanels(root, view);
  if (layout.showResults) {
    const resultRoot = root.querySelector('#catalog7-result-list');
    resultRoot.innerHTML = cards(resultResponse, view, state, { selectable: true });
    bindResults(resultRoot, view);
    const byId = new Map(resultResponse.items.map(item => [String(item.seriesId), item]));
    resultRoot.querySelectorAll('[data-select-series]').forEach(input => input.addEventListener('change', event => {
      event.stopPropagation();
      const id = input.dataset.selectSeries;
      if (input.checked) {
        const result = addSelection(catalog7Selection, byId.get(id));
        if (!result.added && result.reason === 'limit') {
          input.checked = false;
          root.querySelector('#catalog7-selection-notice').innerHTML = '<div class="catalog-error">Можно выбрать не более 10 индикаторов.</div>';
        }
      } else removeSelection(catalog7Selection, id);
      refreshCatalog7Workbench(root, layout);
    }));
  }
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
  if (view !== 'catalog-10') {
    closeCatalog10Spotlight();
    closeCatalog10IndicatorModal();
  }
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
    if (view === 'catalog-5') await renderCatalog5();
    if (view === 'catalog-6') await renderCatalog6();
    if (view === 'catalog-7') await renderCatalog7();
    if (view === 'catalog-8') await renderCatalog8();
    if (view === 'catalog-9') await renderCatalog9();
    if (view === 'catalog-10') await renderCatalog10();
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

document.addEventListener('keydown', event => {
  const isCatalog10 = readRoute().view === 'catalog-10';
  const spotlightOpen = document.getElementById('catalog10-spotlight')?.classList.contains('open');
  const modalOpen = document.getElementById('catalog10-indicator-modal')?.classList.contains('open');
  if (isCatalog10 && (event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    event.stopImmediatePropagation();
    openCatalog10Spotlight();
    return;
  }
  if (event.key === 'Escape' && (spotlightOpen || modalOpen)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (modalOpen) closeCatalog10IndicatorModal();
    else closeCatalog10Spotlight();
  }
}, true);

document.addEventListener('click', event => {
  const item = event.target.closest('.nav-item[data-view]');
  if (!item || !['catalog-1', 'catalog-2', 'catalog-3', 'catalog-4', 'catalog-5', 'catalog-6', 'catalog-7', 'catalog-8', 'catalog-9', 'catalog-10'].includes(item.dataset.view)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  navigate(item.dataset.view, currentState(item.dataset.view));
}, true);

window.addEventListener('popstate', activateRoute);
window.addEventListener('hashchange', activateRoute);
window.catalogApp = { render, navigate, activateRoute };
activateRoute();
