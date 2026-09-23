import { INDICATORS, DISTRICTS, MEASURES, BUDGET, BASELINE, calculate, validateAddition, validateScenario } from './model.js';
import { MAP_DISTRICTS, MAP_RIVER, MAP_LAKES } from './map-geometry.js';

const $ = selector => document.querySelector(selector);
const state = { decisions: [], selectedMeasureId: null, focusedDistrictId: null, filter: 'Все', search: '', draggingId: null, hoverTarget: null, indicatorsOpen: false, reportTab: 'city' };
const measureById = Object.fromEntries(MEASURES.map(measure => [measure.id, measure]));
const districtById = Object.fromEntries(DISTRICTS.map(district => [district.id, district]));
let toastTimer;
const project = ({ x, y }) => ({ x: .9 * x + .38 * y - 88, y: -.28 * x + .64 * y + 242 });
const projection = 'matrix(.9 -.28 .38 .64 -88 242)';
const districtColors = { nura: ['#e7bba4', '#c59d83'], esil: ['#bdd5ae', '#91af81'], saryarka: ['#e4d2a1', '#bbaa80'], baikonur: ['#b7cdc7', '#8ba9a0'], almaty: ['#c7cbdc', '#9ba5bd'] };

function buildMap() {
  $('#mapCamera').classList.add('map-camera');
  $('#mapCamera').innerHTML = MAP_DISTRICTS.map(district => {
    const point = project(district.centroid);
    const [color, side] = districtColors[district.id];
    return `<g class="district" data-district="${district.id}" tabindex="0" role="button" aria-label="Район ${districtById[district.id].name}" style="--district-color:${color};--district-side:${side}">
      <g transform="translate(0 23)"><path class="district-ground-shadow" transform="${projection}" d="${district.path}"/></g>
      <g transform="translate(0 13)"><path class="district-depth" transform="${projection}" d="${district.path}"/></g>
      <g transform="${projection}"><path class="district-shape" d="${district.path}"/><path class="district-road" d="${district.roads}"/>${district.id === 'nura' || district.id === 'esil' ? `<path d="${MAP_LAKES[district.id === 'nura' ? 0 : 1]}" fill="#a9c9ba" opacity=".65" pointer-events="none"/>` : ''}</g>
      <text class="district-label" x="${point.x}" y="${point.y - 5}">${districtById[district.id].name}</text><text class="district-score" x="${point.x}" y="${point.y + 14}" data-score-for="${district.id}"></text>
    </g>`;
  }).join('') + `<g transform="${projection}" pointer-events="none"><path class="river" d="${MAP_RIVER}"/><path class="river-highlight" d="${MAP_RIVER}"/></g>`;
}

function format(value, digits = 2) { return Number(value).toFixed(digits); }
function signed(value, digits = 2) { return `${value >= 0 ? '+' : '−'}${format(Math.abs(value), digits)}`; }
function getTargetName(decision) { return decision.districtId ? districtById[decision.districtId].name : 'Весь город'; }
function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}
function setStatus(message, error = false) {
  const element = $('#statusMessage');
  element.textContent = message;
  element.classList.toggle('error', error);
  if (error) showToast(message);
}
function current() { return calculate(state.decisions); }
function districtResult(result, id) { return result.districts.find(district => district.id === id); }

