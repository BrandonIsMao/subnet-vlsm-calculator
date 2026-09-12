import { getLanguage, initI18n, onLanguageChange, setLanguage } from './i18n/index.js';
import { setupCopyButtons } from './ui/dom.js';
import { initIPv4Panel } from './ui/ipv4-panel.js';
import { initIPv6Panel } from './ui/ipv6-panel.js';
import { initTabs } from './ui/tabs.js';
import { initThemeToggle } from './ui/theme.js';
import { initVLSMPanel } from './ui/vlsm-panel.js';

function initLanguageSwitch() {
  const buttons = /** @type {HTMLButtonElement[]} */ ([...document.querySelectorAll('[data-lang]')]);
  const sync = () => buttons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.lang === getLanguage())));

  buttons.forEach((button) => button.addEventListener('click', () => setLanguage(button.dataset.lang ?? 'en')));
  onLanguageChange(sync);
  sync();
}

initI18n();
initLanguageSwitch();
initThemeToggle();
initTabs();
setupCopyButtons();
initIPv4Panel();
initIPv6Panel();
initVLSMPanel();
