import { formatIPv4 } from '../core/ipv4.js';
import { formatIPv6, formatIPv6Mixed, parseIPv6Cidr } from '../core/ipv6.js';
import { NAT64_WELL_KNOWN_PREFIX, parseSubnetList, planDualStack, translateIPv4 } from '../core/migration.js';
import { formatNumber, onLanguageChange, t } from '../i18n/index.js';
import { badge, statItem } from './components.js';
import { copyButton, copyToClipboard, debounce, downloadCsv, errorMessage, escapeHtml, flashCopied, setFieldError, toTsv } from './dom.js';
import { VLSM_MIGRATE_EVENT, VLSM_PLAN_EVENT } from './vlsm-panel.js';

const DEFAULT_IPV4 = '192.0.2.33/24';
const DEFAULT_SITE_PREFIX = '2001:db8:acad::/48';

const EXAMPLE_SUBNETS = [
  ['vlsm.example.engineering', '172.16.0.0/24'],
  ['vlsm.example.sales', '172.16.1.0/25'],
  ['vlsm.example.guests', '172.16.1.128/26'],
  ['vlsm.example.servers', '172.16.1.192/27'],
  ['vlsm.example.wan', '172.16.1.224/30'],
];

const STATUS_TONES = { current: 'accent', deprecated: 'warning', legacy: 'neutral' };

/**
 * @typedef {ReturnType<typeof translateIPv4>} TranslationResult
 * @typedef {ReturnType<typeof planDualStack>} DualStackPlan
 */

/**
 * @param {string} label
 * @param {string} value
 * @param {{ muted?: boolean }} [options]
 */
function valueLine(label, value, { muted = false } = {}) {
  return `
    <div class="method__value${muted ? ' method__value--muted' : ''}">
      <span class="method__value-label">${escapeHtml(label)}</span>
      <span class="mono">${escapeHtml(value)}</span>
      ${copyButton(value)}
    </div>`;
}

/**
 * @param {TranslationResult['translations'][number]} translation
 */
function renderTranslation(translation) {
  const lines = [];

  if (translation.address !== null) {
    const compressed = formatIPv6(translation.address);
    if (translation.mixedNotation) {
      lines.push(valueLine(t('migration.addressRow'), formatIPv6Mixed(translation.address)));
      lines.push(valueLine(t('migration.hexRow'), compressed, { muted: true }));
    } else {
      lines.push(valueLine(t('migration.addressRow'), compressed));
    }
  }
  if (translation.network) {
    lines.push(valueLine(t('migration.networkRow'), `${formatIPv6(translation.network.address)}/${translation.network.prefix}`));
  }

  const warning = translation.warning
    ? `<p class="method__warning" role="note">${escapeHtml(t(translation.warning))}</p>`
    : '';

  return `
    <li class="method">
      <div class="method__info">
        <div class="method__title">
          <h3>${escapeHtml(t(`migration.method.${translation.id}`))}</h3>
          ${badge(t(`migration.status.${translation.status}`), /** @type {any} */ (STATUS_TONES[translation.status]))}
          <span class="method__standard">${escapeHtml(translation.standard)}</span>
        </div>
        <p class="method__description">${escapeHtml(t(`migration.methodDesc.${translation.id}`))}</p>
        ${warning}
      </div>
      <div class="method__values">${lines.join('')}</div>
    </li>`;
}

/**
 * @param {TranslationResult} result
 */
function renderTranslationResult(result) {
  const title = `${formatIPv4(result.address)}${result.isNetwork ? `<span class="result__prefix">/${result.prefix}</span>` : ''}`;
  const hex = `0x${result.address.toString(16).padStart(8, '0')}`;

  return `
    <article class="card result">
      <header class="result__header">
        <div class="result__heading">
          <p class="result__kicker">${escapeHtml(t(result.isNetwork ? 'migration.sourceNetwork' : 'migration.sourceAddress'))}</p>
          <h2 class="result__title mono">${title}</h2>
        </div>
        <div class="badges">
          ${badge(t(`scope.${result.scope}`), 'accent')}
          <span class="badge badge--neutral mono">${hex}</span>
        </div>
      </header>
      <ul class="method-list">${result.translations.map(renderTranslation).join('')}</ul>
    </article>`;
}

