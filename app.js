import { INDICATORS, DISTRICTS, MEASURES, BUDGET, HORIZON, BASELINE, calculate, getAdditionIssue, getScenarioIssue } from './model.js';
import { MAP_DISTRICTS, MAP_RIVER, MAP_LAKES } from './map-geometry.js';
import { layoutMapObjects, mapLabelPosition, projectMapPoint } from './map-objects.js';
import { renderMapObject } from './map-object-art.js';
import { translate as t, formatNumber, groupName, measureName, districtName, indicatorName, indicatorDescription, setLanguage, getLanguage, loadLanguage, saveLanguage, SUPPORTED_LANGUAGES } from './i18n.js';

setLanguage(loadLanguage());

const $ = selector => document.querySelector(selector);
const state = { decisions: [], selectedMeasureId: null, focusedDistrictId: null, filter: 'Все', draggingId: null, hoverTarget: null, indicatorsOpen: false, reportTab: 'city', status: null, statusError: false };
const measureById = Object.fromEntries(MEASURES.map(measure => [measure.id, measure]));
const districtById = Object.fromEntries(DISTRICTS.map(district => [district.id, district]));
let toastTimer;
let toastMessage = null;
let previewTarget = null;
const escapeHTML = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const text = (key, params) => escapeHTML(t(key, params));
const project = projectMapPoint;
let mapObjects = [];
const projection = 'matrix(.9 -.28 .38 .64 -88 242)';
const districtColors = { nura: ['#eeb090', '#ce9475'], esil: ['#acd58f', '#84ae6b'], saryarka: ['#ead08b', '#c6ab64'], baikonur: ['#9bcfc1', '#73a999'], almaty: ['#b4bce1', '#8597c1'] };

function buildMap() {
  $('#mapCamera').classList.add('map-camera');
  $('#mapCamera').innerHTML = MAP_DISTRICTS.map(district => {
    const point = mapLabelPosition(district);
    const [color, side] = districtColors[district.id];
    return `<g class="district" data-district="${district.id}" tabindex="0" role="button" aria-label="${text('ui.districtAria', { name: districtName(district.id) })}" style="--district-color:${color};--district-side:${side}">
      <g transform="translate(0 23)"><path class="district-ground-shadow" transform="${projection}" d="${district.path}"/></g>
      <g transform="translate(0 13)"><path class="district-depth" transform="${projection}" d="${district.path}"/></g>
      <g transform="${projection}"><path class="district-shape" d="${district.path}"/><path class="district-road" d="${district.roads}"/>${district.id === 'nura' || district.id === 'esil' ? `<path d="${MAP_LAKES[district.id === 'nura' ? 0 : 1]}" fill="#8dc4ae" opacity=".65" pointer-events="none"/>` : ''}</g>
      <text class="district-label" x="${point.x}" y="${point.y - 5}">${escapeHTML(districtName(district.id))}</text><text class="district-score" x="${point.x}" y="${point.y + 14}" data-score-for="${district.id}"></text>
    </g>`;
  }).join('') + `<g transform="${projection}" pointer-events="none"><path class="river" d="${MAP_RIVER}"/><path class="river-highlight" d="${MAP_RIVER}"/></g><g id="mapObjects" class="map-objects" role="group" aria-label="${text('ui.mapObjects')}"></g>`;
}

function renderScenarioObjects() {
  mapObjects = layoutMapObjects(state.decisions, mapObjects);
  const layer = $('#mapObjects');
  const existing = new Map([...layer.children].map(element => [element.dataset.objectKey, element]));
  for (const item of mapObjects) {
    let element = existing.get(item.key);
    if (!element) {
      element = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      element.classList.add('map-object');
      element.dataset.objectKey = item.key;
      element.dataset.district = item.districtId;
      element.dataset.measureId = item.measureId;
      element.setAttribute('role', 'img');
      element.innerHTML = `<title></title><g class="map-object-art">${renderMapObject(item.measureId)}</g>`;
    }
    const label = `${measureName(item.measureId)} — ${districtName(item.districtId)}`;
    element.setAttribute('aria-label', label);
    element.querySelector('title').textContent = label;
    element.setAttribute('transform', `translate(${item.x} ${item.y}) scale(${item.scale})`);
    element.classList.toggle('muted', Boolean(state.focusedDistrictId && state.focusedDistrictId !== item.districtId));
    // Keep existing nodes so focusing a district does not replay their entrance animation.
    layer.append(element);
    existing.delete(item.key);
  }
  existing.forEach(element => element.remove());
}

