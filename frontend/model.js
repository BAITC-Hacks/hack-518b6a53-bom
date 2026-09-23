import { translate } from './i18n.js';

// The API catalog supplies all simulation data and numerical rules. These maps
// only adapt API identifiers to the existing geometry and presentation labels.
const groupLabels = { transport: 'Транспорт', ecology: 'Экология', social: 'Соцсфера', safety: 'Безопасность', services: 'Сервисы' };
const indicatorDirections = { T: 'transport', E: 'ecology', S: 'social', B: 'safety', C: 'services' };
export const toUiDistrictId = id => id === 'yesil' ? 'esil' : id;
export const toApiDistrictId = id => id === 'esil' ? 'yesil' : id;

export let INDICATORS = [];
export let DISTRICTS = [];
export let MEASURES = [];
export let BUDGET = 0;
export let HORIZON = 0;
export let REQUIRED_DECISIONS = 0;
export let MODEL_VERSION = null;
export let RULES = null;
export let SYNERGIES = [];
export let BASELINE = null;
export let PRESETS = [];
let byCode = {};
let byMeasure = {};

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function requireCatalog() {
  if (!RULES) throw Object.assign(new Error('Catalog has not been loaded'), { code: 'CATALOG_NOT_READY' });
}
function invalidCatalog() {
  return Object.assign(new Error('The server catalog is incomplete'), { code: 'INVALID_CATALOG' });
}

export function configureCatalog(catalog) {
  const data = structuredClone(catalog);
  const rules = data?.rules;
  const numericRules = ['budget_limit', 'required_decisions', 'max_per_direction', 'horizon_quarters', 'critical_threshold', 'critical_penalty', 'average_weight', 'minimum_weight'];
  if (!data?.model_version || !Array.isArray(data.districts) || !data.districts.length || !Array.isArray(data.measures) || !data.measures.length ||
      !rules || !numericRules.every(key => Number.isFinite(rules[key])) || rules.horizon_quarters <= 0 || rules.required_decisions < 1 ||
      !rules.indicator_weights || !Object.keys(rules.indicator_weights).length || !Array.isArray(rules.conflicts) || !Array.isArray(rules.synergies)) throw invalidCatalog();
  const indicators = Object.entries(rules.indicator_weights).map(([code, weight]) => ({ code, weight, group: groupLabels[indicatorDirections[code[0]]] }));
  const districts = data.districts.map(district => ({
    id: toUiDistrictId(district.id), apiId: district.id, name: district.name,
    population: district.population_share, values: indicators.map(indicator => district.indicators?.[indicator.code])
  }));
  const measures = data.measures.map(measure => ({ ...measure, name: measure.title, group: groupLabels[measure.direction] }));
  if (indicators.some(indicator => !Number.isFinite(indicator.weight) || !indicator.group) ||
      districts.some(district => !district.id || !Number.isFinite(district.population) || district.values.some(value => !Number.isFinite(value))) ||
      measures.some(measure => !measure.id || !measure.group || !['city', 'district'].includes(measure.scope) || !Number.isFinite(measure.cost) || !Number.isFinite(measure.lag) || !measure.effects || Object.entries(measure.effects).some(([code, value]) => !Object.hasOwn(rules.indicator_weights, code) || !Number.isFinite(value))) ||
      new Set(districts.map(d => d.id)).size !== districts.length || new Set(measures.map(m => m.id)).size !== measures.length) throw invalidCatalog();

  INDICATORS = freeze(indicators);
  DISTRICTS = freeze(districts);
  MEASURES = freeze(measures);
  RULES = freeze(rules);
  SYNERGIES = freeze(rules.synergies.map(synergy => ({ first: synergy.first_measure_id, second: synergy.second_measure_id, code: synergy.indicator, bonus: synergy.bonus })));
  BUDGET = rules.budget_limit;
  HORIZON = rules.horizon_quarters;
  REQUIRED_DECISIONS = rules.required_decisions;
  MODEL_VERSION = data.model_version;
  byCode = Object.fromEntries(INDICATORS.map((indicator, index) => [indicator.code, index]));
  byMeasure = Object.fromEntries(MEASURES.map(measure => [measure.id, measure]));
  PRESETS = freeze((data.presets || []).map(preset => ({ ...preset, decisions: preset.selections.map(selection => ({ id: selection.measure_id, ...(selection.district_id ? { districtId: toUiDistrictId(selection.district_id) } : {}) })) })));
  BASELINE = freeze(data.baseline ? fromServerSnapshot(data.baseline) : calculate());
  return BASELINE;
}