function renderCatalog() {
  const search = state.search.toLocaleLowerCase('ru');
  const visible = MEASURES.filter(measure => (state.filter === 'Все' || measure.group === state.filter) && (`${measure.id} ${measure.name} ${measure.group}`).toLocaleLowerCase('ru').includes(search));
  $('#catalogList').innerHTML = visible.length ? visible.map(measure => {
    const used = state.decisions.some(decision => decision.id === measure.id);
    return `<div class="measure-card ${used ? 'used' : ''} ${state.selectedMeasureId === measure.id ? 'selected' : ''}" data-measure="${measure.id}" draggable="${!used}" role="button" tabindex="${used ? -1 : 0}" aria-label="${measure.id}: ${measure.name}, ${measure.cost} единиц, ${measure.scope === 'city' ? 'весь город' : 'один район'}">
      <div class="measure-head"><span class="measure-id">${measure.id}</span><span class="measure-scope">${measure.scope === 'city' ? 'ГОРОД' : 'РАЙОН'}</span></div>
      <div class="measure-name">${measure.name}</div>
      <div class="measure-meta"><span class="measure-group">${measure.group}</span><span class="measure-lag">лаг ${measure.lag} кв.</span><span class="measure-cost">${measure.cost} ед. ↗</span></div>
    </div>`;
  }).join('') : '<div class="empty-slot">Ничего не найдено</div>';
  $$('#filterRow .filter-chip').forEach(button => button.classList.toggle('active', button.dataset.filter === state.filter));
}
function $$(selector) { return [...document.querySelectorAll(selector)]; }

