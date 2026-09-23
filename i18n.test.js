import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { translations } from './locales.js';
import {
  SUPPORTED_LANGUAGES, LANGUAGE_STORAGE_KEY, normalizeLanguage,
  setLanguage, getLanguage, loadLanguage, saveLanguage, translate, formatNumber,
  groupName, measureName, districtName, indicatorName, indicatorDescription
} from './i18n.js';
import { MEASURES, DISTRICTS, INDICATORS, calculate, getAdditionIssue, getScenarioIssue } from './model.js';

function leaves(dictionary, prefix = '') {
  return Object.entries(dictionary).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value && typeof value === 'object' ? leaves(value, path) : [[path, value]];
  });
}
const placeholders = value => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
const sortKeys = value => Object.keys(value).sort();

test('all three locales have complete, nonempty translations and matching interpolation parameters', () => {
  assert.equal(getLanguage(), 'ru');
  assert.deepEqual(SUPPORTED_LANGUAGES, ['ru', 'kk', 'en']);
  assert.deepEqual(sortKeys(translations), [...SUPPORTED_LANGUAGES].sort());
  const reference = Object.fromEntries(leaves(translations.ru));
  for (const language of SUPPORTED_LANGUAGES) {
    const entries = Object.fromEntries(leaves(translations[language]));
    assert.deepEqual(sortKeys(entries), sortKeys(reference), `${language}: missing or extra translation keys`);
    for (const [key, value] of Object.entries(entries)) {
      assert.equal(typeof value, 'string', `${language}.${key}`);
      assert.ok(value.trim(), `${language}.${key} is empty`);
      assert.deepEqual(placeholders(value), placeholders(reference[key]), `${language}.${key} parameters`);
      const params = Object.fromEntries(placeholders(value).map(name => [name, `sample_${name}`]));
      const result = translate(key, params, language);
      assert.notEqual(result, key, `${language}.${key} leaked its key`);
      assert.doesNotMatch(result, /\{\w+\}/, `${language}.${key} leaked a placeholder`);
      for (const replacement of Object.values(params)) assert.ok(result.includes(replacement), `${language}.${key} lost a parameter`);
    }
  }
});

test('every measure, district, indicator and category resolves by stable model identifiers', t => {
  t.after(() => setLanguage('ru'));
  assert.equal(MEASURES.length, 14);
  assert.equal(DISTRICTS.length, 5);
  assert.equal(INDICATORS.length, 10);
  for (const language of SUPPORTED_LANGUAGES) {
    setLanguage(language);
    const dictionary = translations[language];
    assert.deepEqual(sortKeys(dictionary.measures), MEASURES.map(item => item.id).sort());
    assert.deepEqual(sortKeys(dictionary.districts), DISTRICTS.map(item => item.id).sort());
    assert.deepEqual(sortKeys(dictionary.indicators), INDICATORS.map(item => item.code).sort());
    for (const measure of MEASURES) assert.equal(measureName(measure.id), dictionary.measures[measure.id]);
    for (const district of DISTRICTS) assert.equal(districtName(district.id), dictionary.districts[district.id]);
    for (const indicator of INDICATORS) {
      assert.equal(indicatorName(indicator.code), dictionary.indicators[indicator.code].name);
      assert.equal(indicatorDescription(indicator.code), dictionary.indicators[indicator.code].description);
    }
    const categories = ['Все', ...new Set(MEASURES.map(item => item.group))];
    assert.equal(categories.length, 6);
    assert.deepEqual(categories.map(groupName).sort(), Object.values(dictionary.groups).sort());
  }
});

test('all coded model validation failures translate in each language without leaking keys or placeholders', () => {
  const sample = [
    { id: 'M7', districtId: 'nura' }, { id: 'M8', districtId: 'nura' },
    { id: 'M10', districtId: 'nura' }, { id: 'M12' }, { id: 'M5', districtId: 'saryarka' }
  ];
  const issues = [
    getAdditionIssue([], 'unknown'),
    getAdditionIssue(sample, 'M7', 'nura'),
    getAdditionIssue(sample, 'M14'),
    getAdditionIssue([], 'M7'),
    getAdditionIssue([], 'M2', 'nura'),
    getAdditionIssue(sample.filter(item => item.id !== 'M10'), 'M3', 'esil'),
    getAdditionIssue(sample.slice(0, 2), 'M9', 'esil'),
    getAdditionIssue([{ id: 'M1', districtId: 'nura' }], 'M3', 'esil'),
    getAdditionIssue([{ id: 'M4', districtId: 'nura' }], 'M7', 'nura'),
    getAdditionIssue([{ id: 'M5', districtId: 'nura' }], 'M13', 'nura'),
    getScenarioIssue([])
  ];
  assert.ok(issues.every(Boolean));
  assert.deepEqual([...new Set(issues.map(item => item.key))].sort(), sortKeys(translations.ru.errors).map(key => `errors.${key}`).sort());
  for (const language of SUPPORTED_LANGUAGES) {
    for (const issue of issues) {
      const message = translate(issue.key, issue.params, language);
      assert.ok(message.trim());
      assert.doesNotMatch(message, /errors\.|\{\w+\}/);
      for (const value of Object.values(issue.params)) assert.ok(message.includes(value));
    }
  }
});

