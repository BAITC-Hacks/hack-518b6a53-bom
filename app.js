import { INDICATORS, DISTRICTS, MEASURES, BUDGET, HORIZON, BASELINE, RULES, REQUIRED_DECISIONS, configureCatalog, fromServerSnapshot, toApiDistrictId, calculate, explainScenario as explainLocalScenario, getAdditionIssue, getScenarioIssue } from './model.js';
import { getCatalog, validateScenario, evaluateScenario, explainScenario } from './api.js';
import { MAP_DISTRICTS, MAP_RIVER, MAP_LAKES } from './map-geometry.js';
import { layoutMapObjects, mapLabelPosition, projectMapPoint } from './map-objects.js';
import { renderMapObject } from './map-object-art.js';
import { translate as t, formatNumber, groupName, measureName, districtName, indicatorName, indicatorDescription, setLanguage, getLanguage, loadLanguage, saveLanguage, SUPPORTED_LANGUAGES } from './i18n.js';

setLanguage(loadLanguage());

const $ = selector => document.querySelector(selector);
const state = { decisions: [], selectedMeasureId: null, focusedDistrictId: null, filter: 'Все', draggingId: null, hoverTarget: null, indicatorsOpen: false, reportTab: 'city', status: null, statusError: false, ready: false, validation: 'idle', canEvaluate: false, evaluating: false, evaluation: null, result: null, explanations: {}, aiErrors: {}, reportPresentation: 'default', narrativePage: 0, inspectedObject: null };
let measureById = {};
let districtById = {};
let validationRequest = 0, evaluationRequest = 0, explanationRequest = 0;
let validationController, evaluationController, explanationController;
let explanationFlight = null;
let explanationCache = { key: null, value: null };
let narrativeSections = [], narrativePages = [];
let paginationFrame;
let toastTimer;
let toastMessage = null;
let previewTarget = null;
const escapeHTML = value => String(value).replace(/\u00b7/g, '—').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
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
      element.setAttribute('role', 'button');
      element.setAttribute('tabindex', '0');
      element.setAttribute('aria-haspopup', 'dialog');
      element.setAttribute('aria-controls', 'objectDialog');
      element.innerHTML = `<title></title><rect class="map-object-hit" x="-23" y="-40" width="46" height="46" rx="5"/><g class="map-object-art">${renderMapObject(item.measureId)}</g>`;
    }
    const label = `${measureName(item.measureId)} — ${districtName(item.districtId)}`;
    element.setAttribute('aria-label', t('objects.open', { name: measureName(item.measureId), district: districtName(item.districtId) }));
    element.querySelector('title').textContent = `${label}. ${t('objects.hint')}`;
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
function apiIssue(error) {
  const code = error?.code || error?.errors?.[0]?.code;
  const keys = {
    UNKNOWN_MEASURE: 'errors.unknown', UNKNOWN_DISTRICT: 'errors.districtRequired',
    DISTRICT_REQUIRED: 'errors.districtRequired', DISTRICT_FORBIDDEN: 'errors.cityOnly',
    DECISION_COUNT: 'errors.count', DUPLICATE_MEASURE: 'errors.duplicate',
    BUDGET_EXCEEDED: 'errors.budget', DIRECTION_LIMIT: 'errors.groupLimit',
    INCOMPATIBLE_MEASURES: 'network.conflict', DISTRICT_CONFLICT: 'network.conflict',
    MODEL_VERSION_MISMATCH: 'network.versionChanged', MODEL_VERSION_CONFLICT: 'network.versionChanged',
    DATASET_UNAVAILABLE: 'network.unavailable', DATASET_NOT_READY: 'network.unavailable', API_UNAVAILABLE: 'network.unavailable', NETWORK_ERROR: 'network.unavailable',
    TIMEOUT: 'network.timeout', API_TIMEOUT: 'network.timeout', REQUEST_TIMEOUT: 'network.timeout'
  };
  return { key: keys[code] || (error?.status === 409 ? 'network.versionChanged' : 'network.requestFailed'), params: { count: code === 'DIRECTION_LIMIT' ? RULES?.max_per_direction : REQUIRED_DECISIONS, budget: BUDGET } };
}
function invalidateResult() {
  evaluationRequest++;
  explanationRequest++;
  evaluationController?.abort();
  explanationController?.abort();
  explanationFlight = null;
  state.evaluating = false;
  state.evaluation = null;
  state.result = null;
  state.explanations = {};
  state.aiErrors = {};
  state.reportPresentation = 'default';
  state.narrativePage = 0;
}
async function validateDraft() {
  validationController?.abort();
  validationController = new AbortController();
  const request = ++validationRequest;
  state.validation = 'pending';
  state.canEvaluate = false;
  renderPlan();
  try {
    const result = await validateScenario(state.decisions, { signal: validationController.signal });
    if (request !== validationRequest) return;
    state.validation = result.valid_draft ? 'valid' : 'invalid';
    state.canEvaluate = result.can_evaluate;
    if (!result.valid_draft) setStatus(apiIssue({ errors: result.errors }), true);
  } catch (error) {
    if (request !== validationRequest || error.name === 'AbortError') return;
    state.validation = 'error';
    setStatus(apiIssue(error), true);
  }
  if (request === validationRequest) renderPlan();
}
function current() { return calculate(state.decisions); }
function districtResult(result, id) { return result.districts.find(district => district.id === id); }
function explanation() {
  const key = JSON.stringify(state.decisions);
  if (explanationCache.key !== key) explanationCache = { key, value: explainLocalScenario(state.decisions) };
  return explanationCache.value;
}

