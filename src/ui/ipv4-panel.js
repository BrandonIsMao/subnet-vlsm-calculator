import { calculateIPv4Subnet, formatIPv4, parseIPv4Cidr, toBinaryOctets } from '../core/ipv4.js';
import { formatNumber, onLanguageChange, t } from '../i18n/index.js';
import { badge, statItem } from './components.js';
import { debounce, errorMessage, escapeHtml, setFieldError } from './dom.js';

const DEFAULT_INPUT = '192.168.10.37/26';

/**
 * Renders one row of the binary breakdown, colouring network and host bits.
 *
 * @param {string} label
 * @param {number} value
 * @param {number} prefix
 */
function binaryRow(label, value, prefix) {
  const octets = toBinaryOctets(value)
    .map((bits, index) => {
      const networkBits = Math.min(Math.max(prefix - index * 8, 0), 8);
      return `<span class="bits__octet"><span class="bits__net">${bits.slice(0, networkBits)}</span><span class="bits__host">${bits.slice(networkBits)}</span></span>`;
    })
    .join('<span class="bits__dot">.</span>');

  return `
    <div class="binary__row">
      <span class="binary__label">${escapeHtml(label)}</span>
      <span class="bits mono">${octets}</span>
      <span class="binary__decimal mono">${formatIPv4(value)}</span>
    </div>`;
}

/**
 * @param {ReturnType<typeof calculateIPv4Subnet>} subnet
 */
function renderSubnet(subnet) {
  const { ipClass, prefix } = subnet;
  const network = formatIPv4(subnet.network);
  const firstHost = formatIPv4(subnet.firstHost);
  const lastHost = formatIPv4(subnet.lastHost);
  const broadcast = formatIPv4(subnet.broadcast);
  const mask = formatIPv4(subnet.mask);
  const classLabel = ipClass.defaultPrefix
    ? t('ipv4.classDefault', { name: ipClass.name, prefix: ipClass.defaultPrefix })
    : t('ipv4.class', { name: ipClass.name });

  return `
    <article class="card result">
      <header class="result__header">
        <div>
          <p class="result__kicker">${escapeHtml(t('ipv4.network'))}</p>
          <h2 class="result__title mono">${network}<span class="result__prefix">/${prefix}</span></h2>
        </div>
        <div class="badges">
          ${badge(t(`scope.${subnet.scope}`), 'accent')}
          ${badge(classLabel)}
        </div>
      </header>

      <dl class="stats-grid">
        ${statItem({ label: t('ipv4.usableHosts'), value: formatNumber(subnet.usableHosts), copy: String(subnet.usableHosts), highlight: true })}
        ${statItem({ label: t('ipv4.totalAddresses'), value: formatNumber(subnet.totalAddresses), copy: String(subnet.totalAddresses) })}
        ${statItem({ label: t('ipv4.network'), value: network, copy: network })}
        ${statItem({
          label: t('ipv4.broadcast'),
          value: subnet.hasBroadcast ? broadcast : escapeHtml(t('ipv4.noBroadcast')),
          copy: subnet.hasBroadcast ? broadcast : undefined,
          mono: subnet.hasBroadcast,
        })}
        ${statItem({ label: t('ipv4.firstHost'), value: firstHost, copy: firstHost })}
        ${statItem({ label: t('ipv4.lastHost'), value: lastHost, copy: lastHost })}
        ${statItem({ label: t('ipv4.mask'), value: mask, copy: mask, note: `/${prefix}` })}
        ${statItem({ label: t('ipv4.wildcard'), value: formatIPv4(subnet.wildcard), copy: formatIPv4(subnet.wildcard) })}
        ${statItem({ label: t('ipv4.hostRange'), value: `${firstHost} – ${lastHost}`, copy: `${firstHost} - ${lastHost}`, wide: true })}
      </dl>

      <section class="binary" aria-labelledby="ipv4-binary-title">
        <div class="section-heading">
          <h3 id="ipv4-binary-title">${escapeHtml(t('ipv4.binaryTitle'))}</h3>
          <div class="legend">
            <span class="legend__item"><span class="legend__swatch legend__swatch--net"></span>${escapeHtml(t('ipv4.binaryNetworkBits'))} (${prefix})</span>
            <span class="legend__item"><span class="legend__swatch legend__swatch--host"></span>${escapeHtml(t('ipv4.binaryHostBits'))} (${32 - prefix})</span>
          </div>
        </div>
        <div class="binary__table">
          ${binaryRow(t('ipv4.binaryAddress'), subnet.address, prefix)}
          ${binaryRow(t('ipv4.binaryMask'), subnet.mask, prefix)}
          ${binaryRow(t('ipv4.binaryNetwork'), subnet.network, prefix)}
          ${binaryRow(t('ipv4.binaryBroadcast'), subnet.broadcast, prefix)}
        </div>
      </section>
    </article>`;
}

export function initIPv4Panel() {
  const panel = /** @type {HTMLElement} */ (document.getElementById('panel-ipv4'));
  const input = /** @type {HTMLInputElement} */ (document.getElementById('ipv4-input'));
  const error = /** @type {HTMLElement} */ (document.getElementById('ipv4-error'));
  const slider = /** @type {HTMLInputElement} */ (document.getElementById('ipv4-prefix'));
  const sliderOutput = /** @type {HTMLOutputElement} */ (document.getElementById('ipv4-prefix-output'));
  const results = /** @type {HTMLElement} */ (document.getElementById('ipv4-results'));

  const syncSlider = (prefix) => {
    slider.value = String(prefix);
    slider.style.setProperty('--fill', `${(prefix / 32) * 100}%`);
    sliderOutput.textContent = `/${prefix}`;
  };

  const update = () => {
    try {
      const { address, prefix } = parseIPv4Cidr(input.value);
      const subnet = calculateIPv4Subnet(address, prefix);
      setFieldError(input, error, null);
      syncSlider(prefix);
      results.innerHTML = renderSubnet(subnet);
      results.classList.remove('is-stale');
    } catch (caught) {
      setFieldError(input, error, errorMessage(caught));
      results.classList.add('is-stale');
    }
  };

  const debouncedUpdate = debounce(update, 150);

  input.addEventListener('input', debouncedUpdate);
  panel.querySelector('form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    update();
  });

  slider.addEventListener('input', () => {
    const [addressPart] = input.value.trim().split(/\s*\/\s*|\s+/);
    input.value = `${addressPart || '0.0.0.0'}/${slider.value}`;
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
