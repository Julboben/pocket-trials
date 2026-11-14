// The colour theme, shared by the game and the editor: the device's own light
// or dark, or one picked in either page's settings. The game itself keeps its
// dark look in both; the light theme lightens the page around it, and the
// whole editor. css/tokens.css holds the colours: on its own it follows the
// device, and a picked theme is set on <html> as data-theme.
import { store } from './local-store.js';

const THEME_KEY = 'hjulben-theme-v1';
export const THEMES = ['system', 'light', 'dark'];
const systemLight = matchMedia('(prefers-color-scheme: light)');

/** The theme picked on this device: 'system', 'light' or 'dark'. */
export function loadTheme() {
  try {
    const theme = store().getItem(THEME_KEY);
    return THEMES.includes(theme) ? theme : 'system';
  } catch (_) {
    return 'system';
  }
}

function applyTheme(theme) {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

const listeners = new Set();
const changed = () => listeners.forEach(listener => listener());

/** Pick a theme, and remember it for both pages. */
export function setTheme(theme) {
  try {
    if (theme === 'system') store().removeItem(THEME_KEY);
    else store().setItem(THEME_KEY, theme);
  } catch (_) {
    // Blocked storage: the choice holds until the page reloads.
  }
  applyTheme(theme);
  changed();
}

/** Call `listener` whenever the colours change: a theme picked here or on the other page, or the device's own. */
export function onThemeChange(listener) {
  listeners.add(listener);
}

applyTheme(loadTheme());
systemLight.addEventListener('change', changed);
// The game and the editor are often open side by side, and the editor's play
// test runs the game in a frame: a theme picked in one shows in the other.
window.addEventListener('storage', event => {
  if (event.key !== THEME_KEY && event.key !== null) return;
  applyTheme(loadTheme());
  changed();
});