const issue = (key, params = {}) => ({ key: `errors.${key}`, params });

export function getAdditionIssue(decisions, id, districtId) {
  requireCatalog();
  const measure = byMeasure[id];
  if (!measure || decisions.some(decision => !byMeasure[decision.id])) return issue('unknown');
  if (decisions.some(decision => decision.id === id)) return issue('duplicate');
  if (decisions.length >= REQUIRED_DECISIONS) return issue('limit', { count: REQUIRED_DECISIONS });
  if (measure.scope === 'district' && !DISTRICTS.some(district => district.id === districtId)) return issue('districtRequired');
  if (measure.scope === 'city' && districtId) return issue('cityOnly');
  if (decisions.reduce((sum, decision) => sum + byMeasure[decision.id].cost, 0) + measure.cost > BUDGET) return issue('budget', { budget: BUDGET });
  if (decisions.filter(decision => byMeasure[decision.id].direction === measure.direction).length >= RULES.max_per_direction) return issue('groupLimit', { count: RULES.max_per_direction });
  for (const conflict of RULES.conflicts) {
    const first = conflict.first_measure_id, second = conflict.second_measure_id;
    if (id !== first && id !== second) continue;
    const other = decisions.find(decision => decision.id === (id === first ? second : first));
    if (other && (conflict.scope === 'global' || other.districtId === districtId)) {
      return issue(conflict.scope === 'global' ? 'incompatible' : 'districtConflict', { first, second });
    }
  }
  return null;
}

export function getScenarioIssue(decisions) {
  requireCatalog();
  if (decisions.length !== REQUIRED_DECISIONS) return issue('count', { count: REQUIRED_DECISIONS });
  const accepted = [];
  for (const decision of decisions) {
    const error = getAdditionIssue(accepted, decision.id, decision.districtId || null);
    if (error) return error;
    accepted.push(decision);
  }
  return null;
}

// Compatibility helpers for callers that still expect a Russian message.
const russianMessage = error => error ? translate(error.key, error.params, 'ru') : null;
export const validateAddition = (decisions, id, districtId) => russianMessage(getAdditionIssue(decisions, id, districtId));
export const validateScenario = decisions => russianMessage(getScenarioIssue(decisions));

const clip = value => Math.max(0, Math.min(100, value));
const districtScore = values => values.reduce((sum, value, index) => sum + value * INDICATORS[index].weight, 0);

export function calculate(decisions = []) {
  requireCatalog();
  const districts = DISTRICTS.map(district => ({ ...district, values: [...district.values] }));
  // Match backend summation order, independently of the order of UI interactions.
  const ordered = [...decisions].sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
  for (const decision of ordered) {
    const measure = byMeasure[decision.id];
    if (!measure) continue;
    const targets = measure.scope === 'city' ? districts : districts.filter(district => district.id === decision.districtId);
    for (const target of targets) {
      for (const [code, effect] of Object.entries(measure.effects)) target.values[byCode[code]] += effect * (HORIZON - measure.lag) / HORIZON;
    }
  }
  const selected = new Map(ordered.map(decision => [decision.id, decision]));
  for (const synergy of RULES.synergies) {
    const first = selected.get(synergy.first_measure_id);
    if (!first || !selected.has(synergy.second_measure_id)) continue;
    const district = districts.find(item => item.id === first.districtId);
    if (district) district.values[byCode[synergy.indicator]] += synergy.bonus;
  }
  for (const district of districts) {
    district.values = district.values.map(clip);
    district.score = districtScore(district.values);
    district.baselineScore = districtScore(DISTRICTS.find(item => item.id === district.id).values);
  }
  const average = districts.reduce((sum, district) => sum + district.population * district.score, 0);
  const weakest = Math.min(...districts.map(district => district.score));
  const critical = districts.reduce((sum, district) => sum + district.values.filter(value => value < RULES.critical_threshold).length, 0);
  return { districts, average, weakest, critical, score: RULES.average_weight * average + RULES.minimum_weight * weakest - RULES.critical_penalty * critical, spent: decisions.reduce((sum, decision) => sum + (byMeasure[decision.id]?.cost || 0), 0) };
}

