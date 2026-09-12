/**
 * Accessible tabs (WAI-ARIA Authoring Practices) synced with the URL hash so
 * each calculator can be linked directly, e.g. /#vlsm.
 */
export function initTabs() {
  const tabs = /** @type {HTMLButtonElement[]} */ ([...document.querySelectorAll('[role="tab"]')]);
  const ids = tabs.map((tab) => tab.dataset.tab);

  /**
   * @param {string | undefined} id
   * @param {{ focus?: boolean, updateHash?: boolean }} [options]
   */
  const select = (id, { focus = false, updateHash = true } = {}) => {
    const activeId = ids.includes(id) ? id : ids[0];

    tabs.forEach((tab) => {
      const isActive = tab.dataset.tab === activeId;
      tab.setAttribute('aria-selected', String(isActive));
      tab.tabIndex = isActive ? 0 : -1;
      const panel = document.getElementById(tab.getAttribute('aria-controls') ?? '');
      if (panel) panel.hidden = !isActive;
      if (isActive && focus) tab.focus();
    });

    if (updateHash && location.hash.slice(1) !== activeId) {
      history.replaceState(null, '', `#${activeId}`);
    }
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(tab.dataset.tab));
    tab.addEventListener('keydown', (event) => {
      const keyMoves = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 };
      if (!(event.key in keyMoves)) return;
      event.preventDefault();
      const nextIndex = (keyMoves[event.key] + tabs.length) % tabs.length;
      select(tabs[nextIndex].dataset.tab, { focus: true });
    });
  });

  window.addEventListener('hashchange', () => select(location.hash.slice(1), { updateHash: false }));
  select(location.hash.slice(1), { updateHash: false });
}
