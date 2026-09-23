export const INDICATORS = [
  { code: 'T1', name: 'Разгрузка дорог', group: 'Транспорт', weight: .10, description: '100 — нет пробок в час пик; 0 — движение стоит.' },
  { code: 'T2', name: 'Доступность транспорта', group: 'Транспорт', weight: .10, description: '100 — остановка в 500 м от каждого жителя, интервал до 10 минут.' },
  { code: 'E1', name: 'Озеленение', group: 'Экология', weight: .09, description: '100 — не менее 20 м² зелени на жителя.' },
  { code: 'E2', name: 'Качество воздуха', group: 'Экология', weight: .11, description: '100 — зимой AQI не выше 50; 0 — хронический смог.' },
  { code: 'S1', name: 'Школы и детсады', group: 'Соцсфера', weight: .11, description: '100 — покрыта нормативная потребность, нет второй смены.' },
  { code: 'S2', name: 'Первичная медпомощь', group: 'Соцсфера', weight: .11, description: '100 — норматив поликлиник на жителя выполнен.' },
  { code: 'B1', name: 'Безопасность улиц', group: 'Безопасность', weight: .09, description: '100 — освещение и камеры везде, минимум происшествий.' },
  { code: 'B2', name: 'Безопасность дорог', group: 'Безопасность', weight: .09, description: '100 — минимум ДТП с пострадавшими.' },
  { code: 'C1', name: 'Надёжность ЖКХ', group: 'Сервисы', weight: .10, description: '100 — нет аварий отопления и водоснабжения за год.' },
  { code: 'C2', name: 'Обращения жителей', group: 'Сервисы', weight: .10, description: '100 — все обращения закрываются в срок.' }
];

export const DISTRICTS = [
  { id: 'esil', name: 'Есиль', population: .27, profile: 'Сильная инфраструктура, нагрузка на мосты и школы.', values: [45, 62, 68, 72, 48, 55, 78, 60, 75, 70] },
  { id: 'almaty', name: 'Алматы', population: .24, profile: 'Старый жилой фонд и пробки.', values: [40, 75, 50, 55, 60, 65, 62, 52, 50, 60] },
  { id: 'saryarka', name: 'Сарыарка', population: .20, profile: 'Смог частного сектора и дефицит зелени.', values: [50, 70, 42, 40, 62, 68, 58, 55, 45, 55] },
  { id: 'baikonur', name: 'Байконур', population: .13, profile: 'Сбалансированный район без резких провалов.', values: [52, 68, 55, 50, 58, 60, 52, 58, 55, 58] },
  { id: 'nura', name: 'Нура', population: .16, profile: 'Самый слабый район по соцсфере и транспорту.', values: [55, 40, 45, 65, 38, 35, 55, 50, 60, 50] }
];

export const MEASURES = [
  { id: 'M1', group: 'Транспорт', name: 'Выделенные полосы для автобусов', scope: 'district', cost: 18, lag: 2, effects: { T1: 6, T2: 9 } },
  { id: 'M2', group: 'Транспорт', name: 'Умные светофоры', scope: 'city', cost: 22, lag: 2, effects: { T1: 4, B2: 3 } },
  { id: 'M3', group: 'Транспорт', name: 'Линия ЛРТ / расширение', scope: 'district', cost: 30, lag: 4, effects: { T1: 16, T2: 20, E2: 4 } },
  { id: 'M4', group: 'Экология', name: 'Парк / сквер', scope: 'district', cost: 15, lag: 2, effects: { E1: 12, E2: 3, B1: 2 } },
  { id: 'M5', group: 'Экология', name: 'Чистое топливо для частного сектора', scope: 'district', cost: 25, lag: 3, effects: { E2: 14, C1: 4 } },
  { id: 'M6', group: 'Экология', name: 'Городская программа озеленения', scope: 'city', cost: 20, lag: 4, effects: { E1: 5, E2: 3 } },
  { id: 'M7', group: 'Соцсфера', name: 'Школа + детсад', scope: 'district', cost: 24, lag: 3, effects: { S1: 16 } },
  { id: 'M8', group: 'Соцсфера', name: 'Центр семейного здоровья', scope: 'district', cost: 20, lag: 3, effects: { S2: 14 } },
  { id: 'M9', group: 'Соцсфера', name: 'Дворовые спорт-хабы', scope: 'district', cost: 10, lag: 1, effects: { S1: 3, S2: 3, B1: 3 } },
  { id: 'M10', group: 'Безопасность', name: 'Освещение и камеры Safe City', scope: 'district', cost: 12, lag: 1, effects: { B1: 12, B2: 2 } },
  { id: 'M11', group: 'Безопасность', name: 'Безопасные переходы', scope: 'district', cost: 10, lag: 1, effects: { B2: 12, T1: -2 } },
  { id: 'M12', group: 'Сервисы', name: 'Платформа обращений жителей', scope: 'city', cost: 14, lag: 1, effects: { C2: 5 } },
  { id: 'M13', group: 'Сервисы', name: 'Модернизация тепло- и водосетей', scope: 'district', cost: 28, lag: 4, effects: { C1: 18, E2: 2 } },
  { id: 'M14', group: 'Сервисы', name: 'Аварийные бригады ЖКХ', scope: 'city', cost: 16, lag: 1, effects: { C1: 5, C2: 2 } }
];

