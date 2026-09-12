import { calculateIPv6Subnet, expandIPv6, formatIPv6, parseIPv6Cidr, toScientificParts } from '../core/ipv6.js';
import { formatNumber, onLanguageChange, t } from '../i18n/index.js';
import { badge, statItem } from './components.js';
import { debounce, errorMessage, escapeHtml, setFieldError } from './dom.js';

const DEFAULT_INPUT = '2001:db8:acad::1/48';

/** Counts below this are shown in full instead of scientific notation. */
const SCIENTIFIC_THRESHOLD = 1_000_000n;

/**
 * @param {bigint} value
 * @returns {string} HTML such as "7.92 × 10<sup>28</sup>".
 */
function formatHugeNumber(value) {
  if (value < SCIENTIFIC_THRESHOLD) return formatNumber(value);
  const { mantissa, exponent } = toScientificParts(value);
  return `${mantissa} × 10<sup>${exponent}</sup>`;
}

/**
 * @param {ReturnType<typeof calculateIPv6Subnet>} subnet
 */
function renderSubnet(subnet) {
  const network = formatIPv6(subnet.network);
  const lastAddress = formatIPv6(subnet.lastAddress);
  const expanded = expandIPv6(subnet.network);
  const total = subnet.totalAddresses.toString();

  return `
    <article class="card result">
      <header class="result__header">
        <div class="result__heading">
          <p class="result__kicker">${escapeHtml(t('ipv6.network'))}</p>
          <h2 class="result__title mono">${network}<span class="result__prefix">/${subnet.prefix}</span></h2>
        </div>
        <div class="badges">${badge(t(`scope.${subnet.scope}`), 'accent')}</div>
      </header>

      <dl class="stats-grid">
        ${statItem({
          label: t('ipv6.totalAddresses'),
          value: formatHugeNumber(subnet.totalAddresses),
          copy: total,
          note: `2<sup>${subnet.hostBits}</sup>`,
          highlight: true,
        })}
        ${statItem({
          label: t('ipv6.subnets64'),
          value: subnet.subnets64 === null ? escapeHtml(t('common.notApplicable')) : formatHugeNumber(subnet.subnets64),
          note: subnet.subnets64 === null ? undefined : `2<sup>${64 - subnet.prefix}</sup>`,
        })}
        ${statItem({ label: t('ipv6.prefixLength'), value: `/${subnet.prefix}` })}
        ${statItem({ label: t('ipv6.hostBits'), value: String(subnet.hostBits) })}
        ${statItem({ label: t('ipv6.firstAddress'), value: network, copy: network, wide: true })}
        ${statItem({ label: t('ipv6.lastAddress'), value: lastAddress, copy: lastAddress, wide: true })}
        ${statItem({ label: t('ipv6.expanded'), value: expanded, copy: expanded, wide: true })}
        ${statItem({ label: t('ipv6.exactCount'), value: formatNumber(subnet.totalAddresses), copy: total, wide: true })}
      </dl>
    </article>`;
}

export function initIPv6Panel() {
  const panel = /** @type {HTMLElement} */ (document.getElementById('panel-ipv6'));
  const input = /** @type {HTMLInputElement} */ (document.getElementById('ipv6-input'));
  const error = /** @type {HTMLElement} */ (document.getElementById('ipv6-error'));
  const results = /** @type {HTMLElement} */ (document.getElementById('ipv6-results'));

  const update = () => {
    try {
      const { address, prefix } = parseIPv6Cidr(input.value);
      setFieldError(input, error, null);
      results.innerHTML = renderSubnet(calculateIPv6Subnet(address, prefix));
      results.classList.remove('is-stale');
    } catch (caught) {
      setFieldError(input, error, errorMessage(caught));
      results.classList.add('is-stale');
    }
  };

  input.addEventListener('input', debounce(update, 150));
  panel.querySelector('form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    update();
  });

  panel.querySelectorAll('[data-example]').forEach((button) => {
    button.addEventListener('click', () => {
      input.value = /** @type {HTMLElement} */ (button).dataset.example ?? '';
      update();
      input.focus();
    });
  });

  onLanguageChange(update);

  input.value = DEFAULT_INPUT;
  update();
}
