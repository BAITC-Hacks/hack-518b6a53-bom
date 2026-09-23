import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MEASURES, configureCatalog, validateScenario } from './model.js';
import {
  OBJECT_DISTRICTS,
  MAP_LABEL_BOUNDS,
  createObjectSlots,
  layoutMapObjects,
  objectBounds,
  validFootprint
} from './map-objects.js';

const source = Object.fromEntries(await Promise.all(['districts', 'measures', 'rules', 'presets'].map(async name => [name, JSON.parse(await readFile(new URL(`../data/tech2-v1/${name}.json`, import.meta.url), 'utf8'))])));
const { model_version, ...rules } = source.rules;
configureCatalog({ model_version, rules, districts: source.districts.districts, measures: source.measures.measures, presets: source.presets.presets });

const districtIds = OBJECT_DISTRICTS.map(district => district.id);
const cityScenario = [{ id: 'M2' }, { id: 'M6' }, { id: 'M12' }, { id: 'M14' }];

function assertSeparated(a, b, description) {
  assert.ok(
    a.right + 4 <= b.left || b.right + 4 <= a.left ||
    a.bottom + 4 <= b.top || b.bottom + 4 <= a.top,
    `${description}: bounds must retain at least four map units of space`
  );
}

function assertSafeLayout(objects) {
  for (const [index, object] of objects.entries()) {
    const name = object.key ?? `${object.districtId}:${object.slot}`;
    const district = OBJECT_DISTRICTS.find(item => item.id === object.districtId);
    assert.ok(district, `${name}: district exists`);
    assert.ok(validFootprint(object, district), `${name}: base stays on dry land inside its district`);
    const bounds = objectBounds(object);
    for (const [labelIndex, label] of MAP_LABEL_BOUNDS.entries()) {
      assertSeparated(bounds, label, `${name} and label ${labelIndex}`);
    }
    for (const other of objects.slice(index + 1)) {
      assertSeparated(bounds, objectBounds(other), `${name} and ${other.key ?? `${other.districtId}:${other.slot}`}`);
    }
  }
}

function positionsByKey(objects) {
  return Object.fromEntries(objects.map(({ key, x, y, scale, slot, districtId }) => [key, { x, y, scale, slot, districtId }]));
}

function assertRetainedPositions(previous, next, ignoreSaryarka = false) {
  const before = positionsByKey(previous);
  for (const [key, position] of Object.entries(positionsByKey(next))) {
    if (ignoreSaryarka && position.districtId === 'saryarka') continue;
    if (before[key]) {
      const { scale: oldScale, ...oldAnchor } = before[key];
      const { scale: newScale, ...newAnchor } = position;
      assert.deepEqual(newAnchor, oldAnchor, `${key}: existing object anchor must not move`);
    }
  }
}

test('25 reserved positions cover all five districts without covering objects, labels, or water', () => {
  const reserved = createObjectSlots();
  assert.deepEqual(Object.keys(reserved).sort(), [...districtIds].sort());
  assert.equal(Object.values(reserved).flat().length, 25);
  for (const districtId of districtIds) {
    assert.equal(reserved[districtId].length, 5, `${districtId}: five positions available`);
    assert.equal(new Set(reserved[districtId].map(position => position.slot)).size, 5);
    assert.ok(reserved[districtId].every(position => position.districtId === districtId));
  }
  assertSafeLayout(Object.values(reserved).flat());
  assert.deepEqual(createObjectSlots(), reserved, 'identical geometry must produce deterministic positions');
});

test('each of the 14 measures creates objects only in the districts covered by its scope', () => {
  assert.equal(MEASURES.length, 14);
  for (const measure of MEASURES) {
    for (const target of districtIds) {
      const decisions = [{ id: measure.id, ...(measure.scope === 'district' ? { districtId: target } : {}) }];
      const objects = layoutMapObjects(decisions);
      const expectedDistricts = measure.scope === 'city' ? districtIds : [target];
      assert.deepEqual(objects.map(object => object.districtId).sort(), [...expectedDistricts].sort(), measure.id);
      assert.equal(new Set(objects.map(object => object.key)).size, expectedDistricts.length);
      assert.ok(objects.every(object => object.measureId === measure.id));
      assertSafeLayout(objects);
    }
  }
});

