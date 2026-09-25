export const terrainMaterials = {
  grass: {
    fill: '#c5b496', layers: ['#d3c2a2', '#b7a687'], detail: '#ac9c806e',
    edge: '#375d4d', surface: '#6f8b59', vegetation: '#628455',
    spray: ['#6f8b59','#9c8b68','#c5b496']
  },
  dirt: {
    fill: '#ad825e', layers: ['#c69a70', '#906b50'], detail: '#76543f66',
    edge: '#654735', surface: '#9c714f', vegetation: null,
    spray: ['#886044','#ad825e','#d0a47b']
  },
  rock: {
    fill: '#727a78', layers: ['#89918d', '#606866'], detail: '#4d565466',
    edge: '#3f4d4b', surface: '#9aa49e', vegetation: null,
    spray: ['#626b69','#858e8a','#aeb5ad']
  },
  snow: {
    fill: '#aebbc0', layers: ['#cbd5d6', '#929fa5'], detail: '#74838a55',
    edge: '#687a7e', surface: '#eef3ed', vegetation: null,
    spray: ['#d8e2df','#edf2eb','#aebcc0']
  },
  brick: {
    fill: '#8d493d', layers: ['#a65a49', '#71392f'], detail: '#492b29aa', pattern: 'brick',
    edge: '#433534', surface: '#74a35a', vegetation: null,
    spray: ['#754239','#9a5748','#bd7961']
  }
};

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

export const levelEntries = loadedEntries;

export const officialLevelEntries = levelEntries.filter(entry => entry.source === 'official');
export const customLevelEntries = levelEntries.filter(entry => entry.source === 'custom');
export const officialLevels = officialLevelEntries.map(entry => entry.level);
export const customLevels = customLevelEntries.map(entry => entry.level);

// Career systems use only the official sequence.
export const levels = officialLevels;
