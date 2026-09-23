import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BASELINE, BUDGET, HORIZON, REQUIRED_DECISIONS, RULES, MODEL_VERSION, INDICATORS, DISTRICTS, MEASURES, PRESETS, calculate, configureCatalog, getAdditionIssue, getScenarioIssue, toSelections, fromServerSnapshot } from './model.js';

const source = Object.fromEntries(await Promise.all(['districts', 'measures', 'rules', 'presets'].map(async name => [name, JSON.parse(await readFile(new URL(`data/tech2-v1/${name}.json`, import.meta.url), 'utf8'))])));
const { model_version, ...rules } = source.rules;
const catalog = { model_version, rules, districts: source.districts.districts, measures: source.measures.measures, presets: source.presets.presets };
configureCatalog(catalog);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const value = (result, districtId, code) => result.districts.find(district => district.id === districtId).values[INDICATORS.findIndex(indicator => indicator.code === code)];

test('a new model cannot calculate without a catalog and invalid catalog data fails explicitly', async () => {
  const empty = await import('./model.js?unconfigured-test');
  assert.equal(empty.BASELINE, null);
  assert.deepEqual(empty.MEASURES, []);
  assert.throws(() => empty.calculate(), { code: 'CATALOG_NOT_READY' });
  assert.throws(() => empty.configureCatalog({}), { code: 'INVALID_CATALOG' });
  const invalid = structuredClone(catalog);
  delete invalid.districts[0].indicators.T1;
  assert.throws(() => empty.configureCatalog(invalid), { code: 'INVALID_CATALOG' });
});

test('catalog adapters map IDs and categories and preserve server data immutably', () => {
  const input = structuredClone(catalog);
  configureCatalog(input);
  assert.equal(MODEL_VERSION, catalog.model_version);
  assert.equal(BUDGET, rules.budget_limit);
  assert.equal(HORIZON, rules.horizon_quarters);
  assert.equal(REQUIRED_DECISIONS, rules.required_decisions);
  assert.equal(DISTRICTS[0].id, 'esil');
  assert.equal(DISTRICTS[0].apiId, 'yesil');
  assert.equal(MEASURES.find(measure => measure.id === 'M10').group, 'Безопасность');
  assert.deepEqual(toSelections([{ id: 'M1', districtId: 'esil' }, { id: 'M2' }]), [{ measure_id: 'M1', district_id: 'yesil' }, { measure_id: 'M2' }]);
  input.rules.budget_limit = 1;
  input.districts[0].indicators.T1 = 0;
  assert.equal(BUDGET, 100);
  assert.equal(DISTRICTS[0].values[0], 45);
  assert.ok(Object.isFrozen(RULES.conflicts));
});

test('baseline and both backend presets match independently recorded backend acceptance results', () => {
  configureCatalog(catalog);
  close(BASELINE.average, 56.8624);
  close(BASELINE.weakest, 49.18);
  close(BASELINE.score, 52.55768);
  assert.equal(BASELINE.critical, 2);
  const expected = { 'tech2-example': { score: 56.54307, spent: 95 }, 'tech2-cheapest': { score: 55.343025, spent: 61 } };
  for (const preset of PRESETS) {
    assert.equal(getScenarioIssue(preset.decisions), null);
    const after = calculate(preset.decisions);
    close(after.score, expected[preset.id].score);
    assert.equal(after.spent, expected[preset.id].spent);
    assert.deepEqual(calculate([...preset.decisions].reverse()), after);
  }
  close(value(calculate(PRESETS[0].decisions), 'nura', 'S1'), 48);
  close(value(calculate(PRESETS[0].decisions), 'nura', 'S2'), 43.75);
});

test('draft previews apply city scope, lag and every configured synergy only to the targeted district', () => {
  configureCatalog(catalog);
  for (const synergy of RULES.synergies) {
    const selections = [{ id: synergy.first_measure_id, districtId: 'esil' }, { id: synergy.second_measure_id }];
    const after = calculate(selections);
    const baseline = value(BASELINE, 'esil', synergy.indicator);
    const additions = selections.reduce((sum, selection) => {
      const measure = MEASURES.find(item => item.id === selection.id);
      return sum + (measure.effects[synergy.indicator] || 0) * (HORIZON - measure.lag) / HORIZON;
    }, 0);
    close(value(after, 'esil', synergy.indicator), baseline + additions + synergy.bonus);
    const city = MEASURES.find(item => item.id === synergy.second_measure_id);
    close(value(after, 'nura', synergy.indicator), value(BASELINE, 'nura', synergy.indicator) + (city.effects[synergy.indicator] || 0) * (HORIZON - city.lag) / HORIZON);
  }
});

