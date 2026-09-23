import test from 'node:test';
import assert from 'node:assert/strict';
import { BASELINE, calculate, validateAddition, validateScenario } from './model.js';

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