/**
 * @param {DualStackPlan} plan
 */
function subnetIdLabel(plan, subnetId) {
  if (plan.subnetIdBits === 0) return '—';
  return subnetId.toString(16).padStart(Math.min(Math.ceil(plan.subnetIdBits / 4), 16), '0');
}

/**
 * @param {DualStackPlan} plan
 * @returns {string[][]}
 */
function planToRows(plan) {
  return [
    [
      t('migration.colName'),
      t('migration.colIPv4'),
      t('migration.colIPv6'),
      t('migration.colSubnetId'),
      t('migration.colGatewayV4'),
      t('migration.colGatewayV6'),
    ],
    ...plan.allocations.map((subnet) => [
      subnet.name,
      `${formatIPv4(subnet.ipv4Network)}/${subnet.ipv4Prefix}`,
      `${formatIPv6(subnet.ipv6Network)}/${subnet.ipv6Prefix}`,
      subnetIdLabel(plan, subnet.subnetId),
      formatIPv4(subnet.ipv4Gateway),
      formatIPv6(subnet.ipv6Gateway),
    ]),
  ];
}

/**
 * @param {DualStackPlan} plan
 * @param {string | null} notice
 */
function renderPlan(plan, notice) {
  const sitePrefix = `${formatIPv6(plan.sitePrefix)}/${plan.prefix}`;

  const rows = plan.allocations
    .map((subnet) => {
      const ipv4 = `${formatIPv4(subnet.ipv4Network)}/${subnet.ipv4Prefix}`;
      const ipv6 = formatIPv6(subnet.ipv6Network);
      return `
        <tr>
          <td data-label="${escapeHtml(t('migration.colName'))}"><span class="subnet-name">${escapeHtml(subnet.name)}</span></td>
          <td data-label="${escapeHtml(t('migration.colIPv4'))}" class="mono">${ipv4}</td>
          <td data-label="${escapeHtml(t('migration.colIPv6'))}" class="mono">${ipv6}<span class="result__prefix">/${subnet.ipv6Prefix}</span></td>
          <td data-label="${escapeHtml(t('migration.colSubnetId'))}" class="mono">${subnetIdLabel(plan, subnet.subnetId)}</td>
          <td data-label="${escapeHtml(t('migration.colGateways'))}">
            <span class="cell-stack cell-stack--end-mobile mono">
              <span>${formatIPv4(subnet.ipv4Gateway)}</span>
              <span class="cell-sub">${formatIPv6(subnet.ipv6Gateway)}</span>
            </span>
          </td>
        </tr>`;
    })
    .join('');

  return `
    <article class="card result">
      ${notice ? `<p class="notice notice--info">${escapeHtml(notice)}</p>` : ''}
      <dl class="stats-grid stats-grid--compact">
        ${statItem({ label: t('migration.summarySite'), value: sitePrefix, copy: sitePrefix })}
        ${statItem({
          label: t('migration.summarySubnets'),
          value: formatNumber(plan.allocations.length),
          note: escapeHtml(t('migration.summaryOf', { total: formatNumber(plan.capacity) })),
          highlight: true,
        })}
        ${statItem({ label: t('migration.summaryStrategy'), value: escapeHtml(t(`migration.strategy.${plan.strategy}`)), mono: false })}
      </dl>
      <section class="result__section" aria-labelledby="migration-table-title">
        <div class="section-heading">
          <h3 id="migration-table-title">${escapeHtml(t('migration.planTableTitle'))}</h3>
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
                <th scope="col">${escapeHtml(t('migration.colName'))}</th>
                <th scope="col">${escapeHtml(t('migration.colIPv4'))}</th>
                <th scope="col">${escapeHtml(t('migration.colIPv6'))}</th>
                <th scope="col">${escapeHtml(t('migration.colSubnetId'))}</th>
                <th scope="col">${escapeHtml(t('migration.colGateways'))}</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </section>
    </article>`;
}

