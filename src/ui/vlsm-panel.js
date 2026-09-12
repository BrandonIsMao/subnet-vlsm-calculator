import { formatIPv4, parseIPv4Cidr } from '../core/ipv4.js';
import { planVLSM, prefixForHosts } from '../core/vlsm.js';
import { formatNumber, getLanguage, onLanguageChange, t } from '../i18n/index.js';
import { statItem } from './components.js';
import { copyToClipboard, errorMessage, escapeHtml, flashCopied, setFieldError } from './dom.js';

const SEGMENT_COLORS = 8;
const DEFAULT_BASE = '172.16.0.0/23';

/** Example requirements, deliberately unsorted to show the automatic ordering. */
const EXAMPLE_SUBNETS = [
  { nameKey: 'vlsm.example.sales', hosts: 100 },
  { nameKey: 'vlsm.example.guests', hosts: 50 },
  { nameKey: 'vlsm.example.engineering', hosts: 200 },
  { nameKey: 'vlsm.example.wan', hosts: 2 },
  { nameKey: 'vlsm.example.servers', hosts: 25 },
];

const REMOVE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';

/**
 * @typedef {ReturnType<typeof planVLSM>} Plan
 */

/**
 * @param {Plan} plan
 * @returns {string[][]} Header row followed by one row per allocation.
 */
function planToRows(plan) {
  return [
    [
      t('vlsm.colName'),
      t('vlsm.colNeeded'),
      t('vlsm.colNetwork'),
      t('vlsm.colMask'),
      t('ipv4.firstHost'),
      t('ipv4.lastHost'),
      t('vlsm.colBroadcast'),
      t('vlsm.colAvailable'),
    ],
    ...plan.allocations.map((subnet) => [
      subnet.name,
      String(subnet.requestedHosts),
      `${formatIPv4(subnet.network)}/${subnet.prefix}`,
      formatIPv4(subnet.mask),
      formatIPv4(subnet.firstHost),
      formatIPv4(subnet.lastHost),
      formatIPv4(subnet.broadcast),
      String(subnet.usableHosts),
    ]),
  ];
}

/**
 * @param {string[][]} rows
 */
