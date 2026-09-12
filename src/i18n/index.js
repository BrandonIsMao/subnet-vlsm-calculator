import en from './locales/en.js';
import es from './locales/es.js';

const LOCALES = { en, es };
const STORAGE_KEY = 'svc.language';
const DEFAULT_LANGUAGE = 'en';

const listeners = new Set();
let currentLanguage = DEFAULT_LANGUAGE;

function readStoredLanguage() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function detectLanguage() {
  const stored = readStoredLanguage();
  if (stored && stored in LOCALES) return stored;
  const browserLanguage = (navigator.language || '').slice(0, 2).toLowerCase();
  return browserLanguage in LOCALES ? browserLanguage : DEFAULT_LANGUAGE;
}

/**
 * Translates a key, interpolating `{placeholders}` with `params`.
 * Falls back to English, then to the key itself.
 *
 * @param {string} key
 * @param {Record<string, string | number>} [params]
 */
export function t(key, params = {}) {
  const template = LOCALES[currentLanguage][key] ?? LOCALES[DEFAULT_LANGUAGE][key] ?? key;
  return template.replace(/\{(\w+)\}/g, (match, name) => {
    const value = params[name];
    if (value === undefined) return match;
    return typeof value === 'number' ? formatNumber(value) : String(value);
  });
}

/** @returns {string} */
export function getLanguage() {
  return currentLanguage;
}

/**
 * @param {number | bigint} value
 * @returns {string} Locale-aware number with digit grouping.
 */
export function formatNumber(value) {
  return value.toLocaleString(currentLanguage === 'es' ? 'es-CO' : 'en-US');
}

/**
 * Applies translations to every element carrying `data-i18n*` attributes.
 *
 * @param {ParentNode} [root]
 */
export function translateDocument(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
    element.setAttribute('placeholder', t(element.dataset.i18nPlaceholder));
  });
  root.querySelectorAll('[data-i18n-aria-label]').forEach((element) => {
    element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel));
  });
  root.querySelectorAll('[data-i18n-title]').forEach((element) => {
    element.setAttribute('title', t(element.dataset.i18nTitle));
  });
}

/**
 * @param {string} language
 */
export function setLanguage(language) {
  if (!(language in LOCALES)) return;
  currentLanguage = language;

  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Storage can be unavailable (private mode); the choice simply won't persist.
  }

  document.documentElement.lang = language;
  document.title = t('meta.title');
  translateDocument();
  listeners.forEach((listener) => listener(language));
}

/**
 * @param {(language: string) => void} listener
 */
export function onLanguageChange(listener) {
  listeners.add(listener);
}

export function initI18n() {
  setLanguage(detectLanguage());
}
