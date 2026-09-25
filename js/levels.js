export { terrainMaterials } from './materials.js';

async function loadJson(url, description) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${description}: ${response.status}`);
  return response.json();
}

async function loadLevelEntries() {
  const catalog = await loadJson(new URL('../levels/catalog.json', import.meta.url), 'level catalog');
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.levels)) throw new Error('Unsupported level catalog format.');
  return Promise.all(catalog.levels.map(async entry => ({
    ...entry,
    level: await loadJson(new URL(`../levels/${entry.file}`, import.meta.url), `level ${entry.file}`)
  })));
}

function showLoadError(error) {
  const message = document.createElement('div');
  message.setAttribute('role', 'alert');
  message.style.cssText = 'position:fixed;inset:0;z-index:1000;display:grid;place-items:center;padding:24px;'
    + 'background:#0f1a1c;color:#f6f3e8;font:600 14px/1.6 ui-monospace,monospace;text-align:center;';
  message.textContent = `Could not load the trails: ${error.message}. Start the game with "npm run dev" so the level files can be fetched.`;
  document.body.append(message);
}

let loadedEntries;
try {
  loadedEntries = await loadLevelEntries();
} catch (error) {
  showLoadError(error);
  throw error;
}

const BROWSER_LEVELS_KEY = 'pocket-trials-browser-levels-v1';

function readBrowserLibrary() {
  try {
    const stored = JSON.parse(localStorage.getItem(BROWSER_LEVELS_KEY) || '[]');
    return Array.isArray(stored) ? stored.filter(item => item?.key && typeof item.level?.name === 'string') : [];
  } catch (_) {
    return [];
  }
}

function writeBrowserLibrary(library) {
  localStorage.setItem(BROWSER_LEVELS_KEY, JSON.stringify(library));
}

function browserEntry({ key, level }) {
  return { id: `browser:${key}`, source: 'custom', storage: 'browser', key, file: null, name: level.name, level };
}

export function slugify(name) {
  return String(name || 'trail').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'trail';
}

// Browser trails live in localStorage so they work on a static deployment without a server.
export const levelEntries = [...loadedEntries, ...readBrowserLibrary().map(browserEntry)];

export const officialLevelEntries = levelEntries.filter(entry => entry.source === 'official');
export const customLevelEntries = levelEntries.filter(entry => entry.source === 'custom');
export const officialLevels = officialLevelEntries.map(entry => entry.level);

// Career systems use only the official sequence.
export const levels = officialLevels;

export function registerLevelEntry(entry) {
  const existing = levelEntries.find(candidate => candidate.id === entry.id);
  if (existing) {
    Object.assign(existing, entry);
    return existing;
  }
  levelEntries.push(entry);
  if (entry.source === 'custom') customLevelEntries.push(entry);
  return entry;
}

export function saveBrowserLevel(level, key = null) {
  const library = readBrowserLibrary();
  let storageKey = key;
  if (!storageKey) {
    const base = slugify(level.name);
    const taken = new Set(library.map(item => item.key));
    storageKey = base;
    for (let suffix = 2; taken.has(storageKey); suffix++) storageKey = `${base}-${suffix}`;
  }
  const stored = { key: storageKey, level: JSON.parse(JSON.stringify(level)) };
  const index = library.findIndex(item => item.key === storageKey);
  if (index >= 0) library[index] = stored; else library.push(stored);
  writeBrowserLibrary(library);
  return registerLevelEntry(browserEntry(stored));
}

export function removeLevelEntry(id) {
  for (const list of [levelEntries, customLevelEntries]) {
    const index = list.findIndex(entry => entry.id === id);
    if (index >= 0) list.splice(index, 1);
  }
}

export function deleteBrowserLevel(key) {
  writeBrowserLibrary(readBrowserLibrary().filter(item => item.key !== key));
  removeLevelEntry(`browser:${key}`);
}

let devServerCheck = null;

// Only the local dev server answers this endpoint; static hosting returns 404.
export function detectDevServer() {
  devServerCheck ||= fetch(new URL('../api/dev', import.meta.url), { cache: 'no-store' })
    .then(response => response.ok ? response.json() : null)
    .then(body => Boolean(body?.writable))
    .catch(() => false);
  return devServerCheck;
}

async function devRequest(method, file, body) {
  const response = await fetch(new URL(`../api/levels/${file}`, import.meta.url), {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Request failed with ${response.status}`);
  return result;
}

export async function saveLevelFile(file, level) {
  const { entry } = await devRequest('PUT', file, level);
  return registerLevelEntry({ ...entry, level: JSON.parse(JSON.stringify(level)) });
}

export async function deleteLevelFile(file) {
  const { entry } = await devRequest('DELETE', file);
  removeLevelEntry(entry.id);
}

export function uniqueCustomFile(name) {
  const base = slugify(name);
  const taken = new Set(levelEntries.map(entry => entry.file));
  let file = `custom/${base}.json`;
  for (let suffix = 2; taken.has(file); suffix++) file = `custom/${base}-${suffix}.json`;
  return file;
}
