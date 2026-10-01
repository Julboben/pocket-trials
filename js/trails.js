import { store } from './local-store.js';
export { terrainMaterials } from './materials.js';

async function loadJson(url, description) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${description}: ${response.status}`);
  return response.json();
}

async function loadTrailEntries() {
  const catalog = await loadJson(new URL('../trails/catalog.json', import.meta.url), 'trail catalog');
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.trails)) throw new Error('Unsupported trail catalog format.');
  return Promise.all(catalog.trails.map(async entry => ({
    ...entry,
    trail: await loadJson(new URL(`../trails/${entry.file}`, import.meta.url), `trail ${entry.file}`)
  })));
}

function showLoadError(error) {
  const message = document.createElement('div');
  message.setAttribute('role', 'alert');
  message.style.cssText = 'position:fixed;inset:0;z-index:1000;display:grid;place-items:center;padding:24px;'
    + 'background:#0f1a1c;color:#f6f3e8;font:600 14px/1.6 ui-monospace,monospace;text-align:center;';
  message.textContent = `Could not load the trails: ${error.message}. Start the game with "npm run dev" so the trail files can be fetched.`;
  document.body.append(message);
}

let loadedEntries;
try {
  loadedEntries = await loadTrailEntries();
} catch (error) {
  showLoadError(error);
  throw error;
}

const BROWSER_TRAILS_KEY = 'hjulben-browser-trails-v1';

// The editor hands the trail being edited to the game (index.html?playtest=1) through this key.
export const PLAYTEST_TRAIL_KEY = 'hjulben-playtest-v1';
export const PLAYTEST_EXIT_MESSAGE = 'hjulben-playtest-exit';

export function readPlaytestTrail() {
  if (new URLSearchParams(window.location.search).get('playtest') !== '1') return null;
  try {
    const trail = JSON.parse(store().getItem(PLAYTEST_TRAIL_KEY) || 'null');
    return typeof trail?.name === 'string' ? trail : null;
  } catch (_) {
    return null;
  }
}

function readBrowserLibrary() {
  try {
    const stored = JSON.parse(store().getItem(BROWSER_TRAILS_KEY) || '[]');
    return Array.isArray(stored) ? stored.filter(item => item?.key && typeof item.trail?.name === 'string') : [];
  } catch (_) {
    return [];
  }
}

function writeBrowserLibrary(library) {
  store().setItem(BROWSER_TRAILS_KEY, JSON.stringify(library));
}

function browserEntry({ key, trail }) {
  return { id: `browser:${key}`, source: 'custom', storage: 'browser', key, file: null, name: trail.name, trail };
}

export function slugify(name) {
  return String(name || 'trail').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'trail';
}

// Browser trails live in browser storage so they work on a static deployment without a server.
export const trailEntries = [...loadedEntries, ...readBrowserLibrary().map(browserEntry)];

export const officialTrailEntries = trailEntries.filter(entry => entry.source === 'official');
export const customTrailEntries = trailEntries.filter(entry => entry.source === 'custom');
export const officialTrails = officialTrailEntries.map(entry => entry.trail);

// Career systems use only the official sequence.
export const trails = officialTrails;

export function registerTrailEntry(entry) {
  const existing = trailEntries.find(candidate => candidate.id === entry.id);
  if (existing) {
    Object.assign(existing, entry);
    return existing;
  }
  trailEntries.push(entry);
  if (entry.source === 'custom') customTrailEntries.push(entry);
  return entry;
}

export function saveBrowserTrail(trail, key = null) {
  const library = readBrowserLibrary();
  let storageKey = key;
  if (!storageKey) {
    const base = slugify(trail.name);
    const taken = new Set(library.map(item => item.key));
    storageKey = base;
    for (let suffix = 2; taken.has(storageKey); suffix++) storageKey = `${base}-${suffix}`;
  }
  const stored = { key: storageKey, trail: JSON.parse(JSON.stringify(trail)) };
  const index = library.findIndex(item => item.key === storageKey);
  if (index >= 0) library[index] = stored; else library.push(stored);
  writeBrowserLibrary(library);
  return registerTrailEntry(browserEntry(stored));
}

export function removeTrailEntry(id) {
  for (const list of [trailEntries, customTrailEntries]) {
    const index = list.findIndex(entry => entry.id === id);
    if (index >= 0) list.splice(index, 1);
  }
}

export function deleteBrowserTrail(key) {
  writeBrowserLibrary(readBrowserLibrary().filter(item => item.key !== key));
  removeTrailEntry(`browser:${key}`);
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
  const response = await fetch(new URL(`../api/trails/${file}`, import.meta.url), {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Request failed with ${response.status}`);
  return result;
}

export async function saveTrailFile(file, trail) {
  const { entry } = await devRequest('PUT', file, trail);
  return registerTrailEntry({ ...entry, trail: JSON.parse(JSON.stringify(trail)) });
}

export async function deleteTrailFile(file) {
  const { entry } = await devRequest('DELETE', file);
  removeTrailEntry(entry.id);
}

export function uniqueCustomFile(name) {
  const base = slugify(name);
  const taken = new Set(trailEntries.map(entry => entry.file));
  let file = `custom/${base}.json`;
  for (let suffix = 2; taken.has(file); suffix++) file = `custom/${base}-${suffix}.json`;
  return file;
}