function format(value, digits = 2) { return formatNumber(value, digits); }
function signed(value, digits = 2) { return `${value >= 0 ? '+' : '−'}${format(Math.abs(value), digits)}`; }
function getTargetName(decision) { return decision.districtId ? districtName(decision.districtId) : t('ui.wholeCity'); }
function showToast(message) {
  toastMessage = message;
  const toast = $('#toast');
  toast.textContent = t(message.key, message.params);
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.classList.remove('show'); toastMessage = null; }, 3000);
}
function setStatus(message, error = false) {
  state.status = message || null;
  state.statusError = error;
  renderStatus();
  if (error && message) showToast(message);
}
function renderStatus() {
  const element = $('#statusMessage');
  element.textContent = state.status ? t(state.status.key, state.status.params) : '';
  element.classList.toggle('error', state.statusError);
  if (toastMessage) $('#toast').textContent = t(toastMessage.key, toastMessage.params);
}
function current() { return calculate(state.decisions); }
function districtResult(result, id) { return result.districts.find(district => district.id === id); }

function renderCatalog() {
  const visible = MEASURES.filter(measure => state.filter === 'Все' || measure.group === state.filter);
  $('#catalogList').innerHTML = visible.length ? visible.map(measure => {
    const used = state.decisions.some(decision => decision.id === measure.id);
    return `<div class="measure-card ${used ? 'used' : ''} ${state.selectedMeasureId === measure.id ? 'selected' : ''}" data-measure="${measure.id}" draggable="${!used}" role="button" tabindex="${used ? -1 : 0}" aria-label="${text('ui.measureAria', { id: measure.id, name: measureName(measure.id), cost: format(measure.cost, 0), scope: t(measure.scope === 'city' ? 'ui.wholeCity' : 'ui.oneDistrict') })}">
      <div class="measure-head"><span class="measure-id">${measure.id}</span><span class="measure-scope measure-scope--${measure.scope}" title="${text(measure.scope === 'city' ? 'ui.scopeCity' : 'ui.scopeDistrict')}"><img src="./svg/${measure.scope}.svg" width="18" height="18" alt="">${text(`ui.${measure.scope}`)}</span></div>
      <div class="measure-name">${escapeHTML(measureName(measure.id))}</div>
      <div class="measure-meta"><span class="measure-group">${escapeHTML(groupName(measure.group))}</span><span class="measure-lag">${text('ui.lag', { value: format(measure.lag, 0) })}</span><span class="measure-cost">${text('ui.units', { value: format(measure.cost, 0) })}</span></div>
    </div>`;
  }).join('') : `<div class="empty-slot">${text('ui.emptyResults')}</div>`;
  $$('#filterRow .filter-chip').forEach(button => {
    const active = button.dataset.filter === state.filter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}
function $$(selector) { return [...document.querySelectorAll(selector)]; }

function renderPlan() {
  const result = current();
  const count = state.decisions.length;
  $('#decisionCount').textContent = `${count} / 5`;
  $('#spentValue').textContent = format(result.spent, 0);
  $('#remainingValue').textContent = t('ui.units', { value: format(BUDGET - result.spent, 0) });
  $('#budgetFill').style.width = `${result.spent}%`;
  $('#budgetFill').classList.toggle('danger', result.spent > 85);
  $('#decisionList').innerHTML = state.decisions.map((decision, index) => {
    const measure = measureById[decision.id];
    return `<div class="decision-item"><span class="decision-number">0${index + 1}</span><div class="decision-copy" title="${escapeHTML(`${measureName(measure.id)} — ${getTargetName(decision)} / ${groupName(measure.group)}`)}"><strong>${escapeHTML(measureName(measure.id))}</strong><span>${measure.id} / ${escapeHTML(getTargetName(decision))} / ${escapeHTML(groupName(measure.group))}</span></div><span class="decision-cost">${format(measure.cost, 0)}</span><button class="remove-button" type="button" data-remove="${decision.id}" aria-label="${text('ui.removeMeasure', { name: measureName(measure.id) })}">×</button></div>`;
  }).join('') + Array.from({ length: 5 - count }, (_, index) => `<div class="empty-slot" aria-label="${text('ui.emptyDecision', { index: count + index + 1 })}"><span>0${count + index + 1}</span>＋</div>`).join('');
  $('#calculateButton').disabled = Boolean(getScenarioIssue(state.decisions));
}

function indicatorValues(result) {
  const district = state.focusedDistrictId && districtResult(result, state.focusedDistrictId);
  if (district) return district.values;
  return INDICATORS.map((_, index) => result.districts.reduce((sum, item) => sum + item.population * item.values[index], 0));
}
function renderIndicators(result = current()) {
  const panel = $('#indicatorPanel');
  $('#pulse').classList.toggle('expanded', state.indicatorsOpen);
  $('#pulseContent').inert = !state.indicatorsOpen;
  $('#orbButton').setAttribute('aria-expanded', String(state.indicatorsOpen));
  $('#orbButton').setAttribute('aria-label', t(state.indicatorsOpen ? 'ui.closeIndicators' : 'ui.openIndicators'));
  if (!state.indicatorsOpen) return;
  const values = indicatorValues(result);
  let previousGroup = '';
  panel.innerHTML = INDICATORS.map((indicator, index) => {
    const group = indicator.group !== previousGroup ? `<div class="indicator-group">${escapeHTML(groupName(indicator.group).toLocaleUpperCase(getLanguage()))}</div>` : '';
    previousGroup = indicator.group;
    return `${group}<div class="indicator-row ${values[index] < 40 ? 'critical' : ''}" tabindex="0" data-description="${escapeHTML(`${indicatorName(indicator.code)}. ${indicatorDescription(indicator.code)}`)}" aria-label="${escapeHTML(`${indicator.code}, ${indicatorName(indicator.code)}: ${format(values[index], 1)}. ${indicatorDescription(indicator.code)}`)}"><code>${indicator.code}</code><span class="indicator-track"><i style="width:${values[index]}%"></i></span><b>${format(values[index], 0)}</b></div>`;
  }).join('');
}

function renderMap() {
  const result = current();
  const district = state.focusedDistrictId && districtResult(result, state.focusedDistrictId);
  const score = district ? district.score : result.score;
  const baseline = district ? district.baselineScore : BASELINE.score;
  const delta = score - baseline;
  const orb = $('#pulse');
  orb.classList.toggle('alert', score < 55);
  orb.style.setProperty('--orb-a', score < 55 ? '#d7ac4f' : score < 60 ? '#70bfdf' : '#369dcc');
  orb.style.setProperty('--orb-b', '#f5dfa1');
  orb.style.setProperty('--orb-c', '#a7d9ed');
  $('#orbScope').textContent = district ? districtName(district.id) : t('ui.cityName');
  $('#orbScore').textContent = format(score);
  $('#orbChange').textContent = state.decisions.length ? t('ui.baselineChange', { value: signed(delta) }) : t('ui.outOf100');
  $('#mapScope').textContent = district ? districtName(district.id) : t('ui.districtsCount');
  $('#mapObjects').setAttribute('aria-label', t('ui.mapObjects'));
  $('#cityMap').classList.toggle('has-focus', Boolean(district));
  $$('.district').forEach(element => {
    element.setAttribute('aria-label', t('ui.districtAria', { name: districtName(element.dataset.district) }));
    element.querySelector('.district-label').textContent = districtName(element.dataset.district);
    element.classList.toggle('focused', element.dataset.district === state.focusedDistrictId);
    element.classList.toggle('drop-target', element.dataset.district === state.hoverTarget);
  });
  $$('.district-score').forEach(element => { element.textContent = format(districtResult(result, element.dataset.scoreFor).score); });
  const center = district ? project(MAP_DISTRICTS.find(item => item.id === district.id).centroid) : null;
  const zoom = district ? 1.85 : 1;
  $('#mapCamera').style.transform = center ? `translate(${450 - center.x * zoom}px, ${350 - center.y * zoom}px) scale(${zoom})` : 'translate(0px, 0px) scale(1)';
  renderScenarioObjects();
  renderIndicators(result);
}

function render() { renderCatalog(); renderPlan(); renderMap(); }
function selectMeasure(id) {
  if (state.decisions.some(decision => decision.id === id)) return;
  state.selectedMeasureId = state.selectedMeasureId === id ? null : id;
  renderCatalog();
  if (state.selectedMeasureId) setStatus({ key: measureById[id].scope === 'city' ? 'ui.selectCity' : 'ui.selectDistrict' });
  else setStatus('');
}
function addMeasure(id, districtId = null) {
  if (measureById[id]?.scope === 'city') districtId = null;
  const error = getAdditionIssue(state.decisions, id, districtId);
  if (error) { setStatus(error, true); return false; }
  state.decisions.push({ id, ...(districtId ? { districtId } : {}) });
  state.selectedMeasureId = null;
  state.hoverTarget = null;
  render();
  setStatus('');
  return true;
}
function focusDistrict(id) {
  state.focusedDistrictId = state.focusedDistrictId === id ? null : id;
  state.indicatorsOpen = Boolean(state.focusedDistrictId);
  renderMap();
}

function renderPreview(id, districtId) {
  const measure = measureById[id];
  const preview = $('#dropPreview');
  if (!measure) { preview.classList.add('hidden'); previewTarget = null; return; }
  if (measure.scope === 'city') districtId = null;
  previewTarget = { id, districtId };
  const error = getAdditionIssue(state.decisions, id, districtId);
  const target = districtId ? districtName(districtId) : t('ui.wholeCity');
  if (error) {
    preview.innerHTML = `<span class="preview-kicker">${escapeHTML(target)}</span><p>${text(error.key, error.params)}</p>`;
  } else {
    const before = current();
    const after = calculate([...state.decisions, { id, ...(districtId ? { districtId } : {}) }]);
    const beforeScore = districtId ? districtResult(before, districtId).score : before.score;
    const afterScore = districtId ? districtResult(after, districtId).score : after.score;
    const getValues = result => districtId ? districtResult(result, districtId).values : INDICATORS.map((_, index) => result.districts.reduce((sum, item) => sum + item.population * item.values[index], 0));
    const beforeValues = getValues(before);
    const afterValues = getValues(after);
    preview.innerHTML = `<span class="preview-kicker">${escapeHTML(target)}</span><h3>${escapeHTML(measureName(measure.id))}</h3>${INDICATORS.map((indicator, index) => {
      const delta = afterValues[index] - beforeValues[index];
      return `<div class="preview-metric"><span>${indicator.code}</span><span class="preview-track"><i style="width:${beforeValues[index]}%"></i><i class="preview-effect ${delta < 0 ? 'negative' : ''}" style="left:${Math.min(beforeValues[index], afterValues[index])}%;width:${Math.abs(delta)}%"></i></span><span class="preview-values"><small>${format(beforeValues[index], 0)}</small><b class="${delta < 0 ? 'negative' : ''}">${delta ? signed(delta, 1) : '—'}</b></span></div>`;
    }).join('')}<div class="preview-score"><span>${format(beforeScore)} →</span><strong>${format(afterScore)} <small>${signed(afterScore - beforeScore)}</small></strong></div>`;
  }
  preview.classList.remove('hidden');
}
function positionPreview(event) {
  const preview = $('#dropPreview');
  if (preview.classList.contains('hidden')) return;
  const rect = $('#mapCard').getBoundingClientRect();
  const width = Math.min(240, rect.width - 16);
  preview.style.width = `${width}px`;
  const height = preview.offsetHeight;
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const candidates = [
    { left: 8, top: 76 },
    { left: Math.max(8, rect.width - width - 8), top: 76 },
    { left: 8, top: Math.max(76, rect.height - height - 70) },
    { left: Math.max(8, rect.width - width - 8), top: Math.max(76, rect.height - height - 70) }
  ];
  const distance = point => Math.hypot(x - Math.max(point.left, Math.min(x, point.left + width)), y - Math.max(point.top, Math.min(y, point.top + height)));
  candidates.sort((a, b) => distance(b) - distance(a));
  preview.style.left = `${candidates[0].left}px`;
  preview.style.top = `${candidates[0].top}px`;
}
function clearPreview() {
  previewTarget = null;
  state.hoverTarget = null;
  $('#dropPreview').classList.add('hidden');
  $$('.district').forEach(element => element.classList.remove('drop-target'));
  $('#cityMap').classList.remove('dragging');
}

function reportInsight(result) {
  const ranked = [...result.districts].sort((a, b) => (b.score - b.baselineScore) - (a.score - a.baselineScore));
  const weakest = [...result.districts].sort((a, b) => a.score - b.score)[0];
  const best = ranked[0];
  return { weakest, best, mostImproved: best.score - best.baselineScore };
}
function reportMetricRows(result, districtId = null) {
  const after = districtId ? districtResult(result, districtId).values : INDICATORS.map((_, index) => result.districts.reduce((sum, district) => sum + district.population * district.values[index], 0));
  const before = districtId ? districtById[districtId].values : INDICATORS.map((_, index) => DISTRICTS.reduce((sum, district) => sum + district.population * district.values[index], 0));
  return INDICATORS.map((item, index) => `<div class="report-line"><span class="report-line-name">${item.code} / ${escapeHTML(indicatorName(item.code))}</span><span class="report-line-track"><i style="width:${after[index]}%"></i></span><b class="${after[index] - before[index] < 0 ? 'negative' : 'positive'}">${signed(after[index] - before[index], 1)}</b></div>`).join('');
}
function reportActions(decisions) {
  return `<div class="report-actions">${decisions.map(decision => `<span title="${escapeHTML(measureName(decision.id))}">${decision.id}<small>${escapeHTML(getTargetName(decision))}</small></span>`).join('') || `<span>${text('report.noMeasures')}</span>`}</div>`;
}
function renderReportContent() {
  const result = current();
  const selected = state.reportTab;
  const city = selected === 'city';
  const district = city ? null : districtResult(result, selected);
  const { weakest, best, mostImproved } = reportInsight(result);
  let strengths, risks, consequence;
  let applied = state.decisions;
  if (city) {
    strengths = t('report.cityStrength', { name: districtName(best.id), value: signed(mostImproved) });
    risks = `${t('report.cityRisk', { name: districtName(weakest.id), value: format(weakest.score) })} ${result.critical ? t('report.criticalCount', { value: format(result.critical, 0) }) : t('report.noCritical')}`;
    consequence = t('report.cityConsequences', { spent: format(result.spent, 0), budget: BUDGET });
  } else {
    const changed = INDICATORS.map((indicator, index) => ({ ...indicator, delta: district.values[index] - districtById[selected].values[index], value: district.values[index] }));
    const strongest = [...changed].sort((a, b) => b.delta - a.delta)[0];
    const lowest = [...changed].sort((a, b) => a.value - b.value)[0];
    strengths = strongest.delta > 0 ? t('report.districtStrength', { name: indicatorName(strongest.code), value: signed(strongest.delta, 1) }) : t('report.noDistrictChange');
    risks = `${t('report.districtRisk', { name: indicatorName(lowest.code), value: format(lowest.value, 1) })}${lowest.value < 40 ? ` ${t('report.belowCritical')}` : ''}`;
    consequence = t('report.districtConsequences', { value: signed(district.score - district.baselineScore), population: format(district.population * 100, 0) });
    applied = state.decisions.filter(decision => !decision.districtId || decision.districtId === selected);
  }
  const stats = city ? [[t('report.average'), format(result.average)], [t('report.minimum'), format(result.weakest)], [t('report.critical'), format(result.critical, 0)]] : [[t('report.current'), format(district.baselineScore)], [t('report.forecast'), format(district.score)], [t('report.change'), signed(district.score - district.baselineScore)]];
  $('#reportContent').innerHTML = `<section class="report-card" data-pane="metrics"><h2>${escapeHTML(city ? t('ui.wholeCity') : districtName(district.id))}</h2><div class="report-stat-grid">${stats.map(([name, value]) => `<div class="report-stat"><span>${escapeHTML(name)}</span><strong>${value}</strong></div>`).join('')}</div><div class="report-metrics">${reportMetricRows(result, city ? null : selected)}</div></section><section class="report-card" data-pane="analysis"><h2>${text('report.changesTitle')}</h2><div class="report-narratives"><div class="report-narrative"><strong>${text('report.strength')}</strong><p>${escapeHTML(strengths)}</p></div><div class="report-narrative"><strong>${text('report.risk')}</strong><p>${escapeHTML(risks)}</p></div><div class="report-narrative"><strong>${text('report.consequences')}</strong><p>${escapeHTML(consequence)}</p></div></div>${reportActions(applied)}</section>`;
}
function renderReport() {
  const result = current();
  $('#reportScore').textContent = format(result.score);
  $('#reportBaseline').textContent = format(BASELINE.score);
  $('#reportDelta').textContent = t('ui.baselineComparison', { value: signed(result.score - BASELINE.score) });
  $('#reportDelta').classList.toggle('negative', result.score < BASELINE.score);
  $('#reportTabs').innerHTML = [{ id: 'city', name: t('ui.wholeCity') }, ...DISTRICTS.map(d => ({ id: d.id, name: districtName(d.id) }))].map(tab => `<button class="report-tab ${state.reportTab === tab.id ? 'active' : ''}" type="button" data-report-tab="${tab.id}">${escapeHTML(tab.name)}</button>`).join('');
  renderReportContent();
}
function openReport() {
  const error = getScenarioIssue(state.decisions);
  if (error) { setStatus(error, true); return; }
  state.reportTab = 'city';
  renderReport();
  $('#planningView').classList.add('hidden');
  $('#reportView').classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function localizeShell() {
  document.documentElement.lang = getLanguage();
  document.title = t('ui.appTitle');
  const params = { value: HORIZON };
  $$('[data-i18n]').forEach(element => { element.textContent = t(element.dataset.i18n, params); });
  $$('[data-i18n-aria]').forEach(element => element.setAttribute('aria-label', t(element.dataset.i18nAria, params)));
  $$('[data-i18n-title]').forEach(element => element.setAttribute('title', t(element.dataset.i18nTitle, params)));
  $$('[data-language]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.language === getLanguage())));
}
function changeLanguage(language) {
  if (!SUPPORTED_LANGUAGES.includes(language) || language === getLanguage()) return;
  const catalogScroll = $('#catalogList').scrollTop;
  setLanguage(language);
  saveLanguage(language);
  localizeShell();
  render();
  $('#catalogList').scrollTop = catalogScroll;
  renderStatus();
  if (previewTarget) renderPreview(previewTarget.id, previewTarget.districtId);
  if (!$('#reportView').classList.contains('hidden')) renderReport();
}
$$('[data-language]').forEach(button => button.addEventListener('click', () => changeLanguage(button.dataset.language)));

$('#catalogList').addEventListener('click', event => { const card = event.target.closest('[data-measure]'); if (card) selectMeasure(card.dataset.measure); });
$('#catalogList').addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { const card = event.target.closest('[data-measure]'); if (card) { event.preventDefault(); selectMeasure(card.dataset.measure); } } });
$('#catalogList').addEventListener('dragstart', event => {
  const card = event.target.closest('[data-measure]');
  if (!card || card.classList.contains('used')) { event.preventDefault(); return; }
  state.draggingId = card.dataset.measure;
  state.indicatorsOpen = false;
  renderIndicators();
  card.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'copy';
  event.dataTransfer.setData('text/plain', state.draggingId);
});
$('#catalogList').addEventListener('dragend', () => { state.draggingId = null; clearPreview(); $$('.measure-card').forEach(card => card.classList.remove('dragging')); });
$('#filterRow').addEventListener('click', event => { const chip = event.target.closest('[data-filter]'); if (chip) { state.filter = chip.dataset.filter; renderCatalog(); } });
$('#decisionList').addEventListener('click', event => { const button = event.target.closest('[data-remove]'); if (button) { state.decisions = state.decisions.filter(decision => decision.id !== button.dataset.remove); render(); setStatus(''); } });

$('#cityMap').addEventListener('click', event => {
  const district = event.target.closest('[data-district]');
  if (!district) return;
  event.stopPropagation();
  const id = district.dataset.district;
  if (state.selectedMeasureId) addMeasure(state.selectedMeasureId, id);
  else focusDistrict(id);
});
$('#cityMap').addEventListener('keydown', event => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const district = event.target.closest('[data-district]');
  if (!district) return;
  event.preventDefault();
  if (state.selectedMeasureId) addMeasure(state.selectedMeasureId, district.dataset.district);
  else focusDistrict(district.dataset.district);
});
$('#mapCard').addEventListener('click', event => {
  if (event.target.closest('button, [data-district]')) return;
  if (state.selectedMeasureId && measureById[state.selectedMeasureId].scope === 'city') {
    addMeasure(state.selectedMeasureId);
    return;
  }
  state.focusedDistrictId = null;
  state.indicatorsOpen = false;
  renderMap();
});
$('#mapCard').addEventListener('dragover', event => {
  const id = state.draggingId || event.dataTransfer.getData('text/plain');
  if (!measureById[id]) return;
  const district = event.target.closest('[data-district]');
  const cityMeasure = measureById[id].scope === 'city';
  const districtId = cityMeasure ? null : district?.dataset.district || null;
  if (!district && !cityMeasure) { clearPreview(); return; }
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
  $('#cityMap').classList.add('dragging');
  const target = districtId || 'city';
  if (state.hoverTarget !== target) {
    state.hoverTarget = target;
    $$('.district').forEach(element => element.classList.toggle('drop-target', cityMeasure || element.dataset.district === districtId));
    renderPreview(id, districtId);
  }
  positionPreview(event);
});
$('#mapCard').addEventListener('drop', event => {
  const id = state.draggingId || event.dataTransfer.getData('text/plain');
  if (!measureById[id]) return;
  event.preventDefault();
  const districtId = event.target.closest('[data-district]')?.dataset.district || null;
  addMeasure(id, districtId);
  state.draggingId = null;
  clearPreview();
});
$('#mapCard').addEventListener('dragleave', event => { if (!$('#mapCard').contains(event.relatedTarget)) clearPreview(); });
$('#orbButton').addEventListener('click', () => { state.indicatorsOpen = !state.indicatorsOpen; renderIndicators(); });
document.addEventListener('click', event => {
  if (state.indicatorsOpen && !event.target.closest('#pulse, [data-district], .language-switcher')) { state.indicatorsOpen = false; renderIndicators(); }
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  state.indicatorsOpen = false;
  state.focusedDistrictId = null;
  state.selectedMeasureId = null;
  if (document.activeElement?.matches('[data-district]')) document.activeElement.blur();
  clearPreview();
  render();
  setStatus('');
});
$('#calculateButton').addEventListener('click', openReport);
$('#reportTabs').addEventListener('click', event => { const tab = event.target.closest('[data-report-tab]'); if (!tab) return; state.reportTab = tab.dataset.reportTab; $$('.report-tab').forEach(item => item.classList.toggle('active', item === tab)); renderReportContent(); });
$('#reportMode').addEventListener('click', event => {
  const button = event.target.closest('[data-mode]');
  if (!button) return;
  $('#reportContent').dataset.mode = button.dataset.mode;
  $$('#reportMode button').forEach(item => item.classList.toggle('active', item === button));
});
$('#backButton').addEventListener('click', () => { $('#reportView').classList.add('hidden'); $('#planningView').classList.remove('hidden'); window.scrollTo({ top: 0, behavior: 'smooth' }); });
$('#restartButton').addEventListener('click', () => { state.decisions = []; state.focusedDistrictId = null; state.selectedMeasureId = null; state.indicatorsOpen = false; $('#reportView').classList.add('hidden'); $('#planningView').classList.remove('hidden'); render(); setStatus(''); });

localizeShell();
buildMap();
render();
