import { store } from './local-store.js';
import { trailHash } from './trail-hash.js';
export { terrainMaterials } from './materials.js';

async function loadJson(url, description) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${description}: ${response.status}`);
  return response.json();
}

function checkCatalog(catalog) {
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.trails)) throw new Error('Unsupported trail catalog format.');
  return catalog.trails;
}

// Local-only: generated next to the custom trail files and absent on deployments.
async function loadCustomCatalog() {
  try {
    const response = await fetch(new URL('../trails/custom-catalog.json', import.meta.url));
    return response.ok ? checkCatalog(await response.json()) : [];
  } catch (_) {
    return [];
  }
}

async function loadTrailEntries() {
  const catalog = await loadJson(new URL('../trails/catalog.json', import.meta.url), 'trail catalog');
  const entries = [...checkCatalog(catalog), ...await loadCustomCatalog()];
  return Promise.all(entries.map(async entry => ({
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

// Trail Maker achievements (see editorProgress in achievements.js) waiting for
// the game to give them to the active rider: the editor has no rider of its
// own, and an editor play-test doesn't count as the rider's ride.
export const EDITOR_FEATS_KEY = 'hjulben-editor-feats-v1';

/**
 * Notes a feat for the game to reward: 'publish', 'new-trail' (a custom trail
 * published for the first time), 'share' or 'playtest'.
 */
export function reportEditorFeat(feat) {
  const feats = readEditorFeats();
  feats[feat] = (feats[feat] || 0) + 1;
  try { store().setItem(EDITOR_FEATS_KEY, JSON.stringify(feats)); } catch (_) {}
}

/** @returns {Record<string, number>} feat -> times */
function readEditorFeats() {
  try {
    const stored = JSON.parse(store().getItem(EDITOR_FEATS_KEY) || '{}');
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
    return Object.fromEntries(Object.entries(stored).filter(([, times]) => Number.isInteger(times) && times > 0));
  } catch (_) {
    return {};
  }
}

/** The feats reported since the last call, which forgets them. */
export function takeEditorFeats() {
  const feats = readEditorFeats();
  if (Object.keys(feats).length) try { store().removeItem(EDITOR_FEATS_KEY); } catch (_) {}
  return feats;
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

function browserEntry({ key, trail, shared = false }) {
  return { id: `browser:${key}`, source: 'custom', storage: 'browser', key, file: null, name: trail.name, trail, shared };
}

export function slugify(name) {
  return String(name || 'trail').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'trail';
}

// Browser trails live in browser storage so they work on a static deployment without a server.
export const trailEntries = [...loadedEntries, ...readBrowserLibrary().map(browserEntry)];

export const officialTrailEntries = trailEntries.filter(entry => entry.source === 'official');
// Shipped trails outside the career: best times, medals and the online board,
// but no progression. Some ask for career progress first (see unlocks.js).
export const bonusTrailEntries = trailEntries.filter(entry => entry.source === 'bonus');
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
  else if (entry.source === 'bonus') bonusTrailEntries.push(entry);
  return entry;
}

/** @param {{ shared?: boolean }} [options] `shared`: it came from someone's share link */
export function saveBrowserTrail(trail, key = null, { shared = false } = {}) {
  const library = readBrowserLibrary();
  let storageKey = key;
  if (!storageKey) {
    const base = slugify(trail.name);
    const taken = new Set(library.map(item => item.key));
    storageKey = base;
    for (let suffix = 2; taken.has(storageKey); suffix++) storageKey = `${base}-${suffix}`;
  }
  const index = library.findIndex(item => item.key === storageKey);
  // Stays a shared trail when the editor saves it again.
  const stored = { key: storageKey, trail: JSON.parse(JSON.stringify(trail)), ...(shared || library[index]?.shared ? { shared: true } : {}) };
  if (index >= 0) library[index] = stored; else library.push(stored);
  writeBrowserLibrary(library);
  return registerTrailEntry(browserEntry(stored));
}

/**
 * Saves a trail opened from a share link under Custom Trails. Opening the same
 * link again reuses the copy saved the first time. A link to one of your own
 * trails finds that trail, which stays yours rather than becoming shared.
 */
export function saveSharedTrail(trail) {
  const hash = trailHash(trail);
  return customTrailEntries.find(entry => entry.storage === 'browser' && entry.name === trail.name && trailHash(entry.trail) === hash)
    || saveBrowserTrail(trail, null, { shared: true });
}

export function removeTrailEntry(id) {
  for (const list of [trailEntries, bonusTrailEntries, customTrailEntries]) {
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

/**
 * The file a custom trail should be published to: its own file while that
 * still matches the name (a numbered `-2` copy counts), otherwise a free file
 * named after it.
 */
export function customFileFor(entry, name) {
  const base = slugify(name);
  if (new RegExp(`^custom/${base}(-\\d+)?\\.json$`).test(entry.file)) return entry.file;
  return uniqueCustomFile(name);
}

/**
 * Write the trail to a new file and remove the old one. The entry keeps its
 * place in the trail lists, but takes the new file and id.
 */
export async function moveTrailFile(entry, file, trail) {
  const { entry: saved } = await devRequest('PUT', file, trail);
  await devRequest('DELETE', entry.file);
  return Object.assign(entry, saved, { trail: JSON.parse(JSON.stringify(trail)) });
}

export function uniqueCustomFile(name) {
  const base = slugify(name);
  const taken = new Set(trailEntries.map(entry => entry.file));
  let file = `custom/${base}.json`;
  for (let suffix = 2; taken.has(file); suffix++) file = `custom/${base}-${suffix}.json`;
  return file;
}
