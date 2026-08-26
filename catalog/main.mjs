import { catalogApi } from './api-client.mjs';
import { CATALOG_VIEWS, paramsToState, readRoute, writeRoute } from './state.mjs';

const VIEW_TITLES = {
  catalog: ['Каталог', 'Обзор полного пространства данных и быстрый переход к нужному блоку'],
  'catalog-1': ['Каталог 1', 'Последовательная навигация: блок → тема → тематика → подтема → конечная категория'],
  'catalog-2': ['Каталог 2', 'Конструктор выборки с тематическими и атрибутивными фильтрами'],
  'catalog-3': ['Каталог 3', 'Прямой поиск по названию, мнемонике и метаданным'],
};
const LEVELS_4 = ['topic', 'theme', 'subtheme', 'subtheme2'];
const LEVELS_3 = ['topic', 'theme', 'subtheme'];
const LEVEL_LABELS = { topic: 'Тема', theme: 'Тематика', subtheme: 'Подтема', subtheme2: 'Конечная категория' };
const FACET_LABELS = { source: 'Источники', frequency: 'Частота', unit: 'Единицы измерения', geographyScope: 'Тип географии', geography: 'География' };
const appState = new Map();
let manifest;
let blocks = [];
let suggestionController;
let suggestionTimer;

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const fmt = value => Number(value || 0).toLocaleString('ru-RU');
const asList = value => Array.isArray(value) ? value : value ? [value] : [];

function mount(view) { return document.getElementById(`catalog-mount-${view}`); }
function currentState(view) { return appState.get(view) || {}; }

function header(view, extra = '') {
  const [title, subtitle] = VIEW_TITLES[view];
  const datasetLabel = manifest?.demo ? `Демонстрационный набор · ${fmt(manifest?.demoIndicators)}` : `Полный набор · ${fmt(manifest?.totals?.indicators)}`;
  return `<div class="catalog-exp-head"><div><h1>${title}</h1><p>${subtitle}</p></div><span class="catalog-demo-badge">${datasetLabel}</span></div>${extra}`;
}

function metricStrip() {
  const totals = manifest?.totals || {};
  return `<div class="catalog-metrics">
    <span class="catalog-metric"><b>${fmt(totals.indicators)}</b>индикаторов</span>
    <span class="catalog-metric"><b>${fmt(totals.concepts)}</b>концептов</span>
    <span class="catalog-metric"><b>${fmt(totals.activePaths)}</b>активных путей</span>
    <span class="catalog-metric"><b>${fmt(totals.subtheme2)}</b>конечных категорий</span>
    <span class="catalog-metric"><b>${fmt(totals.blocks)}</b>блоков данных</span>
  </div>`;
}

function searchBox(value = '', placeholder = 'Название, мнемоника или метаданные…', id = 'catalog-query') {
  return `<label class="catalog-searchbox"><span>⌕</span><input id="${id}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off"><kbd>Enter</kbd></label>`;
}

function blockCards(active = '') {
  return `<div class="catalog-block-grid">${blocks.map((block, index) => `<button class="catalog-block ${block.alias === active ? 'active' : ''}" data-block="${esc(block.alias)}">
    <span class="catalog-block-index"><span>БЛОК ${String(index + 1).padStart(2, '0')}</span><span>${fmt(block.totalSeries)}</span></span>
    <h3>${esc(block.name)}</h3><p>${esc(block.description)}</p><div class="catalog-block-count">${manifest?.demo ? `В локальном срезе: ${fmt(block.demoSeries)}` : `Доступно: ${fmt(block.totalSeries)}`}</div>
  </button>`).join('')}</div>`;
}

function card(indicator, fromView, fromState) {
  return `<article class="catalog-card" tabindex="0" data-series-id="${esc(indicator.seriesId)}" data-from-view="${esc(fromView)}" data-return-state="${esc(JSON.stringify(fromState))}">
    <div><h3>${esc(indicator.name)}</h3><div class="catalog-card-code">${esc(indicator.mnemonic)}</div>
    <div class="catalog-card-meta"><span>${esc(indicator.geography?.name || indicator.geography?.code)}</span><span>${esc(indicator.frequency?.label)}</span><span>${esc(indicator.unit?.code)}</span><span>${esc(indicator.source?.label)}</span></div></div><span class="catalog-card-arrow">→</span>
  </article>`;
}