function synergyMarkup(synergies) {
  return synergies.map(item => `<div class="synergy-item"><strong>${text('insights.synergyPair', { first: measureName(item.first), second: measureName(item.second) })}</strong><p>${text('insights.synergyDetail', { district: districtName(item.districtId), indicator: indicatorName(item.code), value: signed(item.bonus, 1) })}</p></div>`).join('');
}

function renderObjectDetails() {
  const item = state.inspectedObject;
  if (!item) return;
  const measure = measureById[item.measureId];
  const analysis = explanation();
  const contribution = analysis.contributions.find(entry => entry.id === item.measureId)?.districts.find(entry => entry.id === item.districtId);
  if (!contribution) return;
  const synergies = analysis.synergies.filter(entry => entry.districtId === item.districtId && [entry.first, entry.second].includes(item.measureId));
  $('#objectDetails').innerHTML = `<div class="object-detail-hero"><svg viewBox="-28 -44 56 54" class="object-illustration" aria-hidden="true">${renderMapObject(item.measureId)}</svg><div><span class="object-kicker">${measure.id} — ${escapeHTML(groupName(measure.group))}</span><h2 id="objectTitle">${escapeHTML(measureName(measure.id))}</h2><p>${text('objects.location', { district: districtName(item.districtId) })}</p><span class="measure-scope measure-scope--${measure.scope}">${text(measure.scope === 'city' ? 'ui.wholeCity' : 'ui.oneDistrict')}</span></div></div>
    <div class="object-facts"><div><span>${text('objects.cost')}</span><strong>${text('ui.units', { value: format(measure.cost, 0) })}</strong></div><div><span>${text('objects.launch')}</span><strong>${text('objects.launchValue', { value: measure.lag })}</strong></div></div>
    ${measure.scope === 'city' ? `<p class="object-note">${text('objects.cityCostNote')}</p>` : ''}
    <section class="object-effects"><div class="object-section-heading"><h3>${text('objects.effectTitle')}</h3><span>${text('objects.effectPeriod', { value: HORIZON })}</span></div>
      ${INDICATORS.map((indicator, index) => Math.abs(contribution.values[index]) < 1e-9 ? '' : `<div class="object-effect"><span>${escapeHTML(indicatorName(indicator.code))}</span><strong class="${contribution.values[index] < 0 ? 'negative' : 'positive'}">${signed(contribution.values[index])}</strong></div>`).join('')}
      <div class="object-score"><span>${text('objects.score')}</span><strong>${signed(contribution.scoreDelta)}</strong></div><p class="object-note">${text('objects.effectNote')}</p>
    </section>${synergies.length ? `<section class="object-synergies"><h3>${text('objects.connections')}</h3>${synergyMarkup(synergies)}<p class="object-note">${text('insights.synergyIncluded')}</p></section>` : ''}<p class="object-note object-disclaimer">${text('objects.modelNote')}</p>`;
}

