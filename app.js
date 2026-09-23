import { INDICATORS, DISTRICTS, MEASURES, BUDGET, BASELINE, calculate, validateAddition, validateScenario } from './model.js';

const $ = selector => document.querySelector(selector);
const state = { decisions: [], selectedMeasureId: null, focusedDistrictId: null, filter: 'Все', search: '', draggingId: null, hoverTarget: null, indicatorsOpen: false, reportTab: 'city' };
const measureById = Object.fromEntries(MEASURES.map(measure => [measure.id, measure]));
const districtById = Object.fromEntries(DISTRICTS.map(district => [district.id, district]));
let toastTimer;

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
  element.innerHTML = `<span>${error ? '!' : '✦'}</span> ${message}`;
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
  $('#slotHint').textContent = count === 5 ? 'ПЛАН ГОТОВ' : `${5 - count} СВОБОДНЫХ МЕСТ`;
  $('#decisionList').innerHTML = state.decisions.map((decision, index) => {
    const measure = measureById[decision.id];
    return `<div class="decision-item"><span class="decision-number">0${index + 1}</span><div class="decision-copy"><strong>${measure.name}</strong><span>${measure.id} · ${getTargetName(decision)} · ${measure.group}</span></div><span class="decision-cost">${measure.cost}</span><button class="remove-button" type="button" data-remove="${decision.id}" aria-label="Удалить ${measure.name}">×</button></div>`;
  }).join('') + Array.from({ length: 5 - count }, (_, index) => `<div class="empty-slot"><span>0${count + index + 1}</span> Перетащите мероприятие</div>`).join('');
  $('#calculateButton').disabled = Boolean(validateScenario(state.decisions));
}

function indicatorValues(result) {
  const district = state.focusedDistrictId && districtResult(result, state.focusedDistrictId);
  if (district) return district.values;
  return INDICATORS.map((_, index) => result.districts.reduce((sum, item) => sum + item.population * item.values[index], 0));
}
function renderIndicators(result = current()) {
  const panel = $('#indicatorPanel');
  panel.classList.toggle('hidden', !state.indicatorsOpen);
  $('#orbButton').setAttribute('aria-expanded', String(state.indicatorsOpen));
  if (!state.indicatorsOpen) return;
  const values = indicatorValues(result);
  let previousGroup = '';
  panel.innerHTML = `<div class="indicator-title"><strong>${state.focusedDistrictId ? districtById[state.focusedDistrictId].name : 'Показатели города'}</strong><span>0–100 · БОЛЬШЕ = ЛУЧШЕ</span></div>` + INDICATORS.map((indicator, index) => {
    const group = indicator.group !== previousGroup ? `<div class="indicator-group">${indicator.group.toUpperCase()}</div>` : '';
    previousGroup = indicator.group;
    return `${group}<div class="indicator-row ${values[index] < 40 ? 'critical' : ''}" tabindex="0" data-description="${indicator.description}" aria-label="${indicator.code}, ${indicator.name}: ${format(values[index], 1)}. ${indicator.description}"><code>${indicator.code}</code><span class="indicator-track"><i style="width:${values[index]}%"></i></span><b>${format(values[index], 0)}</b></div>`;
  }).join('');
}

function renderMap() {
  const result = current();
  const district = state.focusedDistrictId && districtResult(result, state.focusedDistrictId);
  const score = district ? district.score : result.score;
  const baseline = district ? district.baselineScore : BASELINE.score;
  const delta = score - baseline;
  const orb = $('#orbButton');
  orb.classList.toggle('alert', score < 55);
  orb.style.setProperty('--orb-a', score < 55 ? '#e77362' : score < 60 ? '#f5a477' : '#78b993');
  orb.style.setProperty('--orb-b', score < 55 ? '#f5bea0' : '#e9dfac');
  orb.style.setProperty('--orb-c', score < 55 ? '#d5a9a0' : '#9bcead');
  $('#orbScope').textContent = district ? `${district.name.toUpperCase()} SCORE` : 'ASTANA SCORE';
  $('#orbScore').textContent = format(score);
  $('#orbChange').textContent = state.decisions.length ? `${signed(delta)} К БАЗЕ` : 'БАЗОВЫЙ УРОВЕНЬ';
  $('#orbTitle').textContent = district ? `Район ${district.name}` : 'Пульс города';
  $('#scoreNote span:last-child').textContent = district ? district.profile : result.critical ? `${result.critical} критических показателя влияют на итоговый балл.` : 'Критических показателей нет.';
  $('#cityMap').classList.toggle('has-focus', Boolean(district));
  $$('.district').forEach(element => {
    element.classList.toggle('focused', element.dataset.district === state.focusedDistrictId);
    element.classList.toggle('drop-target', element.dataset.district === state.hoverTarget);
  });
  $$('.district-score').forEach(element => { element.textContent = format(districtResult(result, element.dataset.scoreFor).score); });
  $('#cityDrop').classList.toggle('active', state.hoverTarget === 'city');
  renderIndicators(result);
}

