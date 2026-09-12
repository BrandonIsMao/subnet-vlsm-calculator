const STORAGE_KEY = 'svc.theme';

/**
 * Light/dark theme toggle. The initial theme is applied by an inline script in
 * index.html (before first paint) to avoid a flash of the wrong theme.
 */
export function initThemeToggle() {
  const button = document.getElementById('theme-toggle');
  const root = document.documentElement;
  if (!button) return;

  button.addEventListener('click', () => {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignore storage failures; the theme still changes for this visit.
    }
  });
}
