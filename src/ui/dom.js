import { t } from '../i18n/index.js';

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/**
 * Escapes a value for safe interpolation into HTML templates.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]);
}

/**
 * @template {(...args: any[]) => void} T
 * @param {T} fn
 * @param {number} delay
 * @returns {T}
 */
export function debounce(fn, delay) {
  let timer;
  return /** @type {T} */ ((...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  });
}

/**
 * Translates an error thrown by the core modules into a user-facing message.
 *
 * @param {unknown} error
 * @returns {string}
 */
export function errorMessage(error) {
  if (error && typeof error === 'object' && 'name' in error && error.name === 'ValidationError') {
    return t(/** @type {any} */ (error).code, /** @type {any} */ (error).params);
  }
  console.error(error);
  return t('error.unexpected');
}

/**
 * Shows (or clears) an inline error message tied to an input.
 *
 * @param {HTMLInputElement} input
 * @param {HTMLElement} messageElement
 * @param {string | null} message
 */
export function setFieldError(input, messageElement, message) {
  input.setAttribute('aria-invalid', message ? 'true' : 'false');
  messageElement.textContent = message ?? '';
  messageElement.hidden = !message;
}

const COPY_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>';
const CHECK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

/**
 * @param {string} text Value copied to the clipboard.
 * @returns {string} Markup for an icon button wired up by `setupCopyButtons`.
 */
export function copyButton(text) {
  const label = t('common.copy');
  return `<button type="button" class="copy-button" data-copy="${escapeHtml(text)}" aria-label="${escapeHtml(
    `${label}: ${text}`,
  )}" title="${escapeHtml(label)}">${COPY_ICON}</button>`;
}

/**
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for insecure contexts where the async Clipboard API is unavailable.
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    return copied;
  }
}

/**
 * Temporarily switches a button into a "copied" state.
 *
 * @param {HTMLElement} button
 */
export function flashCopied(button) {
  const original = button.innerHTML;
  const hasText = button.dataset.copyLabel !== undefined;
  button.classList.add('is-copied');
  button.innerHTML = hasText ? `${CHECK_ICON}<span>${escapeHtml(t('common.copied'))}</span>` : CHECK_ICON;
  setTimeout(() => {
    button.classList.remove('is-copied');
    button.innerHTML = original;
  }, 1400);
}

/**
 * @param {string[][]} rows
 * @returns {string} RFC 4180 CSV.
 */
function toCsv(rows) {
  const escapeCell = (cell) => (/[",\n;]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);
  return rows.map((row) => row.map(escapeCell).join(',')).join('\r\n');
}

/**
 * Downloads a table as a CSV file.
 *
 * @param {string} filename
 * @param {string[][]} rows
 */
export function downloadCsv(filename, rows) {
  // The BOM makes Excel open UTF-8 files (accented names) correctly.
  const blob = new Blob(['\uFEFF', toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

/**
 * @param {string[][]} rows
 * @returns {string} Tab-separated text that pastes into spreadsheets as a table.
 */
export function toTsv(rows) {
  return rows.map((row) => row.join('\t')).join('\n');
}

/**
 * Delegated click handler for every `[data-copy]` button on the page.
 */
export function setupCopyButtons() {
  document.addEventListener('click', async (event) => {
    const button = /** @type {HTMLElement | null} */ (
      event.target instanceof Element ? event.target.closest('[data-copy]') : null
    );
    if (!button || button.classList.contains('is-copied')) return;
    if (await copyToClipboard(button.dataset.copy ?? '')) flashCopied(button);
  });
}