test('the legal scenario with four city measures and one district measure displays all 21 objects', () => {
  for (const districtId of districtIds) {
    const decisions = [...cityScenario, { id: 'M9', districtId }];
    assert.equal(validateScenario(decisions), null);
    const objects = layoutMapObjects(decisions);
    assert.equal(objects.length, 21);
    assert.equal(objects.filter(object => object.districtId === districtId).length, 5);
    assertSafeLayout(objects);
  }
});

test('five compatible district measures fit together in every district, including narrow Saryarka', () => {
  for (const districtId of districtIds) {
    const decisions = ['M1', 'M5', 'M8', 'M10', 'M11'].map(id => ({ id, districtId }));
    assert.equal(validateScenario(decisions), null);
    const objects = layoutMapObjects(decisions);
    assert.equal(objects.length, 5);
    assert.ok(objects.every(object => object.districtId === districtId));
    assertSafeLayout(objects);
  }
});

test('adding and removing preserve other district anchors while Saryarka adapts; redraws remain identical', () => {
  let decisions = [];
  let objects = [];
  const fullScenario = [...cityScenario, { id: 'M9', districtId: 'saryarka' }];
  for (const decision of fullScenario) {
    decisions = [...decisions, decision];
    const snapshot = structuredClone(objects);
    const next = layoutMapObjects(decisions, objects);
    assert.deepEqual(objects, snapshot, 'layout must not mutate the previous layout');
    assertRetainedPositions(objects, next, true);
    assertSafeLayout(next);
    objects = next;
  }

  // Focusing and unfocusing a district redraws the same scenario.
  assert.deepEqual(layoutMapObjects(decisions, objects), objects);

  decisions = decisions.filter(decision => decision.id !== 'M6');
  const reduced = layoutMapObjects(decisions, objects);
  assert.equal(reduced.length, 16);
  assert.ok(reduced.every(object => object.measureId !== 'M6'));
  assertRetainedPositions(objects, reduced, true);
  assertSafeLayout(reduced);

  const restored = layoutMapObjects(fullScenario, reduced);
  assertRetainedPositions(reduced, restored, true);
  assert.equal(restored.length, 21);
  assertSafeLayout(restored);
  assert.deepEqual(layoutMapObjects([], restored), [], 'reset must remove every object');
  assert.deepEqual(layoutMapObjects([], []), [], 'an empty scenario must remain empty');
});

test('sparse scenarios enlarge map objects while every density stays clear of neighboring districts', () => {
  for (let count = 1; count <= 4; count++) {
    const decisions = cityScenario.slice(0, count);
    const objects = layoutMapObjects(decisions);
    assert.equal(objects.length, count * 5);
    assertSafeLayout(objects);
    assert.deepEqual(layoutMapObjects(decisions, objects), objects, 'redraw must not change sizes or anchors');
    if (count <= 2) {
      for (const districtId of districtIds) {
        assert.ok(objects.some(object => object.districtId === districtId && object.scale >= 1), `${districtId}: sparse scenarios have a prominent object`);
      }
    }
    assert.ok(objects.filter(object => object.districtId === 'saryarka').every(object => object.scale >= (count <= 2 ? 1.15 : .65)));
  }
});

test('every order of adding the busiest legal scenario remains safe and stable when redrawn', () => {
  const scenario = [...cityScenario, { id: 'M9', districtId: 'saryarka' }];
  const permutations = items => items.length <= 1 ? [items] : items.flatMap((item, index) =>
    permutations(items.filter((_, otherIndex) => otherIndex !== index)).map(rest => [item, ...rest]));
  for (const order of permutations(scenario)) {
    let objects = [];
    for (let count = 1; count <= order.length; count++) {
      const decisions = order.slice(0, count);
      const snapshot = structuredClone(objects);
      const next = layoutMapObjects(decisions, objects);
      assert.deepEqual(objects, snapshot, 'layout does not mutate previous objects');
      assertRetainedPositions(objects, next, true);
      assertSafeLayout(next);
      assert.deepEqual(layoutMapObjects(decisions, next), next, 'focus/language redraw does not change sizes or positions');
      assert.deepEqual(layoutMapObjects([...decisions].reverse(), next), next, 'retained decisions keep their layout after input reorder');
      objects = next;
    }
  }
});