function render() { renderCatalog(); renderPlan(); renderMap(); }
function selectMeasure(id) {
  if (state.decisions.some(decision => decision.id === id)) return;
  state.selectedMeasureId = state.selectedMeasureId === id ? null : id;
  renderCatalog();
  if (state.selectedMeasureId) setStatus(measureById[id].scope === 'city' ? 'Нажмите «Весь город» на карте.' : 'Нажмите на нужный район на карте.');
  else setStatus('Выберите карточку и укажите район на карте.');
}
function addMeasure(id, districtId = null) {
  const error = validateAddition(state.decisions, id, districtId);
  if (error) { setStatus(error, true); return false; }
  state.decisions.push({ id, ...(districtId ? { districtId } : {}) });
  state.selectedMeasureId = null;
  state.hoverTarget = null;
  render();
  setStatus(state.decisions.length === 5 ? 'План готов. Рассчитайте итоговый сценарий.' : `Добавлено: ${measureById[id].name}. Осталось ${5 - state.decisions.length} решения.`);
  return true;
}
function focusDistrict(id) {
  state.focusedDistrictId = state.focusedDistrictId === id ? null : id;
  renderMap();
}

function renderPreview(id, districtId) {
  const measure = measureById[id];
  const preview = $('#dropPreview');
  if (!measure) { preview.classList.add('hidden'); return; }
  const error = validateAddition(state.decisions, id, districtId);
  const target = districtId ? districtById[districtId]?.name : 'весь город';
  const realized = (8 - measure.lag) / 8;
  if (error) {
    preview.innerHTML = `<span class="preview-kicker">НЕЛЬЗЯ ПРИМЕНИТЬ</span><h3>${target || 'Район'}</h3><p>${error}</p>`;
  } else {
    const before = current();
    const after = calculate([...state.decisions, { id, ...(districtId ? { districtId } : {}) }]);
    const beforeScore = districtId ? districtResult(before, districtId).score : before.score;
    const afterScore = districtId ? districtResult(after, districtId).score : after.score;
    preview.innerHTML = `<span class="preview-kicker">ПРОГНОЗ · ${target.toUpperCase()}</span><h3>${measure.name}</h3><p>Эффект через ${measure.lag} кв. · учитывается ${format(realized * 100, 1)}% за 8 кварталов</p>${Object.entries(measure.effects).map(([code, value]) => {
      const adjusted = value * realized;
      return `<div class="preview-metric"><span>${code} · ${INDICATORS.find(item => item.code === code).name}</span><b class="${adjusted < 0 ? 'negative' : ''}">${signed(adjusted, 1)}</b></div>`;
    }).join('')}<div class="preview-score"><span>${districtId ? 'Балл района' : 'Балл города'}</span><strong>${format(afterScore)} <small>${signed(afterScore - beforeScore)}</small></strong></div>`;
  }
  preview.classList.remove('hidden');
}
function clearPreview() {
  state.hoverTarget = null;
  $('#dropPreview').classList.add('hidden');
  $$('.district').forEach(element => element.classList.remove('drop-target'));
  $('#cityDrop').classList.remove('active');
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
  return INDICATORS.map((item, index) => `<div class="report-line"><span class="report-line-name">${item.code} · ${item.name}</span><span class="report-line-track"><i style="width:${after[index]}%"></i></span><b class="${after[index] - before[index] < 0 ? 'negative' : 'positive'}">${signed(after[index] - before[index], 1)}</b></div>`).join('');
}
function renderReportContent() {
  const result = current();
  const selected = state.reportTab;
  if (selected === 'city') {
    const { weakest, best, mostImproved } = reportInsight(result);
    $('#reportContent').innerHTML = `<section class="report-card"><span class="eyebrow">ОБЩИЙ РЕЗУЛЬТАТ</span><h2>Городской эффект решений</h2><p>Расчёт по синтетическому датасету и заданной формуле, с лагами и синергиями.</p><div class="report-stat-grid"><div class="report-stat"><span>Среднее по населению</span><strong>${format(result.average)}</strong></div><div class="report-stat"><span>Слабейший район</span><strong>${format(result.weakest)}</strong></div><div class="report-stat"><span>Критических значений</span><strong>${result.critical}</strong></div></div><div class="report-section-title">ИЗМЕНЕНИЕ ПОКАЗАТЕЛЕЙ</div>${reportMetricRows(result)}</section><section class="report-card"><span class="eyebrow">ДЕМО-АНАЛИТИКА</span><h2>Объяснение сценария</h2><div class="report-narrative"><strong>✦ Сильная сторона</strong><p>Наибольший прирост получает район ${best.name}: ${signed(mostImproved)} балла. Меры начинают действовать с учётом своего лага.</p></div><div class="report-narrative"><strong>◇ Зона внимания</strong><p>${weakest.name} остаётся самым слабым районом с оценкой ${format(weakest.score)}. ${result.critical ? `В городе остаётся ${result.critical} критических значения ниже 40.` : 'Критических показателей ниже 40 больше нет.'}</p></div><div class="report-narrative"><strong>↗ Последствие выбора</strong><p>Из бюджета использовано ${result.spent} из 100 ед. Неиспользованный остаток не добавляет баллы; итог зависит от распределения эффектов между районами.</p></div><div class="report-section-title">ПРИНЯТЫЕ РЕШЕНИЯ</div><ul class="report-list">${state.decisions.map(decision => `<li>${measureById[decision.id].id} · ${measureById[decision.id].name} — ${getTargetName(decision)}</li>`).join('')}</ul></section>`;
  } else {
    const district = districtResult(result, selected);
    const delta = district.score - district.baselineScore;
    const changed = INDICATORS.map((indicator, index) => ({ ...indicator, delta: district.values[index] - districtById[selected].values[index], value: district.values[index] }));
    const strongest = [...changed].sort((a, b) => b.delta - a.delta)[0];
    const weakest = [...changed].sort((a, b) => a.value - b.value)[0];
    const applied = state.decisions.filter(decision => !decision.districtId || decision.districtId === selected);
    $('#reportContent').innerHTML = `<section class="report-card"><span class="eyebrow">РАЙОН / ${district.name.toUpperCase()}</span><h2>${format(district.score)} <span style="font-size:12px;color:#67a178">${signed(delta)} к базе</span></h2><p>${district.profile}</p><div class="report-stat-grid"><div class="report-stat"><span>До решений</span><strong>${format(district.baselineScore)}</strong></div><div class="report-stat"><span>После решений</span><strong>${format(district.score)}</strong></div><div class="report-stat"><span>Доля населения</span><strong>${format(district.population * 100, 0)}%</strong></div></div><div class="report-section-title">ИЗМЕНЕНИЕ ПОКАЗАТЕЛЕЙ</div>${reportMetricRows(result, selected)}</section><section class="report-card"><span class="eyebrow">ЛОКАЛЬНЫЙ ОТЧЁТ</span><h2>Что произошло в районе</h2><div class="report-narrative"><strong>✦ Наибольший эффект</strong><p>${strongest.delta > 0 ? `${strongest.name} вырос на ${format(strongest.delta, 1)} пункта.` : 'Прямого улучшения показателей в районе нет.'}</p></div><div class="report-narrative"><strong>◇ Зона внимания</strong><p>Самый низкий показатель — ${weakest.name}: ${format(weakest.value, 1)} из 100.${weakest.value < 40 ? ' Он остаётся критическим.' : ''}</p></div><div class="report-narrative"><strong>↗ Возможное последствие</strong><p>Прогноз учитывает неполный эффект мер из-за временного лага. Реальный городской результат может отличаться от условной модели.</p></div><div class="report-section-title">МЕРЫ, КОТОРЫЕ ВЛИЯЮТ НА РАЙОН</div><ul class="report-list">${applied.length ? applied.map(decision => `<li>${decision.id} · ${measureById[decision.id].name}${decision.districtId ? '' : ' · весь город'}</li>`).join('') : '<li>Для района не выбраны прямые или городские меры.</li>'}</ul></section>`;
  }
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
  card.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'copy';
  event.dataTransfer.setData('text/plain', state.draggingId);
});
$('#catalogList').addEventListener('dragend', () => { state.draggingId = null; clearPreview(); $$('.measure-card').forEach(card => card.classList.remove('dragging')); });
$('#filterRow').addEventListener('click', event => { const chip = event.target.closest('[data-filter]'); if (chip) { state.filter = chip.dataset.filter; renderCatalog(); } });
$('#searchInput').addEventListener('input', event => { state.search = event.target.value.trim(); renderCatalog(); });
$('#decisionList').addEventListener('click', event => { const button = event.target.closest('[data-remove]'); if (button) { state.decisions = state.decisions.filter(decision => decision.id !== button.dataset.remove); render(); setStatus('Мера удалена. Выберите другое решение.'); } });

