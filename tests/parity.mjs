// Integration check against the running API. Run explicitly with:
// node tests/parity.mjs [http://localhost:4173]
import assert from 'node:assert/strict';
import {
  configureCatalog, calculate, fromServerSnapshot, toSelections, toUiDistrictId,
  INDICATORS, DISTRICTS, MEASURES, RULES, PRESETS, BASELINE, MODEL_VERSION,
  getAdditionIssue, getScenarioIssue
} from '../model.js';

const origin = process.argv[2] || process.env.API_BASE_URL || 'http://localhost:4173';
const request = async (path, body) => {
  const response = await fetch(new URL(`/api/v1/${path}`, origin), {
    method: body ? 'POST' : 'GET',
    headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(12000)
  });
  const result = await response.json();
  assert.equal(response.status, 200, `${path}: ${JSON.stringify(result)}`);
  return result;
};
const post = (path, decisions) => request(path, { model_version: MODEL_VERSION, selections: toSelections(decisions) });
const close = (actual, expected, label) => assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= 1e-8, `${label}: ${actual} != ${expected}`);
const catalog = await request('catalog');
configureCatalog(catalog);

let indicatorComparisons = 0;
function compareSnapshot(local, server, label) {
  for (const key of ['score', 'average', 'weakest', 'critical', 'spent']) close(local[key], server[key], `${label}.${key}`);
  assert.deepEqual(local.districts.map(d => d.id).sort(), server.districts.map(d => d.id).sort(), `${label}.districts`);
  for (const district of local.districts) {
    const other = server.districts.find(item => item.id === district.id);
    close(district.score, other.score, `${label}.${district.id}.score`);
    close(district.baselineScore, other.baselineScore, `${label}.${district.id}.baselineScore`);
    INDICATORS.forEach((indicator, index) => {
      close(district.values[index], other.values[index], `${label}.${district.id}.${indicator.code}`);
      indicatorComparisons += 1;
    });
  }
}
compareSnapshot(calculate(), BASELINE, 'baseline');

const scenarios = new Map();
const scenarioKey = decisions => decisions.map(d => `${d.id}:${d.districtId || 'city'}`).sort().join('|');
function addScenario(label, decisions) {
  assert.equal(getScenarioIssue(decisions), null, `${label}: local scenario must be valid`);
  const key = scenarioKey(decisions);
  if (!scenarios.has(key)) scenarios.set(key, { label, decisions });
}
for (const preset of PRESETS) addScenario(preset.id, preset.decisions);

let seed = 51853;
function random() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
}
function shuffle(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}
function completeScenario(initial) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const decisions = initial.map(decision => ({ ...decision }));
    if (decisions.some((decision, index) => getAdditionIssue(decisions.slice(0, index), decision.id, decision.districtId))) return null;
    for (const measure of shuffle(MEASURES)) {
      const targets = measure.scope === 'city' ? [null] : shuffle(DISTRICTS.map(district => district.id));
      const target = targets.find(id => !getAdditionIssue(decisions, measure.id, id));
      if (target !== undefined) decisions.push({ id: measure.id, ...(target ? { districtId: target } : {}) });
      if (decisions.length === RULES.required_decisions) return decisions;
    }
  }
  return null;
}

// Exercise each catalog synergy with every supported district as its target.
for (const synergy of RULES.synergies) {
  for (const district of DISTRICTS) {
    const second = MEASURES.find(measure => measure.id === synergy.second_measure_id);
    const initial = [
      { id: synergy.first_measure_id, districtId: district.id },
      { id: second.id, ...(second.scope === 'district' ? { districtId: district.id } : {}) }
    ];
    const decisions = completeScenario(initial);
    assert.ok(decisions, `Cannot build a valid scenario for ${synergy.first_measure_id}/${second.id}/${district.id}`);
    addScenario(`synergy ${synergy.first_measure_id}/${second.id}/${district.id}`, decisions);
  }
}
// Guarantee every measure, and therefore every catalog lag, is exercised.
for (const [index, measure] of MEASURES.entries()) {
  const decisions = completeScenario([{ id: measure.id, ...(measure.scope === 'district' ? { districtId: DISTRICTS[index % DISTRICTS.length].id } : {}) }]);
  assert.ok(decisions, `Cannot build a valid scenario for ${measure.id}`);
  addScenario(`measure ${measure.id}`, decisions);
}
const targetCount = Math.max(36, scenarios.size);
for (let attempt = 0; scenarios.size < targetCount && attempt < 100; attempt++) {
  const decisions = completeScenario([]);
  if (decisions) addScenario(`generated ${attempt + 1}`, decisions);
}
assert.equal(scenarios.size, targetCount, 'bounded generator must create enough distinct valid scenarios');

