import { translations } from './locales.js';

export const SUPPORTED_LANGUAGES = ['ru', 'kk', 'en'];
export const LANGUAGE_STORAGE_KEY = 'astana.language';
const locales = { ru: 'ru-RU', kk: 'kk-KZ', en: 'en-US' };
const groups = { 'Все': 'all', 'Транспорт': 'transport', 'Экология': 'ecology', 'Соцсфера': 'social', 'Безопасность': 'security', 'Сервисы': 'services' };
let language = 'ru';

export function normalizeLanguage(value) {
  return SUPPORTED_LANGUAGES.includes(value) ? value : 'ru';
}
export function setLanguage(value) { language = normalizeLanguage(value); }
export function getLanguage() { return language; }

export function loadLanguage(storage) {
  try { return normalizeLanguage((storage ?? globalThis.localStorage)?.getItem(LANGUAGE_STORAGE_KEY)); }
  catch { return 'ru'; }
}
export function saveLanguage(value, storage) {
  try { (storage ?? globalThis.localStorage)?.setItem(LANGUAGE_STORAGE_KEY, normalizeLanguage(value)); }
  catch { /* Language switching still works when storage is unavailable. */ }
}

const lookup = (dictionary, key) => key.split('.').reduce((value, part) => value?.[part], dictionary);
export function translate(key, params = {}, locale = language) {
  const template = lookup(translations[normalizeLanguage(locale)], key) ?? lookup(translations.ru, key);
  if (typeof template !== 'string') return key;
  return template.replace(/\{(\w+)\}/g, (match, name) => params[name] === undefined ? match : String(params[name]));
}
export function formatNumber(value, digits = 2, locale = language) {
  return new Intl.NumberFormat(locales[normalizeLanguage(locale)], {
    minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false
  }).format(value);
}
export const groupName = group => translate(`groups.${groups[group]}`);
export const measureName = id => translate(`measures.${id}`);
export const districtName = id => translate(`districts.${id}`);
export const indicatorName = code => translate(`indicators.${code}.name`);
export const indicatorDescription = code => translate(`indicators.${code}.description`);
