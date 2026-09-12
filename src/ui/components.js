import { copyButton, escapeHtml } from './dom.js';

/**
 * Renders a labelled value for a `<dl class="stats-grid">`.
 *
 * `value` is inserted as trusted HTML (callers build it from computed data or
 * escape it); `copy` is the plain-text value placed on the clipboard.
 *
 * @param {object} options
 * @param {string} options.label
 * @param {string} options.value
 * @param {string} [options.copy]
 * @param {string} [options.note]  Secondary line under the value (trusted HTML).
 * @param {boolean} [options.mono=true]
 * @param {boolean} [options.wide=false] Span the full grid width.
 * @param {boolean} [options.highlight=false]
 */
export function statItem({ label, value, copy, note, mono = true, wide = false, highlight = false }) {
  const classes = ['stat', wide && 'stat--wide', highlight && 'stat--highlight'].filter(Boolean).join(' ');
  return `
    <div class="${classes}">
      <dt class="stat__label">${escapeHtml(label)}</dt>
      <dd class="stat__value">
        <span class="${mono ? 'mono' : ''}">${value}</span>
        ${copy === undefined ? '' : copyButton(copy)}
      </dd>
      ${note ? `<dd class="stat__note">${note}</dd>` : ''}
    </div>`;
}

/**
 * @param {string} text
 * @param {'neutral' | 'accent'} [tone]
 */
export function badge(text, tone = 'neutral') {
  return `<span class="badge badge--${tone}">${escapeHtml(text)}</span>`;
}