$('#cityMap').addEventListener('click', event => {
  const district = event.target.closest('[data-district]');
  if (!district) return;
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
$('#cityDrop').addEventListener('click', () => { if (state.selectedMeasureId) addMeasure(state.selectedMeasureId); else { state.focusedDistrictId = null; renderMap(); } });
$('#mapCard').addEventListener('dragover', event => {
  const id = state.draggingId || event.dataTransfer.getData('text/plain');
  if (!id) return;
  const district = event.target.closest('[data-district]');
  const districtId = district?.dataset.district || null;
  const overCity = Boolean(event.target.closest('[data-city-drop]')) || (!district && measureById[id]?.scope === 'city');
  if (!district && !overCity) { clearPreview(); return; }
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
  const target = districtId || 'city';
  if (state.hoverTarget !== target) {
    state.hoverTarget = target;
    $$('.district').forEach(element => element.classList.toggle('drop-target', element.dataset.district === districtId));
    $('#cityDrop').classList.toggle('active', target === 'city');
    renderPreview(id, districtId);
  }
});
$('#mapCard').addEventListener('drop', event => {
  const id = state.draggingId || event.dataTransfer.getData('text/plain');
  if (!id) return;
  event.preventDefault();
  const districtId = event.target.closest('[data-district]')?.dataset.district || null;
  addMeasure(id, districtId);
  state.draggingId = null;
  clearPreview();
});
$('#mapCard').addEventListener('dragleave', event => { if (!$('#mapCard').contains(event.relatedTarget)) clearPreview(); });
$('#orbButton').addEventListener('click', () => { state.indicatorsOpen = !state.indicatorsOpen; renderIndicators(); });
$('#resetMapButton').addEventListener('click', () => { state.focusedDistrictId = null; renderMap(); });
$('#calculateButton').addEventListener('click', openReport);
$('#reportTabs').addEventListener('click', event => { const tab = event.target.closest('[data-report-tab]'); if (!tab) return; state.reportTab = tab.dataset.reportTab; $$('.report-tab').forEach(item => item.classList.toggle('active', item === tab)); renderReportContent(); });
$('#backButton').addEventListener('click', () => { $('#reportView').classList.add('hidden'); $('#planningView').classList.remove('hidden'); window.scrollTo({ top: 0, behavior: 'smooth' }); });
$('#restartButton').addEventListener('click', () => { state.decisions = []; state.focusedDistrictId = null; state.selectedMeasureId = null; state.indicatorsOpen = false; $('#reportView').classList.add('hidden'); $('#planningView').classList.remove('hidden'); render(); setStatus('Новый сценарий. Выберите первое мероприятие.'); window.scrollTo({ top: 0, behavior: 'smooth' }); });
$('#helpButton').addEventListener('click', () => $('#helpDialog').showModal());
$('#closeHelpButton').addEventListener('click', () => $('#helpDialog').close());
$('#helpDialog').addEventListener('click', event => { if (event.target === $('#helpDialog')) $('#helpDialog').close(); });

render();