const coveredMeasures = new Set(), coveredLags = new Set(), coveredSynergies = new Set();
let clippedPairs = 0;
for (const { label, decisions } of scenarios.values()) {
  const draft = await post('validate', decisions);
  assert.equal(draft.valid_draft, true, `${label}: server draft validation`);
  assert.equal(draft.can_evaluate, true, `${label}: server final validation`);
  const report = await post('evaluate', decisions);
  assert.equal(report.model_version, MODEL_VERSION);
  compareSnapshot(calculate(decisions), fromServerSnapshot(report.after, report.budget.spent), label);
  compareSnapshot(calculate(), fromServerSnapshot(report.baseline), `${label}.baseline`);
  const raw = Object.fromEntries(catalog.districts.map(district => [district.id, { ...district.indicators }]));
  for (const effect of report.measure_effects) {
    const measure = MEASURES.find(item => item.id === effect.measure_id);
    coveredMeasures.add(measure.id);
    coveredLags.add(measure.lag);
    close(effect.realized_fraction, (RULES.horizon_quarters - measure.lag) / RULES.horizon_quarters, `${label}.${measure.id}.lag`);
    const decision = decisions.find(item => item.id === measure.id);
    const expectedTargets = measure.scope === 'city' ? DISTRICTS.map(d => d.id).sort() : [decision.districtId];
    assert.deepEqual(Object.keys(effect.additions).map(toUiDistrictId).sort(), expectedTargets, `${label}.${measure.id}.targets`);
    for (const [districtId, additions] of Object.entries(effect.additions)) {
      for (const [code, addition] of Object.entries(additions)) {
        close(addition, measure.effects[code] * effect.realized_fraction, `${label}.${measure.id}.${code}.addition`);
        raw[districtId][code] += addition;
      }
    }
  }
  for (const synergy of report.synergy_effects) {
    coveredSynergies.add(`${synergy.first_measure_id}/${synergy.second_measure_id}`);
    assert.equal(toUiDistrictId(synergy.district_id), decisions.find(item => item.id === synergy.first_measure_id).districtId, `${label}.synergyTarget`);
    raw[synergy.district_id][synergy.indicator] += synergy.bonus;
  }
  // Verify that clipping is applied once, after all additions and synergies.
  for (const district of report.after.districts) {
    for (const [code, number] of Object.entries(district.indicators)) {
      const total = raw[district.id][code];
      if (total < 0 || total > 100) clippedPairs += 1;
      close(number, Math.max(0, Math.min(100, total)), `${label}.${district.id}.${code}.clip`);
    }
  }
}
assert.deepEqual([...coveredMeasures].sort(), MEASURES.map(measure => measure.id).sort());
assert.deepEqual([...coveredLags].sort(), [...new Set(MEASURES.map(measure => measure.lag))].sort());
assert.deepEqual([...coveredSynergies].sort(), RULES.synergies.map(synergy => `${synergy.first_measure_id}/${synergy.second_measure_id}`).sort());

