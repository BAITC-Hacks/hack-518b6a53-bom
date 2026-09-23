import test from 'node:test';
import assert from 'node:assert/strict';
import { BASELINE, INDICATORS, SYNERGIES, calculate, explainScenario, getAdditionIssue, getScenarioIssue, validateAddition, validateScenario } from './model.js';

const example = [
  { id: 'M7', districtId: 'nura' },
  { id: 'M8', districtId: 'nura' },
  { id: 'M10', districtId: 'nura' },
  { id: 'M12' },
  { id: 'M5', districtId: 'saryarka' }
];

test('база и пример из датасета воспроизводятся формулой', () => {
  assert.equal(BASELINE.score.toFixed(2), '52.56');
  assert.equal(BASELINE.critical, 2);
  assert.equal(validateScenario(example), null);
  const result = calculate(example);
  assert.equal(result.spent, 95);
  assert.equal(result.score.toFixed(2), '56.54');
});

test('лаг, городской эффект и синергия применяются к нужным районам', () => {
  const result = calculate([{ id: 'M10', districtId: 'nura' }, { id: 'M12' }]);
  const nura = result.districts.find(district => district.id === 'nura');
  const esil = result.districts.find(district => district.id === 'esil');
  assert.equal(nura.values[6], 67.5); // B1: 55 + 12 × 7/8 + 2
  assert.equal(nura.values[9], 54.375); // C2: 50 + 5 × 7/8
  assert.equal(esil.values[6], 78); // районная мера не действует на Есиль
  assert.equal(esil.values[9], 74.375);
});

test('валидатор ограничивает бюджет, количество мер, повторы и конфликты', () => {
  assert.match(validateAddition([{ id: 'M7', districtId: 'nura' }], 'M7', 'esil'), /уже выбрано/);
  assert.match(validateAddition([{ id: 'M3', districtId: 'nura' }], 'M1', 'esil'), /несовместимы/);
  assert.match(validateAddition([{ id: 'M4', districtId: 'nura' }], 'M7', 'nura'), /одном районе/);
  assert.match(validateAddition(example, 'M14'), /ровно 5/);
  assert.match(validateScenario(example.slice(0, 4)), /ровно 5/);
  assert.match(validateAddition([{ id: 'M3', districtId: 'nura' }, { id: 'M5', districtId: 'saryarka' }, { id: 'M7', districtId: 'nura' }, { id: 'M8', districtId: 'esil' }], 'M13', 'almaty'), /Бюджет/);
});

const validationCases = [
  { key: 'unknown', decisions: [], id: 'missing', message: 'Мероприятие не найдено.' },
  { key: 'duplicate', decisions: [{ id: 'M7', districtId: 'nura' }], id: 'M7', districtId: 'esil', message: 'Это мероприятие уже выбрано.' },
  { key: 'limit', decisions: example, id: 'M14', message: 'Можно принять ровно 5 решений.' },
  { key: 'districtRequired', decisions: [], id: 'M7', message: 'Перетащите меру на район.' },
  { key: 'districtRequired', decisions: [], id: 'M7', districtId: 'missing', message: 'Перетащите меру на район.' },
  { key: 'cityOnly', decisions: [], id: 'M2', districtId: 'nura', message: 'Эта мера применяется ко всему городу.' },
  { key: 'budget', decisions: example.filter(decision => decision.id !== 'M10'), id: 'M3', districtId: 'esil', message: 'Бюджет 100 ед. будет превышен.' },
  { key: 'groupLimit', decisions: example.slice(0, 2), id: 'M9', districtId: 'esil', message: 'Не более двух мер из одного направления.' },
  { key: 'incompatible', decisions: [{ id: 'M3', districtId: 'nura' }], id: 'M1', districtId: 'esil', message: 'M1 и M3 несовместимы.' },
  { key: 'incompatible', decisions: [{ id: 'M1', districtId: 'nura' }], id: 'M3', districtId: 'esil', message: 'M1 и M3 несовместимы.' },
  ...[['M4', 'M7'], ['M5', 'M13']].flatMap(([first, second]) => [
    { id: first, other: second }, { id: second, other: first }
  ].map(({ id, other }) => ({
    key: 'districtConflict', decisions: [{ id: other, districtId: 'nura' }], id, districtId: 'nura',
    params: { first, second }, message: `${first} и ${second} нельзя применить в одном районе.`
  })))
];