function renderPlan() {
  const result = current();
  const count = state.decisions.length;
  $('#decisionCount').textContent = `${count} / 5`;
  $('#spentValue').textContent = result.spent;
  $('#remainingValue').textContent = `${BUDGET - result.spent} ед.`;
  $('#budgetFill').style.width = `${result.spent}%`;
  $('#budgetFill').classList.toggle('danger', result.spent > 85);
  $('#decisionList').innerHTML = state.decisions.map((decision, index) => {
    const measure = measureById[decision.id];
    return `<div class="decision-item"><span class="decision-number">0${index + 1}</span><div class="decision-copy"><strong>${measure.name}</strong><span>${measure.id} / ${getTargetName(decision)} / ${measure.group}</span></div><span class="decision-cost">${measure.cost}</span><button class="remove-button" type="button" data-remove="${decision.id}" aria-label="Удалить ${measure.name}">×</button></div>`;
  }).join('') + Array.from({ length: 5 - count }, (_, index) => `<div class="empty-slot" aria-label="Решение ${count + index + 1} не выбрано"><span>0${count + index + 1}</span>＋</div>`).join('');
  $('#calculateButton').disabled = Boolean(validateScenario(state.decisions));
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
  $('#orbButton').setAttribute('aria-label', state.indicatorsOpen ? 'Закрыть показатели' : 'Открыть показатели');
  if (!state.indicatorsOpen) return;
  const values = indicatorValues(result);
  let previousGroup = '';
  panel.innerHTML = INDICATORS.map((indicator, index) => {
    const group = indicator.group !== previousGroup ? `<div class="indicator-group">${indicator.group.toUpperCase()}</div>` : '';
    previousGroup = indicator.group;
    return `${group}<div class="indicator-row ${values[index] < 40 ? 'critical' : ''}" tabindex="0" data-description="${indicator.name}. ${indicator.description}" aria-label="${indicator.code}, ${indicator.name}: ${format(values[index], 1)}. ${indicator.description}"><code>${indicator.code}</code><span class="indicator-track"><i style="width:${values[index]}%"></i></span><b>${format(values[index], 0)}</b></div>`;
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
  orb.style.setProperty('--orb-a', score < 55 ? '#e77362' : score < 60 ? '#f5a477' : '#78b993');
  orb.style.setProperty('--orb-b', score < 55 ? '#f5bea0' : '#e9dfac');
  orb.style.setProperty('--orb-c', score < 55 ? '#d5a9a0' : '#9bcead');
  $('#orbScope').textContent = district ? district.name : 'Астана';
  $('#orbScore').textContent = format(score);
  $('#orbChange').textContent = state.decisions.length ? `${signed(delta)} к исходному` : 'из 100';
  $('#mapScope').textContent = district ? district.name : '5 районов';
  $('#cityMap').classList.toggle('has-focus', Boolean(district));
  $$('.district').forEach(element => {
    element.classList.toggle('focused', element.dataset.district === state.focusedDistrictId);
    element.classList.toggle('drop-target', element.dataset.district === state.hoverTarget);
  });
  $$('.district-score').forEach(element => { element.textContent = format(districtResult(result, element.dataset.scoreFor).score); });
  $('#cityDrop').classList.toggle('active', state.hoverTarget === 'city');
  const center = district ? project(MAP_DISTRICTS.find(item => item.id === district.id).centroid) : null;
  const zoom = district ? 1.85 : 1;
  $('#mapCamera').style.transform = center ? `translate(${450 - center.x * zoom}px, ${350 - center.y * zoom}px) scale(${zoom})` : 'translate(0px, 0px) scale(1)';
  renderIndicators(result);
}

function render() { renderCatalog(); renderPlan(); renderMap(); }
function selectMeasure(id) {
  if (state.decisions.some(decision => decision.id === id)) return;
  state.selectedMeasureId = state.selectedMeasureId === id ? null : id;
  renderCatalog();
  if (state.selectedMeasureId) setStatus(measureById[id].scope === 'city' ? 'Нажмите «Весь город» на карте.' : 'Нажмите на нужный район на карте.');
  else setStatus('');
}
function addMeasure(id, districtId = null) {
  const error = validateAddition(state.decisions, id, districtId);
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
  if (!measure) { preview.classList.add('hidden'); return; }
  const error = validateAddition(state.decisions, id, districtId);
  const target = districtId ? districtById[districtId]?.name : 'весь город';
  if (error) {
    preview.innerHTML = `<span class="preview-kicker">${target || 'Район'}</span><p>${error}</p>`;
  } else {
    const before = current();
    const after = calculate([...state.decisions, { id, ...(districtId ? { districtId } : {}) }]);
    const beforeScore = districtId ? districtResult(before, districtId).score : before.score;
    const afterScore = districtId ? districtResult(after, districtId).score : after.score;
    const getValues = result => districtId ? districtResult(result, districtId).values : INDICATORS.map((_, index) => result.districts.reduce((sum, item) => sum + item.population * item.values[index], 0));
    const beforeValues = getValues(before);
    const afterValues = getValues(after);
    preview.innerHTML = `<span class="preview-kicker">${target}</span><h3>${measure.name}</h3>${INDICATORS.map((indicator, index) => {
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
  state.hoverTarget = null;
  $('#dropPreview').classList.add('hidden');
  $$('.district').forEach(element => element.classList.remove('drop-target'));
  $('#cityDrop').classList.remove('active');
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
  return INDICATORS.map((item, index) => `<div class="report-line"><span class="report-line-name">${item.code} / ${item.name}</span><span class="report-line-track"><i style="width:${after[index]}%"></i></span><b class="${after[index] - before[index] < 0 ? 'negative' : 'positive'}">${signed(after[index] - before[index], 1)}</b></div>`).join('');
}
function reportActions(decisions) {
  return `<div class="report-actions">${decisions.map(decision => `<span title="${measureById[decision.id].name}">${decision.id}<small>${getTargetName(decision)}</small></span>`).join('') || '<span>Нет выбранных мер</span>'}</div>`;
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
    strengths = `Наибольший прирост — ${best.name}: ${signed(mostImproved)} балла.`;
    risks = `${weakest.name}: ${format(weakest.score)} — самый низкий балл.${result.critical ? ` Показателей ниже 40: ${result.critical}.` : ' Критических показателей нет.'}`;
    consequence = `Потрачено ${result.spent} из 100 ед. Эффекты учитывают лаги и синергии; остаток бюджета не добавляет баллы.`;
  } else {
    const changed = INDICATORS.map((indicator, index) => ({ ...indicator, delta: district.values[index] - districtById[selected].values[index], value: district.values[index] }));
    const strongest = [...changed].sort((a, b) => b.delta - a.delta)[0];
    const lowest = [...changed].sort((a, b) => a.value - b.value)[0];
    strengths = strongest.delta > 0 ? `${strongest.name}: ${signed(strongest.delta, 1)} пункта — наибольшее улучшение.` : 'Выбранные меры не изменили показатели района.';
    risks = `${lowest.name}: ${format(lowest.value, 1)} из 100 — самое низкое значение.${lowest.value < 40 ? ' Ниже критической границы 40.' : ''}`;
    consequence = `Балл района изменился на ${signed(district.score - district.baselineScore)}. Доля района в городском среднем — ${format(district.population * 100, 0)}%.`;
    applied = state.decisions.filter(decision => !decision.districtId || decision.districtId === selected);
  }
  const stats = city ? [['Среднее', format(result.average)], ['Минимум', format(result.weakest)], ['Критических', result.critical]] : [['Сейчас', format(district.baselineScore)], ['Прогноз', format(district.score)], ['Изменение', signed(district.score - district.baselineScore)]];
  $('#reportContent').innerHTML = `<section class="report-card" data-pane="metrics"><h2>${city ? 'Весь город' : district.name}</h2><div class="report-stat-grid">${stats.map(([name, value]) => `<div class="report-stat"><span>${name}</span><strong>${value}</strong></div>`).join('')}</div><div class="report-metrics">${reportMetricRows(result, city ? null : selected)}</div></section><section class="report-card" data-pane="analysis"><h2>Что меняется</h2><div class="report-narratives"><div class="report-narrative"><strong>Сильная сторона</strong><p>${strengths}</p></div><div class="report-narrative"><strong>Зона внимания</strong><p>${risks}</p></div><div class="report-narrative"><strong>Последствия</strong><p>${consequence}</p></div></div>${reportActions(applied)}</section>`;
}
function openReport() {
  const error = validateScenario(state.decisions);
  if (error) { setStatus(error, true); return; }
  const result = current();
  $('#reportScore').textContent = format(result.score);
  $('#reportDelta').textContent = `${signed(result.score - BASELINE.score)} к базовому уровню`;
  $('#reportDelta').classList.toggle('negative', result.score < BASELINE.score);
  state.reportTab = 'city';
  $('#reportTabs').innerHTML = `<button class="report-tab active" type="button" data-report-tab="city">Весь город</button>${DISTRICTS.map(district => `<button class="report-tab" type="button" data-report-tab="${district.id}">${district.name}</button>`).join('')}`;
  renderReportContent();
  $('#planningView').classList.add('hidden');
  $('#reportView').classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

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
$('#searchInput').addEventListener('input', event => { state.search = event.target.value.trim(); renderCatalog(); });
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
$('#cityDrop').addEventListener('click', () => { if (state.selectedMeasureId) addMeasure(state.selectedMeasureId); else { state.focusedDistrictId = null; state.indicatorsOpen = false; renderMap(); } });
$('#mapCard').addEventListener('click', event => {
  if (event.target.closest('button, [data-district]')) return;
  state.focusedDistrictId = null;
  state.indicatorsOpen = false;
  renderMap();
});
$('#mapCard').addEventListener('dragover', event => {
  const id = state.draggingId || event.dataTransfer.getData('text/plain');
  if (!measureById[id]) return;
  const district = event.target.closest('[data-district]');
  const districtId = district?.dataset.district || null;
  const overCity = Boolean(event.target.closest('[data-city-drop]')) || (!district && measureById[id]?.scope === 'city');
  if (!district && !overCity) { clearPreview(); return; }
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
  $('#cityMap').classList.add('dragging');
  const target = districtId || 'city';
  if (state.hoverTarget !== target) {
    state.hoverTarget = target;
    $$('.district').forEach(element => element.classList.toggle('drop-target', element.dataset.district === districtId));
    $('#cityDrop').classList.toggle('active', target === 'city');
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
$('#resetMapButton').addEventListener('click', () => { state.focusedDistrictId = null; state.indicatorsOpen = false; renderMap(); });
document.addEventListener('click', event => {
  if (state.indicatorsOpen && !event.target.closest('#pulse, [data-district]')) { state.indicatorsOpen = false; renderIndicators(); }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { state.indicatorsOpen = false; state.focusedDistrictId = null; state.selectedMeasureId = null; render(); setStatus(''); }
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

buildMap();
render();