function openObjectDetails(key) {
  const item = mapObjects.find(object => object.key === key);
  if (!item) return;
  state.inspectedObject = item;
  state.indicatorsOpen = false;
  renderIndicators();
  clearPreview();
  renderObjectDetails();
  $('#objectDialog').showModal();
}

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
  $('#decisionCount').textContent = `${count} / ${REQUIRED_DECISIONS}`;
  $('#budgetLimit').textContent = ` / ${format(BUDGET, 0)}`;
  $('#spentValue').textContent = format(result.spent, 0);
  $('#remainingValue').textContent = t('ui.units', { value: format(BUDGET - result.spent, 0) });
  $('#budgetFill').style.width = `${result.spent / BUDGET * 100}%`;
  $('#budgetFill').classList.toggle('danger', result.spent > BUDGET * .85);
  $('#decisionList').innerHTML = state.decisions.map((decision, index) => {
    const measure = measureById[decision.id];
    return `<div class="decision-item"><span class="decision-number">0${index + 1}</span><div class="decision-copy" title="${escapeHTML(`${measureName(measure.id)} — ${getTargetName(decision)} / ${groupName(measure.group)}`)}"><strong>${escapeHTML(measureName(measure.id))}</strong><span>${measure.id} / ${escapeHTML(getTargetName(decision))} / ${escapeHTML(groupName(measure.group))}</span></div><span class="decision-cost">${format(measure.cost, 0)}</span><button class="remove-button" type="button" data-remove="${decision.id}" aria-label="${text('ui.removeMeasure', { name: measureName(measure.id) })}">×</button></div>`;
  }).join('') + Array.from({ length: Math.max(0, REQUIRED_DECISIONS - count) }, (_, index) => `<div class="empty-slot" aria-label="${text('ui.emptyDecision', { index: count + index + 1 })}"><span>0${count + index + 1}</span>＋</div>`).join('');
  $('#calculateButton').disabled = state.evaluating || !state.canEvaluate || Boolean(getScenarioIssue(state.decisions));
  $('#calculateButton span').textContent = t(state.evaluating ? 'network.calculating' : state.validation === 'pending' ? 'network.validating' : 'ui.calculate');
  $('#retryValidation').classList.toggle('hidden', state.validation !== 'error');
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
    return `${group}<div class="indicator-row ${values[index] < RULES.critical_threshold ? 'critical' : ''}" tabindex="0" data-description="${escapeHTML(`${indicatorName(indicator.code)}. ${indicatorDescription(indicator.code)}`)}" aria-label="${escapeHTML(`${indicator.code}, ${indicatorName(indicator.code)}: ${format(values[index], 1)}. ${indicatorDescription(indicator.code)}`)}"><code>${indicator.code}</code><span class="indicator-track"><i style="width:${values[index]}%"></i></span><b>${format(values[index], 0)}</b></div>`;
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
  $('#mapCamera').style.transform = center ? `translate(${430 - center.x * zoom}px, ${340 - center.y * zoom}px) scale(${zoom})` : 'translate(0px, 0px) scale(1)';
  renderScenarioObjects();
  renderIndicators(result);
}

function render() { if (!state.ready) return; renderCatalog(); renderPlan(); renderMap(); }
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
  invalidateResult();
  state.selectedMeasureId = null;
  state.hoverTarget = null;
  render();
  setStatus('');
  void validateDraft();
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