test('validation uses catalog counts, budget, directions and conflict definitions', () => {
  configureCatalog(catalog);
  assert.equal(getAdditionIssue([], 'missing').key, 'errors.unknown');
  assert.equal(getAdditionIssue([{ id: 'M7', districtId: 'nura' }], 'M7', 'esil').key, 'errors.duplicate');
  assert.equal(getAdditionIssue([], 'M7').key, 'errors.districtRequired');
  assert.equal(getAdditionIssue([], 'M7', 'missing').key, 'errors.districtRequired');
  assert.equal(getAdditionIssue([], 'M2', 'nura').key, 'errors.cityOnly');
  assert.deepEqual(getScenarioIssue([]), { key: 'errors.count', params: { count: 5 } });
  assert.deepEqual(getAdditionIssue(PRESETS[0].decisions, 'M14'), { key: 'errors.limit', params: { count: 5 } });
  for (const conflict of rules.conflicts) {
    const first = conflict.first_measure_id, second = conflict.second_measure_id;
    for (const [existing, added] of [[first, second], [second, first]]) {
      assert.deepEqual(getAdditionIssue([{ id: existing, districtId: 'nura' }], added, 'nura'), { key: conflict.scope === 'global' ? 'errors.incompatible' : 'errors.districtConflict', params: { first, second } });
      assert.equal(Boolean(getAdditionIssue([{ id: existing, districtId: 'nura' }], added, 'esil')), conflict.scope === 'global');
    }
  }
  const changed = structuredClone(catalog);
  changed.rules.required_decisions = 2;
  changed.rules.budget_limit = 15;
  changed.rules.max_per_direction = 1;
  configureCatalog(changed);
  assert.deepEqual(getAdditionIssue([], 'M1', 'esil'), { key: 'errors.budget', params: { budget: 15 } });
  assert.deepEqual(getScenarioIssue([]), { key: 'errors.count', params: { count: 2 } });
  changed.rules.budget_limit = 100;
  changed.rules.conflicts = [{ first_measure_id: 'M4', second_measure_id: 'M8', scope: 'global' }];
  configureCatalog(changed);
  assert.deepEqual(getAdditionIssue([{ id: 'M1', districtId: 'esil' }], 'M2'), { key: 'errors.groupLimit', params: { count: 1 } });
  assert.deepEqual(getAdditionIssue([{ id: 'M4', districtId: 'esil' }], 'M8', 'nura'), { key: 'errors.incompatible', params: { first: 'M4', second: 'M8' } });
  configureCatalog(catalog);
});

test('preview derives thresholds, penalty, score weights, effects, horizon and synergies from refreshed catalog', () => {
  const changed = structuredClone(catalog);
  changed.rules.horizon_quarters = 10;
  changed.rules.critical_threshold = 60;
  changed.rules.critical_penalty = 2;
  changed.rules.average_weight = 1;
  changed.rules.minimum_weight = 0;
  changed.rules.synergies = [{ first_measure_id: 'M10', second_measure_id: 'M12', indicator: 'T1', bonus: 7 }];
  changed.measures.find(measure => measure.id === 'M10').effects = { T1: 5 };
  configureCatalog(changed);
  const after = calculate([{ id: 'M10', districtId: 'esil' }, { id: 'M12' }]);
  close(value(after, 'esil', 'T1'), 45 + 5 * 9 / 10 + 7);
  assert.equal(after.critical, after.districts.flatMap(d => d.values).filter(number => number < 60).length);
  close(after.score, after.average - after.critical * 2);
  configureCatalog(catalog);
});

test('all additions are combined before clipping, without mutating baseline or input selections', () => {
  const changed = structuredClone(catalog);
  changed.districts.find(district => district.id === 'yesil').indicators.T1 = 99;
  changed.measures.find(measure => measure.id === 'M1').effects = { T1: 12 };
  changed.measures.find(measure => measure.id === 'M11').effects = { T1: -8 };
  configureCatalog(changed);
  const decisions = [{ id: 'M1', districtId: 'esil' }, { id: 'M11', districtId: 'esil' }];
  const before = structuredClone({ decisions, districts: DISTRICTS, baseline: BASELINE });
  close(value(calculate(decisions), 'esil', 'T1'), 100); // 99 + 9 - 7
  assert.deepEqual({ decisions, districts: DISTRICTS, baseline: BASELINE }, before);
  configureCatalog(catalog);
});

test('server snapshots retain authoritative numeric scores and adapt shuffled indicators and yesil', () => {
  configureCatalog(catalog);
  const snapshot = {
    score: 17.25, average: 18.5, minimum: 16.75, critical_pairs: [{ district_id: 'nura', indicator: 'S1', value: 38 }],
    districts: catalog.districts.map(district => ({ id: district.id, district_score: 23, indicators: Object.fromEntries(Object.entries(district.indicators).reverse()) })).reverse()
  };
  const adapted = fromServerSnapshot(snapshot, 61);
  assert.equal(adapted.score, 17.25);
  assert.equal(adapted.weakest, 16.75);
  assert.equal(adapted.critical, 1);
  assert.equal(adapted.spent, 61);
  assert.equal(adapted.districts[0].id, 'esil');
  assert.equal(adapted.districts[0].score, 23);
  assert.deepEqual(adapted.districts[0].values, DISTRICTS[0].values);
  assert.throws(() => fromServerSnapshot({ ...snapshot, districts: [] }), { code: 'INVALID_CATALOG' });
  configureCatalog({ ...catalog, baseline: snapshot });
  assert.equal(BASELINE.score, 17.25);
  configureCatalog(catalog);
});