test('коды ошибок и параметры сохраняют все прежние сообщения валидатора добавления', () => {
  for (const { decisions, id, districtId, key, params = {}, message } of validationCases) {
    assert.deepEqual(getAdditionIssue(decisions, id, districtId), { key: `errors.${key}`, params }, `${key}: ${id}`);
    assert.equal(validateAddition(decisions, id, districtId), message, `${key}: ${id}`);
  }
});

test('валидатор сценария возвращает первую кодированную ошибку и прежнее русское сообщение', () => {
  for (const { decisions, id, districtId, key, params = {}, message } of validationCases) {
    if (key === 'limit') continue; // An exact five-item scenario cannot hit the addition limit.
    const scenario = [...decisions, { id, districtId }];
    while (scenario.length < 5) scenario.push({ id: 'M14' });
    assert.deepEqual(getScenarioIssue(scenario), { key: `errors.${key}`, params }, `${key}: ${id}`);
    assert.equal(validateScenario(scenario), message, `${key}: ${id}`);
  }
  for (const scenario of [[], example.slice(0, 4), [...example, { id: 'M14' }]]) {
    assert.deepEqual(getScenarioIssue(scenario), { key: 'errors.count', params: {} });
    assert.equal(validateScenario(scenario), 'Выберите ровно 5 мероприятий.');
  }
});

test('кодированные валидаторы принимают допустимые сценарии без изменения входных данных', () => {
  const snapshot = structuredClone(example);
  assert.equal(getScenarioIssue(example), null);
  assert.equal(validateScenario(example), null);
  assert.equal(getAdditionIssue([], 'M2', null), null);
  assert.equal(validateAddition([], 'M2', null), null);
  assert.equal(getAdditionIssue(example.slice(0, 4), 'M3', 'esil'), null); // Exactly 100 is allowed.
  for (const [first, second] of [['M4', 'M7'], ['M5', 'M13']]) {
    assert.equal(getAdditionIssue([{ id: first, districtId: 'nura' }], second, 'esil'), null);
    assert.equal(validateAddition([{ id: first, districtId: 'nura' }], second, 'esil'), null);
  }
  assert.deepEqual(example, snapshot);
});

const closeTo = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-10, `${message}: ${actual} ≠ ${expected}`);

test('объяснение пустого сценария сохраняет базу и показывает оставшиеся проблемы', () => {
  const explanation = explainScenario();
  assert.deepEqual(explanation.result, BASELINE);
  assert.deepEqual(explanation.contributions, []);
  assert.deepEqual(explanation.synergies, []);
  assert.ok(explanation.districts.every(district => district.delta === 0));
  const nura = explanation.districts.find(district => district.id === 'nura');
  assert.deepEqual(nura.critical, [
    { code: 'S1', before: 38, after: 38 },
    { code: 'S2', before: 35, after: 35 }
  ]);
  assert.deepEqual(nura.lowest, { code: 'S2', before: 35, after: 35 });
});

test('объяснение сохраняет отрицательный эффект переходов и нулевые эффекты других районов', () => {
  const decisions = [{ id: 'M11', districtId: 'nura' }];
  const explanation = explainScenario(decisions);
  const contribution = explanation.contributions[0];
  assert.equal(contribution.districtId, 'nura');
  const nura = contribution.districts.find(district => district.id === 'nura');
  assert.equal(nura.values[0], -1.75); // T1: -2 × 7/8
  assert.equal(nura.values[7], 10.5); // B2: +12 × 7/8
  closeTo(nura.scoreDelta, -.175 + .945, 'district trade-off');
  closeTo(contribution.cityScoreDelta, explanation.result.score - BASELINE.score, 'single city contribution');
  for (const district of contribution.districts.filter(district => district.id !== 'nura')) {
    assert.equal(district.scoreDelta, 0);
    assert.deepEqual(district.values, Array(10).fill(0));
  }
});