function reportMetricRows(result, districtId = null) {
  const after = districtId ? districtResult(result, districtId).values : INDICATORS.map((_, index) => result.districts.reduce((sum, district) => sum + district.population * district.values[index], 0));
  const before = districtId ? districtById[districtId].values : INDICATORS.map((_, index) => DISTRICTS.reduce((sum, district) => sum + district.population * district.values[index], 0));
  return INDICATORS.map((item, index) => `<div class="report-line"><span class="report-line-name">${item.code} / ${escapeHTML(indicatorName(item.code))}</span><span class="report-line-track"><i style="width:${after[index]}%"></i></span><b class="${after[index] - before[index] < 0 ? 'negative' : 'positive'}">${signed(after[index] - before[index], 1)}</b></div>`).join('');
}
function reportAnalysis(selected) {
  const analysis = explanation();
  const city = selected === 'city';
  const result = state.result;
  const best = [...analysis.districts].sort((a, b) => b.delta - a.delta)[0];
  const target = city ? best : analysis.districts.find(item => item.id === selected);
  const districtContribution = (entry, id) => entry.districts.find(item => item.id === id);
  const contributionValue = entry => city ? entry.cityScoreDelta : districtContribution(entry, selected).scoreDelta;
  const applied = analysis.contributions.filter(entry => city || !entry.districtId || entry.districtId === selected).sort((a, b) => contributionValue(b) - contributionValue(a));
  const drivers = analysis.contributions.filter(entry => districtContribution(entry, target.id).scoreDelta > 1e-9)
    .sort((a, b) => districtContribution(b, target.id).scoreDelta - districtContribution(a, target.id).scoreDelta).slice(0, 2).map(entry => measureName(entry.id));
  const equalDistricts = city && analysis.districts.every(item => Math.abs(item.delta - best.delta) < 1e-9);
  const lead = equalDistricts ? t('insights.allEqual', { value: signed(best.delta) }) : t(city ? 'insights.cityLead' : 'insights.districtLead', { district: districtName(target.id), value: signed(target.delta) });
  const maxContribution = Math.max(...applied.map(entry => Math.abs(contributionValue(entry))), .01);
  const total = city ? result.score - BASELINE.score : target.delta;
  const synergies = analysis.synergies.filter(item => city || item.districtId === selected);
  const relevantDistricts = analysis.districts.filter(item => city || item.id === selected);
  const critical = relevantDistricts.flatMap(item => item.critical.map(risk => ({ ...risk, districtId: item.id }))).sort((a, b) => a.after - b.after);
  const risks = critical.length ? critical : relevantDistricts.map(item => ({ ...item.lowest, districtId: item.id })).sort((a, b) => a.after - b.after).slice(0, 1);
  return `<section class="report-card report-analysis" data-pane="analysis"><h2>${text('insights.title')}</h2>
    <div class="insight-summary"><p>${escapeHTML(lead)}</p><p>${escapeHTML(drivers.length ? t('insights.drivers', { measures: drivers.join(', ') }) : t('insights.noDrivers'))}</p></div>
    <section class="insight-section"><h3>${text('insights.contributions')}</h3><p class="insight-caption">${text(city ? 'insights.cityContribution' : 'insights.districtContribution')}</p>
      <div class="contribution-list">${applied.map(entry => {
        const value = contributionValue(entry);
        const changes = INDICATORS.map((indicator, index) => ({ code: indicator.code, value: city ? entry.districts.reduce((sum, item) => sum + item.values[index] * districtById[item.id].population, 0) : districtContribution(entry, selected).values[index] })).filter(item => Math.abs(item.value) > 1e-9).sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 2);
        return `<div class="contribution-item"><div><strong>${escapeHTML(measureName(entry.id))}</strong><small>${entry.id} — ${escapeHTML(getTargetName(entry))}</small><small>${text(city ? 'insights.cityIndicatorChanges' : 'insights.districtIndicatorChanges', { changes: changes.map(item => `${indicatorName(item.code)} ${signed(item.value)}`).join(' — ') })}</small></div><b class="${value < 0 ? 'negative' : 'positive'}">${signed(value)}</b><span class="contribution-track" aria-hidden="true"><i class="${value < 0 ? 'negative' : ''}" style="width:${Math.abs(value) / maxContribution * 100}%"></i></span></div>`;
      }).join('') || `<p class="insight-caption">${text('insights.noDrivers')}</p>`}</div>
      <div class="contribution-total"><span>${text('insights.total')}</span><strong>${signed(total)}</strong></div>
      <details class="insight-method"><summary>${text('insights.method')}</summary><p>${text('insights.methodText')}</p>${city ? `<p>${text('insights.scoreFormula')}</p>` : ''}</details>
    </section>
    <section class="insight-section"><h3>${text('insights.synergy')}</h3>${synergies.length ? `${synergyMarkup(synergies)}<p class="insight-caption">${text('insights.synergyIncluded')}</p>` : `<p class="insight-caption">${text('insights.noSynergy')}</p>`}</section>
    <section class="insight-section"><h3>${text('insights.remaining')}</h3>${!critical.length ? `<p class="insight-caption">${text('insights.noCritical')}</p>` : ''}${risks.map(risk => {
      const delta = risk.after - risk.before;
      return `<div class="insight-risk"><span class="risk-label ${risk.after < RULES.critical_threshold ? 'critical' : ''}">${text(risk.after < RULES.critical_threshold ? 'insights.critical' : 'insights.lowest')}</span><strong>${text('insights.riskItem', { district: districtName(risk.districtId), indicator: indicatorName(risk.code) })}</strong><div><b>${text('insights.beforeAfter', { before: format(risk.before, 1), after: format(risk.after, 1) })}</b><span>${Math.abs(delta) < 1e-9 ? text('insights.unchanged') : text(delta > 0 ? 'insights.improved' : 'insights.worsened', { value: signed(delta, 1) })}</span></div></div>`;
    }).join('')}</section>
    <p class="insight-footer">${text('insights.budget', { spent: format(result.spent, 0), budget: BUDGET })} ${text('insights.timing', { value: HORIZON })}</p>
  </section>`;
}
function reportScopeKey(language = getLanguage(), district = state.reportTab) {
  return language + ':' + district;
}
function defaultReportSections(selected) {
  const template = document.createElement('template');
  template.innerHTML = reportAnalysis(selected);
  const sections = [];
  let heading = '';
  const addBlock = element => {
    if (element.matches('h2')) return;
    if (element.matches('h3, .insight-section > .insight-caption')) {
      heading += element.outerHTML;
    } else if (element.matches('.insight-section, .contribution-list')) {
      [...element.children].forEach(addBlock);
    } else if (element.matches('details')) {
      const title = element.querySelector('summary').textContent;
      const paragraphs = [...element.querySelectorAll('p')].map(item => item.textContent).join(' ');
      sections.push({ title, body: paragraphs });
    } else {
      sections.push({ html: heading + element.outerHTML });
      heading = '';
    }
  };
  [...template.content.firstElementChild.children].forEach(addBlock);
  if (heading) sections.push({ html: heading });
  return sections;
}
function renderReportContent() {
  const result = state.result;
  if (!result) return;
  const selected = state.reportTab;
  const city = selected === 'city';
  const district = city ? null : districtResult(result, selected);
  const key = reportScopeKey();
  const cached = state.explanations[key];
  const showingAI = state.reportPresentation === 'ai' && Boolean(cached);
  const loading = explanationFlight?.key === key;
  const error = state.aiErrors[key];
  narrativeSections = showingAI
    ? [{ title: '', body: cached.explanation.summary }]
    : defaultReportSections(selected);
  const message = loading ? 'network.aiLoading' : explanationFlight && !cached ? 'network.aiBusy' : error?.key;
  const disabled = Boolean(explanationFlight && !cached);
  const stats = city ? [[t('report.average'), format(result.average)], [t('report.minimum'), format(result.weakest)], [t('report.critical'), format(result.critical, 0)]] : [[t('report.current'), format(district.baselineScore)], [t('report.forecast'), format(district.score)], [t('report.change'), signed(district.score - district.baselineScore)]];
  $('#reportContent').innerHTML = `<section class="report-card" data-pane="metrics"><h2>${escapeHTML(city ? t('ui.wholeCity') : districtName(district.id))}</h2><div class="report-stat-grid">${stats.map(([name, value]) => `<div class="report-stat"><span>${escapeHTML(name)}</span><strong>${value}</strong></div>`).join('')}</div><div class="report-metrics">${reportMetricRows(result, city ? null : selected)}</div></section>
    <section class="report-card report-analysis" data-pane="analysis" aria-busy="${loading}"><h2>${text(showingAI ? 'report.aiTitle' : 'insights.title')}</h2>
      <div class="analysis-status ${message ? '' : 'hidden'}" role="status">${message ? text(message) : ''}</div>
      <div class="narrative-page" id="narrativePage" aria-live="polite"></div>
      <nav class="report-pagination hidden" id="reportPagination" aria-label="${text('report.pages')}"><button type="button" data-page-step="-1" aria-label="${text('report.previous')}">←</button><span id="reportPageNumber"></span><button type="button" data-page-step="1" aria-label="${text('report.next')}">→</button></nav>
      <div class="report-ai-controls">${showingAI ? `<button type="button" class="report-default-button" data-default-report>${text('report.defaultReport')}</button>` : `<button type="button" class="report-ai-button" data-request-ai ${disabled ? 'disabled' : ''}>${disabled ? '<span class="ai-spinner" aria-hidden="true"></span>' : ''}${text(loading ? 'network.aiLoading' : disabled ? 'network.aiBusy' : cached ? 'report.showAI' : 'report.requestAI')}</button>`}</div>
    </section>`;
  narrativeObserver.disconnect();
  narrativeObserver.observe($('#narrativePage'));
  queuePagination();
}
function queuePagination() {
  cancelAnimationFrame(paginationFrame);
  paginationFrame = requestAnimationFrame(paginateNarrative);
}
function paginateNarrative() {
  const host = $('#narrativePage');
  if (!host || host.clientHeight < 30 || !host.clientWidth) return;
  const pages = [];
  let page = '';
  const fragment = (title, words) => `<div class="report-narrative">${title ? `<strong>${escapeHTML(title)}</strong>` : ''}<p>${escapeHTML(words.join(' '))}</p></div>`;
  for (const section of narrativeSections) {
    let body = section.body;
    if (section.html) {
      host.innerHTML = page + section.html;
      if (host.scrollHeight <= host.clientHeight) { page += section.html; continue; }
      if (page) { pages.push(page); page = ''; }
      host.innerHTML = section.html;
      if (host.scrollHeight <= host.clientHeight) { page = section.html; continue; }
      // Very short viewports still show every word of an oversized detail card.
      body = host.innerText;
    }
    const words = body.trim().split(/\s+/u).filter(Boolean);
    let offset = 0;
    while (offset < words.length) {
      let low = 0, high = words.length - offset;
      while (low < high) {
        const count = Math.ceil((low + high) / 2);
        host.innerHTML = page + fragment(section.title, words.slice(offset, offset + count));
        if (host.scrollHeight <= host.clientHeight) low = count;
        else high = count - 1;
      }
      if (!low && page) { pages.push(page); page = ''; continue; }
      if (low < words.length - offset && page) {
        host.innerHTML = fragment(section.title, words.slice(offset));
        if (host.scrollHeight <= host.clientHeight) { pages.push(page); page = ''; continue; }
      }
      let count = Math.max(1, low);
      // Prefer a sentence or list boundary over splitting a numeric comparison.
      if (offset + count < words.length) {
        for (let boundary = count; boundary > count * .55; boundary--) {
          if (/[,.;!?]$/u.test(words[offset + boundary - 1])) { count = boundary; break; }
        }
      }
      page += fragment(section.title, words.slice(offset, offset + count));
      offset += count;
      if (offset < words.length) { pages.push(page); page = ''; }
    }
  }
  if (page) pages.push(page);
  narrativePages = pages;
  state.narrativePage = Math.min(state.narrativePage, Math.max(0, pages.length - 1));
  renderNarrativePage();
}
function renderNarrativePage() {
  const host = $('#narrativePage');
  if (!host) return;
  host.innerHTML = narrativePages[state.narrativePage] || '';
  $('#reportPagination').classList.toggle('hidden', narrativePages.length < 2);
  $('#reportPageNumber').textContent = `${state.narrativePage + 1} / ${narrativePages.length}`;
  $('[data-page-step="-1"]').disabled = state.narrativePage === 0;
  $('[data-page-step="1"]').disabled = state.narrativePage >= narrativePages.length - 1;
}
const narrativeObserver = new ResizeObserver(queuePagination);
function renderReport() {
  const result = state.result;
  if (!result) return;
  $('#reportScore').textContent = format(result.score);
  $('#reportBaseline').textContent = format(BASELINE.score);
  $('#reportDelta').textContent = t('ui.baselineComparison', { value: signed(result.score - BASELINE.score) });
  $('#reportDelta').classList.toggle('negative', result.score < BASELINE.score);
  $('#reportTabs').innerHTML = [{ id: 'city', name: t('ui.wholeCity') }, ...DISTRICTS.map(d => ({ id: d.id, name: districtName(d.id) }))].map(tab => `<button class="report-tab ${state.reportTab === tab.id ? 'active' : ''}" type="button" data-report-tab="${tab.id}">${escapeHTML(tab.name)}</button>`).join('');
  renderReportContent();
}
async function openReport() {
  const error = getScenarioIssue(state.decisions);
  if (error) { setStatus(error, true); return; }
  if (state.evaluating || !state.canEvaluate) return;
  const request = ++evaluationRequest;
  evaluationController?.abort();
  evaluationController = new AbortController();
  state.evaluating = true;
  setStatus('');
  renderPlan();
  try {
    const result = state.evaluation || await evaluateScenario(state.decisions, { signal: evaluationController.signal });
    if (request !== evaluationRequest) return;
    state.evaluation = result;
    state.result = fromServerSnapshot(result.after, result.budget.spent);
  } catch (error) {
    if (request !== evaluationRequest || error.name === 'AbortError') return;
    setStatus(apiIssue(error), true);
    state.evaluating = false;
    renderPlan();
    return;
  }
  state.evaluating = false;
  renderPlan();
  state.reportTab = 'city';
  state.reportPresentation = 'default';
  state.narrativePage = 0;
  $('#planningView').classList.add('hidden');
  $('#reportView').classList.remove('hidden');
  renderReport();
}
async function requestExplanation() {
  if (!state.evaluation) return;
  const language = getLanguage();
  const districtId = state.reportTab === 'city' ? null : state.reportTab;
  const key = reportScopeKey();
  const scenarioKey = state.evaluation.scenario_key;
  if (state.explanations[key]) {
    state.reportPresentation = 'ai';
    state.narrativePage = 0;
    renderReportContent();
    return;
  }
  if (explanationFlight) return;
  const request = ++explanationRequest;
  explanationFlight = { scenarioKey, language, districtId, key, request };
  explanationController = new AbortController();
  state.reportPresentation = 'ai';
  state.narrativePage = 0;
  delete state.aiErrors[key];
  renderReportContent();
  try {
    const result = await explainScenario(state.decisions, language, { districtId, signal: explanationController.signal });
    if (request !== explanationRequest || scenarioKey !== state.evaluation?.scenario_key) return;
    if (result.scenario_key !== scenarioKey || result.language !== language || result.district_id !== (districtId ? toApiDistrictId(districtId) : null)) throw new Error('Mismatched explanation');
    if (result.mode === 'llm' && result.explanation?.summary?.trim()) state.explanations[key] = result;
    else state.aiErrors[key] = { key: 'network.fallback' };
  } catch (error) {
    if (request !== explanationRequest || error.name === 'AbortError') return;
    state.aiErrors[key] = apiIssue(error);
  } finally {
    if (explanationFlight?.request === request) explanationFlight = null;
  }
  // Results remain cached only for the requested language and territory.
  if (request === explanationRequest) renderReportContent();
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
  state.narrativePage = 0;
  state.reportPresentation = 'default';
  if ($('#objectDialog').open) renderObjectDetails();
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
$('#decisionList').addEventListener('click', event => { const button = event.target.closest('[data-remove]'); if (button) { state.decisions = state.decisions.filter(decision => decision.id !== button.dataset.remove); invalidateResult(); render(); setStatus(''); void validateDraft(); } });

$('#cityMap').addEventListener('click', event => {
  const object = event.target.closest('[data-object-key]');
  if (object && !state.selectedMeasureId) {
    event.stopPropagation();
    openObjectDetails(object.dataset.objectKey);
    return;
  }
  const district = event.target.closest('[data-district]');
  if (!district) return;
  event.stopPropagation();
  const id = district.dataset.district;
  if (state.selectedMeasureId) addMeasure(state.selectedMeasureId, id);
  else focusDistrict(id);
});
$('#cityMap').addEventListener('keydown', event => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const object = event.target.closest('[data-object-key]');
  if (object && !state.selectedMeasureId) {
    event.preventDefault();
    event.stopPropagation();
    openObjectDetails(object.dataset.objectKey);
    return;
  }
  const district = event.target.closest('[data-district]');
  if (!district) return;
  event.preventDefault();
  if (state.selectedMeasureId) addMeasure(state.selectedMeasureId, district.dataset.district);
  else focusDistrict(district.dataset.district);
});
$('#mapCard').addEventListener('click', event => {
  if (!state.ready) return;
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
$('#orbButton').addEventListener('click', () => { if (!state.ready) return; state.indicatorsOpen = !state.indicatorsOpen; renderIndicators(); });
document.addEventListener('click', event => {
  if (state.indicatorsOpen && !event.target.closest('#pulse, [data-district], .language-switcher')) { state.indicatorsOpen = false; renderIndicators(); }
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || !state.ready || $('#objectDialog').open) return;
  state.indicatorsOpen = false;
  state.focusedDistrictId = null;
  state.selectedMeasureId = null;
  if (document.activeElement?.matches('[data-district]')) document.activeElement.blur();
  clearPreview();
  render();
  setStatus('');
});
$('#closeObjectButton').addEventListener('click', () => $('#objectDialog').close());
$('#objectDialog').addEventListener('click', event => {
  if (event.target !== event.currentTarget) return;
  const rect = event.currentTarget.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.currentTarget.close();
});
$('#objectDialog').addEventListener('close', () => {
  const key = state.inspectedObject?.key;
  state.inspectedObject = null;
  $$('.map-object').find(element => element.dataset.objectKey === key)?.focus({ preventScroll: true });
});
$('#calculateButton').addEventListener('click', openReport);
$('#reportTabs').addEventListener('click', event => { const tab = event.target.closest('[data-report-tab]'); if (!tab) return; state.reportTab = tab.dataset.reportTab; state.reportPresentation = 'default'; state.narrativePage = 0; $$('.report-tab').forEach(item => item.classList.toggle('active', item === tab)); renderReportContent(); });
$('#reportMode').addEventListener('click', event => {
  const button = event.target.closest('[data-mode]');
  if (!button) return;
  $('#reportContent').dataset.mode = button.dataset.mode;
  $$('#reportMode button').forEach(item => item.classList.toggle('active', item === button));
  queuePagination();
});
$('#reportContent').addEventListener('click', event => {
  if (event.target.closest('[data-request-ai]')) { void requestExplanation(); return; }
  if (event.target.closest('[data-default-report]')) { state.reportPresentation = 'default'; state.narrativePage = 0; renderReportContent(); return; }
  const button = event.target.closest('[data-page-step]');
  if (!button) return;
  state.narrativePage = Math.max(0, Math.min(narrativePages.length - 1, state.narrativePage + Number(button.dataset.pageStep)));
  renderNarrativePage();
});
$('#backButton').addEventListener('click', () => { $('#reportView').classList.add('hidden'); $('#planningView').classList.remove('hidden'); });
$('#restartButton').addEventListener('click', () => { state.decisions = []; invalidateResult(); state.focusedDistrictId = null; state.selectedMeasureId = null; state.indicatorsOpen = false; $('#reportView').classList.add('hidden'); $('#planningView').classList.remove('hidden'); render(); setStatus(''); void validateDraft(); });
$('#retryValidation').addEventListener('click', () => { setStatus(''); void validateDraft(); });
$('#retryCatalog').addEventListener('click', () => void initialize());

async function initialize() {
  $('#startupMessage').textContent = t('network.loading');
  $('#retryCatalog').classList.add('hidden');
  $('#planningView').inert = true;
  try {
    const catalog = await getCatalog();
    configureCatalog(catalog);
    measureById = Object.fromEntries(MEASURES.map(measure => [measure.id, measure]));
    districtById = Object.fromEntries(DISTRICTS.map(district => [district.id, district]));
    $('.subtle-count').textContent = MEASURES.length;
    $('#decisionList').style.gridTemplateRows = `repeat(${REQUIRED_DECISIONS}, minmax(0, 1fr))`;
    state.ready = true;
    localizeShell();
    buildMap();
    render();
    $('#startupStatus').classList.add('hidden');
    $('#planningView').inert = false;
    void validateDraft();
  } catch (error) {
    $('#startupMessage').textContent = t(apiIssue(error).key);
    $('#retryCatalog').classList.remove('hidden');
  }
}

localizeShell();
void initialize();