function cards(response, view, state) {
  if (response.requiresRefinement) return `<div class="catalog-empty"><div><b>Уточните выборку</b>После выбора блока добавьте тему, атрибут или поисковый запрос. Массовая выдача по одному блоку не открывается.</div></div>`;
  if (!response.items?.length) return `<div class="catalog-empty"><div><b>Ничего не найдено</b>Измените запрос или снимите часть фильтров.</div></div>`;
  return `<div class="catalog-result-head"><span>Найдено в локальном наборе: ${fmt(response.total)}</span><span>по ${response.limit} на страницу</span></div><div class="catalog-result-list">${response.items.map(item => card(item, view, state)).join('')}</div>${response.nextCursor ? `<button class="catalog-loadmore" data-next-cursor="${response.nextCursor}">Показать ещё</button>` : ''}`;
}

function apiParams(state) {
  const allowed = ['q', 'block', 'topic', 'theme', 'subtheme', 'subtheme2', 'source', 'frequency', 'unit', 'geographyScope', 'geography', 'cursor', 'limit'];
  return Object.fromEntries(allowed.filter(key => state[key]).map(key => [key, state[key]]));
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

function bindCards(root) {
  root.querySelectorAll('.catalog-card').forEach(element => {
    const open = () => navigate('catalog-indicator', {
      id: element.dataset.seriesId,
      from: element.dataset.fromView,
      returnState: element.dataset.returnState,
    });
    element.addEventListener('click', open);
    element.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') open(); });
  });
}

async function initData() {
  if (manifest) return;
  [manifest, { items: blocks }] = await Promise.all([catalogApi.manifest(), catalogApi.blocks()]);
}

async function renderOverview() {
  const view = 'catalog';
  const root = mount(view);
  const state = currentState(view);
  root.innerHTML = `${header(view)}${metricStrip()}${searchBox(state.q)}<div><div class="catalog-panel-title">15 блоков данных</div>${blockCards(state.block)}</div><div id="catalog-overview-results"></div>`;
  root.querySelectorAll('[data-block]').forEach(button => button.addEventListener('click', () => navigate('catalog-1', { block: button.dataset.block })));
  const input = root.querySelector('#catalog-query');
  input.addEventListener('keydown', event => { if (event.key === 'Enter') setState(view, { q: input.value.trim(), cursor: null }); });
  if (state.q) {
    const target = root.querySelector('#catalog-overview-results');
    target.innerHTML = '<div class="catalog-empty">Ищу индикаторы…</div>';
    const response = await catalogApi.search(apiParams(state));
    target.innerHTML = cards(response, view, state);
    bindCards(target);
  }
}

async function hierarchy(level, state, taxonomy = '4') {
  const levels = taxonomy === '3' ? LEVELS_3 : LEVELS_4;
  const index = levels.indexOf(level);
  const previous = index > 0 ? levels[index - 1] : null;
  return catalogApi.hierarchy({
    level,
    taxonomy,
    block: state.block,
    ...(previous && state[previous] ? { parent: state[previous] } : {}),
    ...Object.fromEntries(levels.slice(0, index).filter(key => state[key]).map(key => [key, state[key]])),
  });
}

function breadcrumb(state, levels) {
  const parts = [`<button data-reset-level="block">Все блоки</button>`];
  const block = blocks.find(item => item.alias === state.block);
  if (block) parts.push(`<i>›</i><button data-reset-level="topic">${esc(block.name)}</button>`);
  levels.forEach((level, index) => {
    if (state[`${level}Name`]) parts.push(`<i>›</i><button data-reset-level="${levels[index + 1] || 'leaf'}">${esc(state[`${level}Name`])}</button>`);
  });
  return `<div class="catalog-breadcrumbs">${parts.join('')}</div>`;
}

function facetPanel(facets, state, dimensions = ['source', 'frequency', 'geographyScope', 'unit']) {
  return dimensions.map(dimension => `<div class="catalog-filter-group"><h4>${FACET_LABELS[dimension]}<button data-clear-facet="${dimension}">сбросить</button></h4>${(facets[dimension] || []).slice(0, 12).map(item => `<label class="catalog-check"><input type="checkbox" data-facet="${dimension}" value="${esc(item.value)}" ${asList(state[dimension]).includes(item.value) ? 'checked' : ''}><span>${esc(item.label || item.value)}</span><em>${fmt(item.count)}</em></label>`).join('') || '<span class="catalog-card-code">Нет вариантов</span>'}</div>`).join('');
}

function bindFacetPanel(root, view) {
  root.querySelectorAll('[data-facet]').forEach(input => input.addEventListener('change', () => {
    const dimension = input.dataset.facet;
    const selected = [...root.querySelectorAll(`[data-facet="${dimension}"]:checked`)].map(item => item.value);
    setState(view, { [dimension]: selected, cursor: null });
  }));
  root.querySelectorAll('[data-clear-facet]').forEach(button => button.addEventListener('click', () => setState(view, { [button.dataset.clearFacet]: null, cursor: null })));
}

async function renderCatalog1() {
  const view = 'catalog-1';
  const root = mount(view);
  const state = currentState(view);
  const taxonomy = state.taxonomy === '3' ? '3' : '4';
  const levels = taxonomy === '3' ? LEVELS_3 : LEVELS_4;
  const selectedLeaf = state[levels.at(-1)];
  root.innerHTML = `${header(view, `<div class="catalog-chipbar"><button class="catalog-chip ${taxonomy === '4' ? 'active' : ''}" data-taxonomy="4">4 уровня</button><button class="catalog-chip ${taxonomy === '3' ? 'active' : ''}" data-taxonomy="3">3 уровня</button></div>`)}${breadcrumb(state, levels)}${state.block ? '<div class="catalog-levels" id="catalog-levels"></div>' : blockCards()}<div id="catalog-leaf"></div>`;
  root.querySelectorAll('[data-block]').forEach(button => button.addEventListener('click', () => setState(view, { block: button.dataset.block })));
  root.querySelectorAll('[data-taxonomy]').forEach(button => button.addEventListener('click', () => setState(view, { taxonomy: button.dataset.taxonomy, topic: null, theme: null, subtheme: null, subtheme2: null })));
  root.querySelectorAll('[data-reset-level]').forEach(button => button.addEventListener('click', () => {
    const level = button.dataset.resetLevel;
    const patch = {};
    if (level === 'block') ['block', ...LEVELS_4].forEach(key => patch[key] = null);
    else levels.slice(Math.max(0, levels.indexOf(level))).forEach(key => { patch[key] = null; patch[`${key}Name`] = null; });
    setState(view, patch);
  }));
  if (!state.block) return;
  const responses = await Promise.all(levels.map((level, index) => index === 0 || state[levels[index - 1]] ? hierarchy(level, state, taxonomy) : Promise.resolve({ items: [] })));
  const levelRoot = root.querySelector('#catalog-levels');
  levelRoot.innerHTML = responses.map((response, index) => `<div class="catalog-level"><h3>${LEVEL_LABELS[levels[index]]}</h3>${response.items.map(node => `<button class="catalog-node ${state[levels[index]] === node.alias ? 'active' : ''}" data-level="${levels[index]}" data-alias="${esc(node.alias)}" data-name="${esc(node.name)}"><span>${esc(node.name)}</span><small>${fmt(node.count)}</small></button>`).join('') || '<div class="catalog-empty">Выберите предыдущий уровень</div>'}</div>`).join('');
  levelRoot.querySelectorAll('[data-level]').forEach(button => button.addEventListener('click', () => {
    const level = button.dataset.level;
    const patch = { [level]: button.dataset.alias, [`${level}Name`]: button.dataset.name, cursor: null };
    levels.slice(levels.indexOf(level) + 1).forEach(key => { patch[key] = null; patch[`${key}Name`] = null; });
    setState(view, patch);
  }));
  if (!selectedLeaf) return;
  const [facetResponse, resultResponse] = await Promise.all([catalogApi.facets(apiParams(state)), catalogApi.indicators({ ...apiParams(state), allowBlockOnly: 1 })]);
  const leaf = root.querySelector('#catalog-leaf');
  leaf.innerHTML = `<div class="catalog-layout"><aside class="catalog-panel">${facetPanel(facetResponse.facets, state)}</aside><section>${cards(resultResponse, view, state)}</section></div>`;
  bindFacetPanel(leaf, view); bindCards(leaf);
}

async function taxonomySelects(state) {
  const result = [];
  for (let index = 0; index < LEVELS_4.length; index += 1) {
    const level = LEVELS_4[index];
    if (index > 0 && !state[LEVELS_4[index - 1]]) break;
    result.push({ level, items: (await hierarchy(level, state, '4')).items });
  }
  return result;
}

async function renderCatalog2() {
  const view = 'catalog-2';
  const root = mount(view);
  const state = currentState(view);
  root.innerHTML = `${header(view)}<div class="catalog-chipbar">${blocks.map(block => `<button class="catalog-chip ${state.block === block.alias ? 'active' : ''}" data-block="${esc(block.alias)}">${esc(block.name)}</button>`).join('')}</div>${searchBox(state.q)}<div class="catalog-layout three"><aside class="catalog-panel sticky" id="catalog-taxonomy-filter"></aside><main id="catalog-filter-results"><div class="catalog-empty">Подготавливаю выборку…</div></main><aside class="catalog-panel sticky" id="catalog-attribute-filter"></aside></div>`;
  root.querySelectorAll('[data-block]').forEach(button => button.addEventListener('click', () => setState(view, { block: button.dataset.block, topic: null, theme: null, subtheme: null, subtheme2: null, cursor: null })));
  const input = root.querySelector('#catalog-query');
  input.addEventListener('keydown', event => { if (event.key === 'Enter') setState(view, { q: input.value.trim(), cursor: null }); });
  const [selects, facetResponse, resultResponse] = await Promise.all([
    taxonomySelects(state),
    catalogApi.facets(apiParams(state)),
    catalogApi.indicators(apiParams(state)),
  ]);
  const taxonomyRoot = root.querySelector('#catalog-taxonomy-filter');
  taxonomyRoot.innerHTML = `<div class="catalog-panel-title">Тематика</div>${selects.map(({ level, items }) => `<div class="catalog-select"><label>${LEVEL_LABELS[level]}</label><select data-taxonomy-select="${level}"><option value="">Все</option>${items.map(item => `<option value="${esc(item.alias)}" ${state[level] === item.alias ? 'selected' : ''}>${esc(item.name)} (${fmt(item.count)})</option>`).join('')}</select></div>`).join('')}`;
  taxonomyRoot.querySelectorAll('[data-taxonomy-select]').forEach(select => select.addEventListener('change', () => {
    const level = select.dataset.taxonomySelect;
    const patch = { [level]: select.value || null, [`${level}Name`]: select.selectedOptions[0]?.textContent?.replace(/ \([\d\s]+\)$/, '') || '', cursor: null };
    LEVELS_4.slice(LEVELS_4.indexOf(level) + 1).forEach(key => { patch[key] = null; patch[`${key}Name`] = null; });
    setState(view, patch);
  }));
  const facetRoot = root.querySelector('#catalog-attribute-filter');
  facetRoot.innerHTML = `<div class="catalog-panel-title">Атрибуты</div>${facetPanel(facetResponse.facets, state)}`;
  bindFacetPanel(facetRoot, view);
  const resultRoot = root.querySelector('#catalog-filter-results');
  resultRoot.innerHTML = cards(resultResponse, view, state); bindCards(resultRoot);
}

async function renderCatalog3() {
  const view = 'catalog-3';
  const root = mount(view);
  const state = currentState(view);
  root.innerHTML = `${header(view)}<div class="catalog-direct"><div class="catalog-direct-copy"><h2>Какой показатель вы ищете?</h2><p>Введите название, мнемонику, регион, источник или экономический термин</p><div class="catalog-direct-examples"><button>инфляция Россия</button><button>ключевая ставка</button><button>${esc(manifest.exactMnemonic)}</button></div></div><div class="catalog-suggest">${searchBox(state.q, 'Например: ставки по ипотеке, RU75 или точная мнемоника', 'catalog-direct-query')}<div id="catalog-suggestions"></div></div><div id="catalog-direct-results" style="margin-top:18px"></div></div>`;
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
  root.querySelectorAll('.catalog-direct-examples button').forEach(button => button.addEventListener('click', () => submit(button.textContent)));
  if (state.q) { const response = await catalogApi.search(apiParams(state)); resultRoot.innerHTML = cards(response, view, state); bindCards(resultRoot); }
  setTimeout(() => input.focus(), 0);
}

async function renderIndicator() {
  const view = 'catalog-indicator';
  const root = mount(view);
  const state = currentState(view);
  const indicator = await catalogApi.indicator(state.id);
  const taxonomy = indicator.taxonomy4;
  const backLabel = VIEW_TITLES[state.from]?.[0] || 'Каталог';
  root.innerHTML = `<div class="catalog-detail"><button class="catalog-detail-back">← Вернуться: ${esc(backLabel)}</button><section class="catalog-detail-hero"><span class="catalog-demo-badge">${manifest?.demo ? 'Демонстрационный набор' : 'Полный набор'}</span><h1>${esc(indicator.name)}</h1><div class="catalog-detail-code">${esc(indicator.mnemonic)}</div><div class="catalog-detail-grid">
    <div class="catalog-detail-field"><small>Источник</small><b>${esc(indicator.source?.label)}</b></div><div class="catalog-detail-field"><small>География</small><b>${esc(indicator.geography?.name || indicator.geography?.code)}</b></div><div class="catalog-detail-field"><small>Частота</small><b>${esc(indicator.frequency?.label)}</b></div>
    <div class="catalog-detail-field"><small>Единица</small><b>${esc(indicator.unit?.code)}</b></div><div class="catalog-detail-field"><small>Код показателя</small><b>${esc(indicator.indicatorCode)}</b></div><div class="catalog-detail-field"><small>Концепт</small><b>${esc(indicator.conceptKey)}</b></div>
  </div><div class="catalog-path"><b>Тематический путь:</b> ${esc(taxonomy?.path || [taxonomy?.topic?.name, taxonomy?.theme?.name, taxonomy?.subtheme?.name, taxonomy?.subtheme2?.name].filter(Boolean).join(' › '))}<br><b>Блоки:</b> ${esc((indicator.blocks?.all || []).map(block => block.name).join(' · '))}</div>${indicator.availability?.hasTimeSeries ? '<div id="catalog-indicator-chart"></div>' : '<div class="catalog-no-chart">Для этой записи доступны классификационные метаданные. Наблюдения временного ряда в локальный набор не входят, поэтому график не строится.</div>'}</section></div>`;
  root.querySelector('.catalog-detail-back').addEventListener('click', () => {
    let returnState = {};
    try { returnState = JSON.parse(state.returnState || '{}'); } catch { returnState = {}; }
    navigate(state.from && CATALOG_VIEWS.has(state.from) ? state.from : 'catalog', returnState);
  });
}

async function render(view) {
  const root = mount(view);
  if (!root) return;
  root.innerHTML = '<div class="catalog-empty">Загрузка каталога…</div>';
  try {
    await initData();
    if (view === 'catalog') await renderOverview();
    if (view === 'catalog-1') await renderCatalog1();
    if (view === 'catalog-2') await renderCatalog2();
    if (view === 'catalog-3') await renderCatalog3();
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
  if (!item) return;
  const view = item.dataset.view;
  if (!['home', 'catalog', 'catalog-1', 'catalog-2', 'catalog-3'].includes(view)) return;
  event.preventDefault(); event.stopImmediatePropagation();
  if (view === 'home') { history.pushState(null, '', location.pathname); window.goto?.('home'); }
  else navigate(view, currentState(view));
}, true);

window.addEventListener('popstate', activateRoute);
window.addEventListener('hashchange', activateRoute);
window.catalogApp = { render, navigate, activateRoute };
activateRoute();