test('синергии объясняются в нужном районе и делятся поровну между двумя мероприятиями', () => {
  for (const synergy of SYNERGIES) {
    const decisions = [{ id: synergy.first, districtId: 'nura' }, { id: synergy.second }];
    const explanation = explainScenario(decisions);
    assert.deepEqual(explanation.synergies, [{ ...synergy, districtId: 'nura' }]);
    assert.equal(explanation.contributions[1].districtId, null);
    const indicatorIndex = INDICATORS.findIndex(indicator => indicator.code === synergy.code);
    for (let index = 0; index < decisions.length; index++) {
      const single = calculate([decisions[index]]).districts.find(district => district.id === 'nura');
      const base = BASELINE.districts.find(district => district.id === 'nura');
      const contribution = explanation.contributions[index].districts.find(district => district.id === 'nura');
      closeTo(contribution.values[indicatorIndex], single.values[indicatorIndex] - base.values[indicatorIndex] + synergy.bonus / 2, `${synergy.first}/${synergy.second} half bonus`);
    }
    assert.deepEqual(explainScenario(decisions.slice(0, 1)).synergies, []);
    assert.deepEqual(explainScenario(decisions.slice(1)).synergies, []);
  }
});

const weakestSwitch = [
  { id: 'M3', districtId: 'nura' },
  { id: 'M7', districtId: 'nura' },
  { id: 'M8', districtId: 'nura' },
  { id: 'M11', districtId: 'nura' },
  { id: 'M10', districtId: 'nura' }
];

test('вклады сходятся с расчётом города, районов и показателей, включая смену слабейшего района', () => {
  assert.equal(validateScenario(weakestSwitch), null);
  const switched = calculate(weakestSwitch);
  const weakest = switched.districts.reduce((lowest, district) => district.score < lowest.score ? district : lowest);
  assert.equal(weakest.id, 'saryarka');
  assert.equal(switched.critical, 0);
  for (const decisions of [[], example, weakestSwitch, [{ id: 'M1', districtId: 'almaty' }, { id: 'M2' }]]) {
    const snapshot = structuredClone(decisions);
    const { result, contributions, districts } = explainScenario(decisions);
    assert.deepEqual(result, calculate(decisions));
    closeTo(contributions.reduce((sum, item) => sum + item.cityScoreDelta, 0), result.score - BASELINE.score, 'city conservation');
    result.districts.forEach((district, index) => {
      const districtDelta = district.score - BASELINE.districts[index].score;
      closeTo(contributions.reduce((sum, item) => sum + item.districts[index].scoreDelta, 0), districtDelta, `${district.id} conservation`);
      closeTo(districts[index].delta, districtDelta, `${district.id} explained delta`);
      district.values.forEach((value, indicatorIndex) => {
        closeTo(contributions.reduce((sum, item) => sum + item.districts[index].values[indicatorIndex], 0), value - BASELINE.districts[index].values[indicatorIndex], `${district.id}/${INDICATORS[indicatorIndex].code} conservation`);
      });
      assert.deepEqual(districts[index].critical.map(indicator => indicator.code), INDICATORS.filter((_, indicatorIndex) => district.values[indicatorIndex] < 40).map(indicator => indicator.code));
      assert.equal(districts[index].lowest.after, Math.min(...district.values));
    });
    assert.deepEqual(decisions, snapshot);
  }
});

test('распределение вклада не зависит от порядка добавления мероприятий', () => {
  const forward = explainScenario(weakestSwitch);
  const reverse = explainScenario([...weakestSwitch].reverse());
  for (const contribution of forward.contributions) {
    const other = reverse.contributions.find(item => item.id === contribution.id);
    closeTo(contribution.cityScoreDelta, other.cityScoreDelta, `${contribution.id} city order independence`);
    contribution.districts.forEach((district, index) => {
      closeTo(district.scoreDelta, other.districts[index].scoreDelta, `${contribution.id}/${district.id} order independence`);
      district.values.forEach((value, indicatorIndex) => closeTo(value, other.districts[index].values[indicatorIndex], 'indicator order independence'));
    });
  }
});