export function explainScenario(decisions = []) {
  requireCatalog();
  if (decisions.length > REQUIRED_DECISIONS) throw new RangeError(`Scenario explanations support at most ${REQUIRED_DECISIONS} decisions.`);

  // One model run per subset. Shapley attribution averages each measure's marginal
  // effect across all addition orders, sharing synergies and threshold changes.
  const count = decisions.length;
  const factorial = [1];
  for (let index = 1; index <= count; index++) factorial.push(factorial[index - 1] * index);
  const subsets = Array.from({ length: 2 ** count }, (_, mask) => {
    const included = decisions.filter((_, index) => mask & (1 << index));
    return { size: included.length, result: calculate(included) };
  });
  const baseline = subsets[0].result;
  const result = subsets[subsets.length - 1].result;
  const contributions = decisions.map((decision, index) => {
    const contribution = {
      id: decision.id,
      districtId: byMeasure[decision.id]?.scope === 'city' ? null : decision.districtId || null,
      cityScoreDelta: 0,
      districts: DISTRICTS.map(district => ({ id: district.id, scoreDelta: 0, values: INDICATORS.map(() => 0) }))
    };
    for (let mask = 0; mask < subsets.length; mask++) {
      if (mask & (1 << index)) continue;
      const { size, result: before } = subsets[mask];
      const after = subsets[mask | (1 << index)].result;
      const weight = factorial[size] * factorial[count - size - 1] / factorial[count];
      contribution.cityScoreDelta += (after.score - before.score) * weight;
      for (let districtIndex = 0; districtIndex < DISTRICTS.length; districtIndex++) {
        const district = contribution.districts[districtIndex];
        const prior = before.districts[districtIndex];
        const next = after.districts[districtIndex];
        district.scoreDelta += (next.score - prior.score) * weight;
        for (let indicatorIndex = 0; indicatorIndex < INDICATORS.length; indicatorIndex++) {
          district.values[indicatorIndex] += (next.values[indicatorIndex] - prior.values[indicatorIndex]) * weight;
        }
      }
    }
    return contribution;
  });
  const synergies = SYNERGIES.flatMap(synergy => {
    const first = decisions.find(decision => decision.id === synergy.first);
    if (!first || !decisions.some(decision => decision.id === synergy.second)) return [];
    if (!DISTRICTS.some(district => district.id === first.districtId)) return [];
    return [{ ...synergy, districtId: first.districtId }];
  });
  const districts = result.districts.map((district, index) => {
    const indicators = INDICATORS.map((indicator, indicatorIndex) => ({
      code: indicator.code,
      before: baseline.districts[index].values[indicatorIndex],
      after: district.values[indicatorIndex]
    }));
    return {
      id: district.id,
      delta: district.score - baseline.districts[index].score,
      critical: indicators.filter(indicator => indicator.after < RULES.critical_threshold),
      lowest: indicators.reduce((lowest, indicator) => indicator.after < lowest.after ? indicator : lowest)
    };
  });
  return { result, contributions, synergies, districts };
}

export function toSelections(decisions) {
  requireCatalog();
  return decisions.map(decision => ({ measure_id: decision.id, ...(decision.districtId ? { district_id: toApiDistrictId(decision.districtId) } : {}) }));
}

export function fromServerSnapshot(snapshot, spent = 0) {
  requireCatalog();
  if (!snapshot || !['score', 'average', 'minimum'].every(key => Number.isFinite(snapshot[key])) || !Array.isArray(snapshot.districts) || !Array.isArray(snapshot.critical_pairs)) throw invalidCatalog();
  const serverDistricts = new Map(snapshot.districts.map(district => [toUiDistrictId(district.id), district]));
  const districts = DISTRICTS.map(district => {
    const source = serverDistricts.get(district.id);
    const values = INDICATORS.map(indicator => source?.indicators?.[indicator.code]);
    if (!Number.isFinite(source?.district_score) || values.some(value => !Number.isFinite(value))) throw invalidCatalog();
    return { ...district, values, score: source.district_score, baselineScore: districtScore(district.values) };
  });
  return { districts, score: snapshot.score, average: snapshot.average, weakest: snapshot.minimum, critical: snapshot.critical_pairs.length, spent };
}