export const BUDGET = 100;
export const HORIZON = 8;
const byCode = Object.fromEntries(INDICATORS.map((indicator, index) => [indicator.code, index]));
const byMeasure = Object.fromEntries(MEASURES.map(measure => [measure.id, measure]));
const clip = value => Math.max(0, Math.min(100, value));
const districtScore = values => values.reduce((sum, value, index) => sum + value * INDICATORS[index].weight, 0);

const issue = (key, params = {}) => ({ key: `errors.${key}`, params });

export function getAdditionIssue(decisions, id, districtId) {
  const measure = byMeasure[id];
  if (!measure) return issue('unknown');
  if (decisions.some(decision => decision.id === id)) return issue('duplicate');
  if (decisions.length >= 5) return issue('limit');
  if (measure.scope === 'district' && !DISTRICTS.some(district => district.id === districtId)) return issue('districtRequired');
  if (measure.scope === 'city' && districtId) return issue('cityOnly');
  if (decisions.reduce((sum, decision) => sum + byMeasure[decision.id].cost, 0) + measure.cost > BUDGET) return issue('budget');
  if (decisions.filter(decision => byMeasure[decision.id].group === measure.group).length >= 2) return issue('groupLimit');
  if ((id === 'M1' && decisions.some(d => d.id === 'M3')) || (id === 'M3' && decisions.some(d => d.id === 'M1'))) return issue('incompatible');
  for (const [a, b] of [['M4', 'M7'], ['M5', 'M13']]) {
    if ((id === a || id === b) && decisions.some(d => d.id === (id === a ? b : a) && d.districtId === districtId)) return issue('districtConflict', { first: a, second: b });
  }
  return null;
}

export function getScenarioIssue(decisions) {
  if (decisions.length !== 5) return issue('count');
  const accepted = [];
  for (const decision of decisions) {
    const error = getAdditionIssue(accepted, decision.id, decision.districtId || null);
    if (error) return error;
    accepted.push(decision);
  }
  return null;
}

const russianIssueMessages = {
  'errors.unknown': 'Мероприятие не найдено.',
  'errors.duplicate': 'Это мероприятие уже выбрано.',
  'errors.limit': 'Можно принять ровно 5 решений.',
  'errors.districtRequired': 'Перетащите меру на район.',
  'errors.cityOnly': 'Эта мера применяется ко всему городу.',
  'errors.budget': 'Бюджет 100 ед. будет превышен.',
  'errors.groupLimit': 'Не более двух мер из одного направления.',
  'errors.incompatible': 'M1 и M3 несовместимы.',
  'errors.count': 'Выберите ровно 5 мероприятий.'
};

function russianIssueMessage(error) {
  if (!error) return null;
  if (error.key === 'errors.districtConflict') return `${error.params.first} и ${error.params.second} нельзя применить в одном районе.`;
  return russianIssueMessages[error.key];
}

export function validateAddition(decisions, id, districtId) {
  return russianIssueMessage(getAdditionIssue(decisions, id, districtId));
}

export function validateScenario(decisions) {
  return russianIssueMessage(getScenarioIssue(decisions));
}

export function calculate(decisions = []) {
  const districts = DISTRICTS.map(district => ({ ...district, values: [...district.values] }));
  for (const decision of decisions) {
    const measure = byMeasure[decision.id];
    if (!measure) continue;
    const targets = measure.scope === 'city' ? districts : districts.filter(district => district.id === decision.districtId);
    for (const target of targets) {
      for (const [code, effect] of Object.entries(measure.effects)) {
        target.values[byCode[code]] += effect * (HORIZON - measure.lag) / HORIZON;
      }
    }
  }
  const has = id => decisions.some(decision => decision.id === id);
  for (const [first, second, code, bonus] of [['M1', 'M2', 'T1', 2], ['M10', 'M12', 'B1', 2], ['M5', 'M6', 'E2', 2]]) {
    if (has(first) && has(second)) {
      const district = districts.find(item => item.id === decisions.find(decision => decision.id === first).districtId);
      if (district) district.values[byCode[code]] += bonus;
    }
  }
  for (const district of districts) {
    district.values = district.values.map(clip);
    district.score = districtScore(district.values);
    district.baselineScore = districtScore(DISTRICTS.find(item => item.id === district.id).values);
  }
  const average = districts.reduce((sum, district) => sum + district.population * district.score, 0);
  const weakest = Math.min(...districts.map(district => district.score));
  const critical = districts.reduce((sum, district) => sum + district.values.filter(value => value < 40).length, 0);
  return { districts, average, weakest, critical, score: .7 * average + .3 * weakest - critical, spent: decisions.reduce((sum, decision) => sum + (byMeasure[decision.id]?.cost || 0), 0) };
}

export const BASELINE = calculate();