function toCsv(rows) {
  const escapeCell = (cell) => (/[",\n;]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);
  return rows.map((row) => row.map(escapeCell).join(',')).join('\r\n');
}

/**
 * @param {Plan} plan
 */
function renderAddressMap(plan) {
  const segments = plan.allocations
    .map((subnet, index) => {
      const cidr = `${formatIPv4(subnet.network)}/${subnet.prefix}`;
      const width = (subnet.blockSize / plan.baseSize) * 100;
      return `<span class="address-map__segment segment-color-${index % SEGMENT_COLORS}" style="flex-basis:${width}%" title="${escapeHtml(
        `${subnet.name} · ${cidr}`,
      )}"></span>`;
    })
    .join('');

  const free =
    plan.freeAddresses > 0
      ? `<span class="address-map__segment address-map__segment--free" style="flex-basis:${
          plan.freeAddresses / plan.baseSize * 100
        }%" title="${escapeHtml(`${t('vlsm.mapFree')} · ${formatNumber(plan.freeAddresses)}`)}"></span>`
      : '';

  const first = formatIPv4(plan.baseNetwork);
  const last = formatIPv4(plan.baseNetwork + plan.baseSize - 1);

  return `
    <section class="result__section" aria-labelledby="vlsm-map-title">
      <div class="section-heading">
        <h3 id="vlsm-map-title">${escapeHtml(t('vlsm.mapTitle'))}</h3>
      </div>
      <div class="address-map" role="img" aria-label="${escapeHtml(
        `${t('vlsm.summaryUtilization')}: ${(plan.utilization * 100).toFixed(1)}%`,
      )}">${segments}${free}</div>
      <div class="address-map__scale mono"><span>${first}</span><span>${last}</span></div>
    </section>`;
}

/**
 * @param {Plan} plan
 */
function renderTable(plan) {
  const rows = plan.allocations
    .map((subnet, index) => {
      const network = formatIPv4(subnet.network);
      const unused =
        subnet.unusedHosts > 0 ? `<span class="cell-sub">${escapeHtml(t('vlsm.unused', { count: subnet.unusedHosts }))}</span>` : '';
      return `
        <tr>
          <td data-label="${escapeHtml(t('vlsm.colName'))}">
            <span class="subnet-name"><span class="swatch segment-color-${index % SEGMENT_COLORS}"></span>${escapeHtml(subnet.name)}</span>
          </td>
          <td data-label="${escapeHtml(t('vlsm.colNeeded'))}" class="num">${formatNumber(subnet.requestedHosts)}</td>
          <td data-label="${escapeHtml(t('vlsm.colNetworkMask'))}">
            <span class="cell-stack mono">
              <span>${network}<span class="result__prefix">/${subnet.prefix}</span></span>
              <span class="cell-sub">${formatIPv4(subnet.mask)}</span>
            </span>
          </td>
          <td data-label="${escapeHtml(t('vlsm.colRange'))}" class="mono">${formatIPv4(subnet.firstHost)} – ${formatIPv4(subnet.lastHost)}</td>
          <td data-label="${escapeHtml(t('vlsm.colBroadcast'))}" class="mono">${formatIPv4(subnet.broadcast)}</td>
          <td data-label="${escapeHtml(t('vlsm.colAvailable'))}" class="num">
            <span class="cell-stack cell-stack--end"><span>${formatNumber(subnet.usableHosts)}</span>${unused}</span>
          </td>
        </tr>`;
    })
    .join('');

  return `
    <section class="result__section" aria-labelledby="vlsm-table-title">
      <div class="section-heading">
        <h3 id="vlsm-table-title">${escapeHtml(t('vlsm.tableTitle'))}</h3>
        <div class="button-row">
          <button type="button" class="button button--ghost button--small" data-action="copy-table" data-copy-label>
            ${escapeHtml(t('vlsm.copyTable'))}
          </button>
          <button type="button" class="button button--ghost button--small" data-action="export-csv">
            ${escapeHtml(t('vlsm.exportCsv'))}
          </button>
        </div>
      </div>
      <div class="table-wrap">
        <table class="plan-table">
          <thead>
            <tr>
              <th scope="col">${escapeHtml(t('vlsm.colName'))}</th>
              <th scope="col" class="num">${escapeHtml(t('vlsm.colNeeded'))}</th>
              <th scope="col">${escapeHtml(t('vlsm.colNetworkMask'))}</th>
              <th scope="col">${escapeHtml(t('vlsm.colRange'))}</th>
              <th scope="col">${escapeHtml(t('vlsm.colBroadcast'))}</th>
              <th scope="col" class="num">${escapeHtml(t('vlsm.colAvailable'))}</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>`;
}

/**
 * @param {Plan} plan
 * @param {string} baseInput
 */
function renderPlan(plan, baseInput) {
  const baseCidr = `${formatIPv4(plan.baseNetwork)}/${plan.basePrefix}`;
  const notice = plan.baseWasNormalized
    ? `<p class="notice">${escapeHtml(t('vlsm.normalizedNotice', { input: baseInput.trim(), network: baseCidr }))}</p>`
    : '';

  const freeBlocks = plan.freeBlocks.length
    ? `<ul class="chip-list">${plan.freeBlocks
        .map((block) => {
          const cidr = `${formatIPv4(block.network)}/${block.prefix}`;
          return `<li><button type="button" class="chip mono" data-copy="${cidr}" data-copy-label>${cidr}</button></li>`;
        })
        .join('')}</ul>`
    : `<p class="muted">${escapeHtml(t('vlsm.freeBlocksNone'))}</p>`;

  return `
    <article class="card result">
      ${notice}
      <dl class="stats-grid stats-grid--compact">
        ${statItem({ label: t('vlsm.summaryBase'), value: baseCidr, copy: baseCidr })}
        ${statItem({ label: t('vlsm.summaryAllocated'), value: formatNumber(plan.requiredAddresses), note: escapeHtml(t('common.addresses')) })}
        ${statItem({ label: t('vlsm.summaryFree'), value: formatNumber(plan.freeAddresses), note: escapeHtml(t('common.addresses')) })}
        ${statItem({
          label: t('vlsm.summaryUtilization'),
          value: `${(plan.utilization * 100).toLocaleString(getLanguage(), { maximumFractionDigits: 1 })}%`,
          highlight: true,
        })}
      </dl>
      ${renderAddressMap(plan)}
      ${renderTable(plan)}
      <section class="result__section" aria-labelledby="vlsm-free-title">
        <div class="section-heading"><h3 id="vlsm-free-title">${escapeHtml(t('vlsm.freeBlocksTitle'))}</h3></div>
        ${freeBlocks}
      </section>
    </article>`;
}

export function initVLSMPanel() {
  const form = /** @type {HTMLFormElement} */ (document.getElementById('vlsm-form'));
  const baseInput = /** @type {HTMLInputElement} */ (document.getElementById('vlsm-base'));
  const baseError = /** @type {HTMLElement} */ (document.getElementById('vlsm-base-error'));
  const capacity = /** @type {HTMLElement} */ (document.getElementById('vlsm-capacity'));
  const rowsContainer = /** @type {HTMLElement} */ (document.getElementById('vlsm-rows'));
  const formError = /** @type {HTMLElement} */ (document.getElementById('vlsm-error'));
  const results = /** @type {HTMLElement} */ (document.getElementById('vlsm-results'));

  /** @type {Plan | null} */
  let currentPlan = null;
  let hasCalculated = false;

  const getRows = () => /** @type {HTMLElement[]} */ ([...rowsContainer.querySelectorAll('.req-row')]);

  const updateCapacity = () => {
    try {
      const { prefix } = parseIPv4Cidr(baseInput.value);
      capacity.textContent = t('vlsm.capacity', { count: 2 ** (32 - prefix) });
    } catch {
      capacity.textContent = '';
    }
  };

  /** @param {HTMLElement} row */
  const updatePreview = (row) => {
    const hostsInput = /** @type {HTMLInputElement} */ (row.querySelector('[name="hosts"]'));
    const preview = /** @type {HTMLElement} */ (row.querySelector('.req-row__preview'));
    const value = hostsInput.value.trim();
    const hosts = Number(value);
    preview.textContent =
      /^\d+$/.test(value) && hosts >= 1 && hosts <= 2 ** 32 - 2 ? t('vlsm.needsPrefix', { prefix: prefixForHosts(hosts) }) : '';
  };

  /** Renumbers rows and refreshes their translated labels. */
  const refreshRows = () => {
    getRows().forEach((row, index) => {
      const position = index + 1;
      const nameInput = /** @type {HTMLInputElement} */ (row.querySelector('[name="name"]'));
      const hostsInput = /** @type {HTMLInputElement} */ (row.querySelector('[name="hosts"]'));
      const rowName = nameInput.value.trim() || t('vlsm.rowFallbackName', { position });

      /** @type {HTMLElement} */ (row.querySelector('.req-row__index')).textContent = String(position);
      nameInput.placeholder = t('vlsm.namePlaceholder');
      nameInput.setAttribute('aria-label', `${t('vlsm.nameLabel')} ${position}`);
      hostsInput.setAttribute('aria-label', `${t('vlsm.hostsLabel')} ${position}`);
      row.querySelector('.req-row__remove')?.setAttribute('aria-label', t('vlsm.removeRow', { name: rowName }));
      updatePreview(row);
    });
  };

  const clearRowErrors = () => {
    rowsContainer.querySelectorAll('[aria-invalid="true"]').forEach((input) => input.setAttribute('aria-invalid', 'false'));
  };

  /**
   * @param {{ name?: string, hosts?: string | number }} [values]
   * @returns {HTMLElement}
   */
  const addRow = ({ name = '', hosts = '' } = {}) => {
    const row = document.createElement('div');
    row.className = 'req-row';
    row.innerHTML = `
      <span class="req-row__index" aria-hidden="true"></span>
      <input class="input" name="name" type="text" maxlength="48" autocomplete="off" />
      <input class="input mono" name="hosts" type="text" inputmode="numeric" maxlength="10" autocomplete="off" placeholder="0" />
      <span class="req-row__preview mono" aria-live="polite"></span>
      <button type="button" class="icon-button icon-button--ghost req-row__remove">${REMOVE_ICON}</button>`;

    /** @type {HTMLInputElement} */ (row.querySelector('[name="name"]')).value = name;
    /** @type {HTMLInputElement} */ (row.querySelector('[name="hosts"]')).value = String(hosts);
    rowsContainer.append(row);
    refreshRows();
    return row;
  };

  const loadExample = () => {
    rowsContainer.replaceChildren();
    baseInput.value = DEFAULT_BASE;
    EXAMPLE_SUBNETS.forEach(({ nameKey, hosts }) => addRow({ name: t(nameKey), hosts }));
    updateCapacity();
  };

  /** Points the user at the input responsible for a validation error. */
  const highlightErrorField = (caught) => {
    const code = caught?.code ?? '';
    if (code.startsWith('ipv4.')) {
      setFieldError(baseInput, baseError, errorMessage(caught));
      baseInput.focus();
      return true;
    }

    const row = getRows()[(caught?.params?.position ?? 0) - 1];
    if (row) {
      const field = /** @type {HTMLInputElement} */ (row.querySelector(code === 'vlsm.missingName' ? '[name="name"]' : '[name="hosts"]'));
      field.setAttribute('aria-invalid', 'true');
      field.focus();
    }
    return false;
  };

  const calculate = () => {
    hasCalculated = true;
    setFieldError(baseInput, baseError, null);
    formError.hidden = true;
    clearRowErrors();

    const requirements = getRows().map((row) => ({
      name: /** @type {HTMLInputElement} */ (row.querySelector('[name="name"]')).value,
      hosts: /** @type {HTMLInputElement} */ (row.querySelector('[name="hosts"]')).value,
    }));

    try {
      currentPlan = planVLSM(baseInput.value, requirements);
      results.innerHTML = renderPlan(currentPlan, baseInput.value);
      results.classList.remove('is-stale');
    } catch (caught) {
      currentPlan = null;
      if (!highlightErrorField(caught)) {
        formError.textContent = errorMessage(caught);
        formError.hidden = false;
      }
      results.classList.add('is-stale');
    }
  };

  const exportCsv = () => {
    if (!currentPlan) return;
    // The BOM makes Excel open UTF-8 files (accented names) correctly.
    const blob = new Blob(['\uFEFF', toCsv(planToRows(currentPlan))], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `vlsm-plan-${formatIPv4(currentPlan.baseNetwork)}-${currentPlan.basePrefix}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 0);
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    calculate();
  });

  baseInput.addEventListener('input', () => {
    setFieldError(baseInput, baseError, null);
    updateCapacity();
  });

  rowsContainer.addEventListener('input', (event) => {
    const target = /** @type {HTMLInputElement} */ (event.target);
    target.setAttribute('aria-invalid', 'false');
    const row = /** @type {HTMLElement} */ (target.closest('.req-row'));
    if (target.name === 'hosts') updatePreview(row);
    if (target.name === 'name') refreshRows();
  });

  rowsContainer.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('.req-row__remove') : null;
    if (!button) return;
    const rows = getRows();
    const row = /** @type {HTMLElement} */ (button.closest('.req-row'));
    const index = rows.indexOf(row);

    if (rows.length === 1) {
      row.querySelectorAll('input').forEach((input) => (input.value = ''));
    } else {
      row.remove();
    }
    refreshRows();
    // Keep keyboard focus inside the list after removing a row.
    const next = getRows()[Math.min(index, getRows().length - 1)];
    /** @type {HTMLElement | null} */ (next?.querySelector('.req-row__remove') ?? null)?.focus();
  });

  document.getElementById('vlsm-add')?.addEventListener('click', () => {
    /** @type {HTMLInputElement} */ (addRow().querySelector('[name="name"]')).focus();
  });

  document.getElementById('vlsm-example')?.addEventListener('click', () => {
    loadExample();
    calculate();
  });

  document.getElementById('vlsm-clear')?.addEventListener('click', () => {
    rowsContainer.replaceChildren();
    addRow();
    currentPlan = null;
    results.replaceChildren();
    formError.hidden = true;
    setFieldError(baseInput, baseError, null);
  });

  results.addEventListener('click', async (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-action]') : null;
    if (!(button instanceof HTMLElement) || !currentPlan) return;

    if (button.dataset.action === 'export-csv') exportCsv();
    if (button.dataset.action === 'copy-table') {
      const tsv = planToRows(currentPlan)
        .map((row) => row.join('\t'))
        .join('\n');
      if (await copyToClipboard(tsv)) flashCopied(button);
    }
  });

  onLanguageChange(() => {
    refreshRows();
    updateCapacity();
    if (hasCalculated) calculate();
  });

  loadExample();
  calculate();
}