function initTranslation() {
  const ipv4Input = /** @type {HTMLInputElement} */ (document.getElementById('migration-ipv4'));
  const ipv4Error = /** @type {HTMLElement} */ (document.getElementById('migration-ipv4-error'));
  const nat64Input = /** @type {HTMLInputElement} */ (document.getElementById('migration-nat64'));
  const nat64Error = /** @type {HTMLElement} */ (document.getElementById('migration-nat64-error'));
  const results = /** @type {HTMLElement} */ (document.getElementById('migration-translate-results'));
  const form = /** @type {HTMLFormElement} */ (document.getElementById('migration-translate-form'));

  const update = () => {
    setFieldError(ipv4Input, ipv4Error, null);
    setFieldError(nat64Input, nat64Error, null);
    try {
      const result = translateIPv4(ipv4Input.value, { nat64Prefix: nat64Input.value || NAT64_WELL_KNOWN_PREFIX });
      results.innerHTML = renderTranslationResult(result);
      results.classList.remove('is-stale');
    } catch (caught) {
      const isNat64Error = /^(ipv6|migration)\./.test(caught?.code ?? '');
      if (isNat64Error) setFieldError(nat64Input, nat64Error, errorMessage(caught));
      else setFieldError(ipv4Input, ipv4Error, errorMessage(caught));
      results.classList.add('is-stale');
    }
  };

  const debouncedUpdate = debounce(update, 150);
  ipv4Input.addEventListener('input', debouncedUpdate);
  nat64Input.addEventListener('input', debouncedUpdate);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    update();
  });

  form.querySelectorAll('[data-example]').forEach((button) => {
    button.addEventListener('click', () => {
      ipv4Input.value = /** @type {HTMLElement} */ (button).dataset.example ?? '';
      update();
      ipv4Input.focus();
    });
  });

  onLanguageChange(update);

  ipv4Input.value = DEFAULT_IPV4;
  nat64Input.value = NAT64_WELL_KNOWN_PREFIX;
  update();
}