test('number formatting uses locale separators, fixed precision and preserves displayed numeric values', t => {
  t.after(() => setLanguage('ru'));
  for (const language of SUPPORTED_LANGUAGES) {
    setLanguage(language);
    const separator = language === 'en' ? '.' : ',';
    assert.equal(formatNumber(52.5), `52${separator}50`);
    assert.equal(formatNumber(25.125, 3), `25${separator}125`);
    assert.equal(formatNumber(100, 0), '100');
    for (const value of [0, -2.5, 52.56, 1000.5]) {
      const formatted = formatNumber(value, 2);
      assert.equal(formatted.split(separator)[1].length, 2);
      assert.equal(Number(formatted.replace(separator, '.')), value);
    }
  }
  assert.equal(formatNumber(2.5, 2, 'en'), '2.50');
  assert.equal(formatNumber(2.5, 2, 'unsupported'), '2,50');
});

test('Russian is the default and unsupported stored language values fall back safely', t => {
  t.after(() => setLanguage('ru'));
  for (const value of [undefined, null, '', 'de', 'EN', 'en-US', 1, {}]) {
    assert.equal(normalizeLanguage(value), 'ru');
    assert.equal(loadLanguage({ getItem: () => value }), 'ru');
    setLanguage(value);
    assert.equal(getLanguage(), 'ru');
  }
  for (const value of SUPPORTED_LANGUAGES) {
    assert.equal(normalizeLanguage(value), value);
    setLanguage(value);
    assert.equal(getLanguage(), value);
    assert.equal(loadLanguage({ getItem: () => value }), value);
  }
});

test('language persistence uses its own storage key and tolerates denied storage access', t => {
  assert.equal(LANGUAGE_STORAGE_KEY, 'astana.language');
  const values = new Map();
  const calls = [];
  const storage = {
    getItem(key) { calls.push(['get', key]); return values.get(key) ?? null; },
    setItem(key, value) { calls.push(['set', key, value]); values.set(key, value); }
  };
  saveLanguage('kk', storage);
  assert.equal(loadLanguage(storage), 'kk');
  assert.deepEqual(calls, [['set', 'astana.language', 'kk'], ['get', 'astana.language']]);
  saveLanguage('unsupported', storage);
  assert.equal(values.get('astana.language'), 'ru');
  const blocked = {
    getItem() { throw new Error('Storage denied'); },
    setItem() { throw new Error('Storage denied'); }
  };
  assert.equal(loadLanguage(blocked), 'ru');
  assert.doesNotThrow(() => saveLanguage('en', blocked));
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Storage denied'); } });
  assert.equal(loadLanguage(), 'ru');
  assert.doesNotThrow(() => saveLanguage('kk'));
});

test('switching the language does not alter model data, the scenario or any calculated result', t => {
  t.after(() => setLanguage('ru'));
  const decisions = [
    { id: 'M7', districtId: 'nura' }, { id: 'M8', districtId: 'nura' },
    { id: 'M10', districtId: 'nura' }, { id: 'M12' }, { id: 'M5', districtId: 'saryarka' }
  ];
  const before = structuredClone({ MEASURES, DISTRICTS, INDICATORS, decisions });
  const calculated = calculate(decisions);
  const baseline = calculate();
  for (const language of ['kk', 'en', 'ru']) {
    setLanguage(language);
    MEASURES.forEach(item => { measureName(item.id); groupName(item.group); });
    DISTRICTS.forEach(item => districtName(item.id));
    INDICATORS.forEach(item => { indicatorName(item.code); indicatorDescription(item.code); });
    formatNumber(calculated.score);
    assert.deepEqual({ MEASURES, DISTRICTS, INDICATORS, decisions }, before);
    assert.deepEqual(calculate(decisions), calculated);
    assert.deepEqual(calculate(), baseline);
  }
});

test('HTML and CSS do not load external fonts or import remote stylesheets', async () => {
  for (const filename of ['index.html', 'styles.css']) {
    const source = await readFile(new URL(filename, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /fonts\.(?:googleapis|gstatic)\.com|use\.typekit\.net/i, filename);
    assert.doesNotMatch(source, /@import\s+(?:url\(\s*)?["']?(?:https?:)?\/\//i, filename);
    for (const fontFace of source.matchAll(/@font-face\s*\{[^}]*\}/gi)) {
      assert.doesNotMatch(fontFace[0], /url\(\s*["']?(?:https?:)?\/\//i, filename);
    }
    for (const tag of source.matchAll(/<link\b[^>]*>/gi)) {
      if (/\bas\s*=\s*["']font["']/i.test(tag[0])) assert.doesNotMatch(tag[0], /\bhref\s*=\s*["'](?:https?:)?\/\//i, filename);
    }
  }
});