const firstDistrict = DISTRICTS[0].id, secondDistrict = DISTRICTS[1].id;
const cityMeasure = MEASURES.find(measure => measure.scope === 'city');
const districtMeasure = MEASURES.find(measure => measure.scope === 'district');
const draftCases = [
  { label: 'empty', decisions: [] },
  { label: 'one city measure', decisions: [{ id: cityMeasure.id }] },
  { label: 'one district measure', decisions: [{ id: districtMeasure.id, districtId: firstDistrict }] },
  { label: 'partial preset', decisions: PRESETS[0].decisions.slice(0, -1) },
  { label: 'full preset', decisions: PRESETS[0].decisions },
  { label: 'too many decisions', decisions: [...PRESETS[0].decisions, { id: cityMeasure.id }] },
  { label: 'duplicate', decisions: [{ id: cityMeasure.id }, { id: cityMeasure.id }] },
  { label: 'unknown measure', decisions: [{ id: 'unknown' }] },
  { label: 'unknown district', decisions: [{ id: districtMeasure.id, districtId: 'unknown' }] },
  { label: 'district required', decisions: [{ id: districtMeasure.id }] },
  { label: 'city district forbidden', decisions: [{ id: cityMeasure.id, districtId: firstDistrict }] }
];
for (const conflict of RULES.conflicts) {
  for (const target of [firstDistrict, secondDistrict]) {
    for (const [first, second] of [[conflict.first_measure_id, conflict.second_measure_id], [conflict.second_measure_id, conflict.first_measure_id]]) {
      draftCases.push({ label: `${conflict.scope} ${first}/${second}/${target}`, decisions: [{ id: first, districtId: firstDistrict }, { id: second, districtId: target }] });
    }
  }
}
const expensive = [...MEASURES].sort((a, b) => b.cost - a.cost).slice(0, RULES.required_decisions).map(measure => ({ id: measure.id, ...(measure.scope === 'district' ? { districtId: firstDistrict } : {}) }));
draftCases.push({ label: 'budget exceeded', decisions: expensive });
const direction = MEASURES.find(measure => MEASURES.filter(item => item.direction === measure.direction).length > RULES.max_per_direction).direction;
draftCases.push({ label: 'direction limit', decisions: MEASURES.filter(measure => measure.direction === direction).slice(0, RULES.max_per_direction + 1).map(measure => ({ id: measure.id, ...(measure.scope === 'district' ? { districtId: firstDistrict } : {}) })) });

const serverCodes = { unknown: 'UNKNOWN_MEASURE', duplicate: 'DUPLICATE_MEASURE', limit: 'DECISION_COUNT', districtRequired: ['DISTRICT_REQUIRED', 'UNKNOWN_DISTRICT'], cityOnly: 'DISTRICT_FORBIDDEN', budget: 'BUDGET_EXCEEDED', groupLimit: 'DIRECTION_LIMIT', incompatible: 'INCOMPATIBLE_MEASURES', districtConflict: 'DISTRICT_CONFLICT' };
for (const { label, decisions } of draftCases) {
  let issue = null;
  for (let index = 0; index < decisions.length && !issue; index++) issue = getAdditionIssue(decisions.slice(0, index), decisions[index].id, decisions[index].districtId);
  const result = await post('validate', decisions);
  assert.equal(result.valid_draft, !issue, `${label}.validDraft`);
  assert.equal(result.can_evaluate, getScenarioIssue(decisions) === null, `${label}.canEvaluate`);
  if (issue) {
    const expected = [serverCodes[issue.key.slice('errors.'.length)]].flat();
    assert.ok(result.errors.some(error => expected.includes(error.code)), `${label}: ${issue.key} missing in ${JSON.stringify(result.errors)}`);
  }
  const unknown = decisions.some(decision => !MEASURES.some(measure => measure.id === decision.id));
  assert.equal(result.budget.spent, unknown ? null : calculate(decisions).spent, `${label}.spent`);
}

console.log(JSON.stringify({
  modelVersion: MODEL_VERSION, scenarios: scenarios.size, presets: PRESETS.map(preset => preset.id),
  draftCases: draftCases.length, indicatorComparisons, measures: coveredMeasures.size,
  lags: [...coveredLags].sort(), synergies: [...coveredSynergies].sort(), clippedPairs,
  clippingNote: clippedPairs ? 'Clipped server outputs matched accumulated additions.' : 'No selected legal scenario exceeded indicator bounds; synthetic clipping boundaries are covered in model.test.js.'
}, null, 2));