function initDualStackPlan() {
  const form = /** @type {HTMLFormElement} */ (document.getElementById('migration-plan-form'));
  const siteInput = /** @type {HTMLInputElement} */ (document.getElementById('migration-site'));
  const siteError = /** @type {HTMLElement} */ (document.getElementById('migration-site-error'));
  const siteCapacity = /** @type {HTMLElement} */ (document.getElementById('migration-site-capacity'));
  const subnetsInput = /** @type {HTMLTextAreaElement} */ (document.getElementById('migration-subnets'));
  const strategyHint = /** @type {HTMLElement} */ (document.getElementById('migration-strategy-hint'));
  const formError = /** @type {HTMLElement} */ (document.getElementById('migration-plan-error'));
  const importButton = /** @type {HTMLButtonElement} */ (document.getElementById('migration-import'));
  const results = /** @type {HTMLElement} */ (document.getElementById('migration-plan-results'));

  /** @type {DualStackPlan | null} */
  let currentPlan = null;
  /** @type {{ name: string, network: number, prefix: number }[] | null} */
  let vlsmSubnets = null;
  /** Number of subnets imported from the VLSM planner, shown as a notice. */
  let importedCount = null;

  const getStrategy = () =>
    /** @type {'sequential' | 'ipv4Embedded'} */ (
      /** @type {HTMLInputElement | null} */ (form.querySelector('input[name="strategy"]:checked'))?.value ?? 'sequential'
    );

  const updateHints = () => {
    strategyHint.textContent = t(`migration.strategyHint.${getStrategy()}`);
    try {
      const { prefix } = parseIPv6Cidr(siteInput.value);
      siteCapacity.textContent = prefix <= 64 ? t('migration.siteCapacity', { count: formatNumber(1n << BigInt(64 - prefix)) }) : '';
    } catch {
      siteCapacity.textContent = '';
    }
  };

  const generate = () => {
    setFieldError(siteInput, siteError, null);
    subnetsInput.setAttribute('aria-invalid', 'false');
    formError.hidden = true;

    try {
      const subnets = parseSubnetList(subnetsInput.value);
      currentPlan = planDualStack(siteInput.value, subnets, { strategy: getStrategy() });
      const notice = importedCount === null ? null : t('migration.importedNotice', { count: importedCount });
      results.innerHTML = renderPlan(currentPlan, notice);
      results.classList.remove('is-stale');
    } catch (caught) {
      currentPlan = null;
      const code = caught?.code ?? '';
      if (code.startsWith('ipv6.') || code === 'migration.sitePrefixTooLong') {
        setFieldError(siteInput, siteError, errorMessage(caught));
      } else {
        if (code === 'migration.invalidSubnetLine' || code === 'migration.noSubnets') {
          subnetsInput.setAttribute('aria-invalid', 'true');
        }
        formError.textContent = errorMessage(caught);
        formError.hidden = false;
      }
      results.classList.add('is-stale');
    }
  };

  /**
   * @param {{ name: string, network: number, prefix: number }[]} subnets
   */
  const fillSubnets = (subnets) => {
    // Commas, semicolons and tabs separate fields, so strip them from names.
    subnetsInput.value = subnets
      .map(({ name, network, prefix }) => `${name.replace(/[,;\t]/g, ' ')}, ${formatIPv4(network)}/${prefix}`)
      .join('\n');
  };

  const importVlsmPlan = () => {
    if (!vlsmSubnets) return;
    fillSubnets(vlsmSubnets);
    importedCount = vlsmSubnets.length;
    generate();
  };

  const loadExample = () => {
    subnetsInput.value = EXAMPLE_SUBNETS.map(([nameKey, cidr]) => `${t(nameKey)}, ${cidr}`).join('\n');
    siteInput.value = DEFAULT_SITE_PREFIX;
    importedCount = null;
    updateHints();
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    importedCount = null;
    generate();
  });

  form.addEventListener('change', (event) => {
    if (/** @type {HTMLInputElement} */ (event.target).name === 'strategy') {
      updateHints();
      if (currentPlan) generate();
    }
  });

  siteInput.addEventListener('input', () => {
    setFieldError(siteInput, siteError, null);
    updateHints();
  });

  subnetsInput.addEventListener('input', () => subnetsInput.setAttribute('aria-invalid', 'false'));

  importButton.addEventListener('click', importVlsmPlan);
  document.getElementById('migration-example')?.addEventListener('click', () => {
    loadExample();
    generate();
  });

  results.addEventListener('click', async (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-action]') : null;
    if (!(button instanceof HTMLElement) || !currentPlan) return;

    if (button.dataset.action === 'export-csv') {
      downloadCsv(`dual-stack-plan-${formatIPv6(currentPlan.sitePrefix).replace(/:/g, '-')}${currentPlan.prefix}.csv`, planToRows(currentPlan));
    }
    if (button.dataset.action === 'copy-table') {
      if (await copyToClipboard(toTsv(planToRows(currentPlan)))) flashCopied(button);
    }
  });

  document.addEventListener(VLSM_PLAN_EVENT, (event) => {
    vlsmSubnets = /** @type {CustomEvent} */ (event).detail;
    importButton.disabled = !vlsmSubnets;
  });

  document.addEventListener(VLSM_MIGRATE_EVENT, () => {
    location.hash = 'migration';
    importVlsmPlan();
    // Wait for the hashchange to reveal the panel before scrolling.
    setTimeout(() => form.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  });

  onLanguageChange(() => {
    updateHints();
    if (currentPlan || !formError.hidden) generate();
  });

  loadExample();
  generate();
}

export function initMigrationPanel() {
  initTranslation();
  initDualStackPlan();
}
