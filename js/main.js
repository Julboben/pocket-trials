import {
  STEP, MAX_STEPS_PER_FRAME, RADIUS, WHEELBASE, TAU, GRAVITY,
  XPBD_THROTTLE_INPUT_RESPONSE, XPBD_LEAN_INPUT_RESPONSE,
  clamp, lerp
} from './config.js';
import { levels, officialLevelEntries, customLevelEntries, terrainMaterials } from './levels.js';
import { createAudio } from './audio.js';
import { advanceAfterTimeOfImpact } from './physics.js';
import { createVehicle, stepVehicle, vehicleMetrics } from './vehicle-physics.js';
import { createPhysicsDebugger } from './physics-debug.js';
import { createRiderHair, hairRoot, hairRestDirection, freeHairRestDirection, hairBackSupport } from './rider-hair.js';
import { createDrawingTools, createGameArt, propAlignmentSlope, propGroundOffset, sunLight, sunShadowOffset } from './drawing.js';
import { terrainAt, terrainSegmentSlopeAt, terrainCollisionsAt, terrainSweepCollision, platformPolygon, pathBounds, groundShadowSamples } from './terrain.js';
import {
  loadPreferences,
  loadSaveSlots,
  loadActiveSlot,
  saveActiveSlot,
  createSave,
  deleteSave,
  readBest,
  saveBest,
  readLeaderboard,
  recordLeaderboardRun,
  LEADERBOARD_SIZE,
  savePreferences as persistPreferences,
  saveProgress as persistProgress
} from './storage.js';

const $ = id => document.getElementById(id);
const game = $('game');
const canvas = $('canvas');
const ctx = canvas.getContext('2d');
const { line, circle, pixelRect, pixelPath, drawPixelDisc } = createDrawingTools(ctx);
const gameArt = createGameArt(ctx);
let W = 380, H = 410;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let levelIndex = 0, level = levels[0], levelSource = 'official', customLevelIndex = -1, state = 'menu', stateBeforeMenu = 'ready', rider = 'max';
let unlockedLevel = 0, savedLevel = 0, saveGame = null;
let saveSlots = [null, null, null], activeSaveSlot = 0, pendingSaveSlot = 0, selectedNewRider = 'max', gameLoopStarted = false;
let deleteArmedSlot = -1, deleteArmTimer = 0;
const officialTrailIds = officialLevelEntries.map(entry => entry.id);
const leaderboardTrails = [...officialLevelEntries, ...customLevelEntries];
let leaderboardTrail = 0;
let preferences = { scenery: 'full', controls: 'show', sound: 'on' };
let rear, front, vehicle = null, previousRiderContacts = null, apples = [], particles = [], skidMarks = [], ragdoll = null, hair = null;
let elapsed = 0, collected = 0, facing = 1, throttle = 0, brakePressure = 0;
let weatherTime = 0, nextLightning = Infinity, lightningFlash = 0, lightningX = .5, lightningDistance = .5;
let cameraX = 0, cameraY = 0, leanControl = 0, leanVisual = 0, flipVisual = 1;
let lastTime = 0, accumulator = 0, sprayAccumulator = 0, skidAccumulator = 0, landingSoundCooldown = 0, airRotation = 0, airTurnMilestone = 0, previousAirAngle = 0, lastGateNotice = -10, toastUntil = 0;
let lastTimer = '';
const sounds = createAudio(() => ({ state, rear, front, throttle, brakePressure, weather: level?.weather }));
const keys = new Set();
const pointers = new Map();
const actionButtons = [...document.querySelectorAll('[data-action]')];
const keyActions = {
  ArrowUp:'up', KeyW:'up', ArrowDown:'down', KeyS:'down',
  ArrowLeft:'back', KeyA:'back', ArrowRight:'forward', KeyD:'forward'
};
const physicsDebugEnabled = new URLSearchParams(window.location.search).get('physicsDebug') === '1';
const physicsDebug = createPhysicsDebugger({
  enabled: physicsDebugEnabled,
  step: STEP,
  inspectPoint(point, round) {
    const ground = terrain(point.x);
    return {
      groundY: round(ground.y),
      curveSlope: round(ground.slope),
      segmentSlope: round(terrainSegmentSlopeAt(level.points, point.x))
    };
  }
});

function timeText(seconds) {
  const tenths = Math.floor(seconds * 10 + 0.00001);
  return Math.floor(tenths / 600) + ':' + String(Math.floor(tenths / 10) % 60).padStart(2, '0') + '.' + (tenths % 10);
}
function savePreferences() { persistPreferences(preferences); }
function saveProgress() {
  if (!saveGame || levelSource !== 'official') return;
  savedLevel = levelIndex;
  saveGame.level = levelIndex;
  saveGame.unlocked = unlockedLevel;
  saveSlots[activeSaveSlot] = saveGame;
  persistProgress(activeSaveSlot, levelIndex, unlockedLevel, levels.length);
}
function applyPreferences() {
  rider = saveGame?.rider || 'max';
  ctx.imageSmoothingEnabled = false;
  const controlsHidden = preferences.controls === 'hide';
  $('control-area').hidden = controlsHidden;
  game.classList.toggle('controls-hidden', controlsHidden);
  sounds.setEnabled(preferences.sound === 'on');
  document.querySelectorAll('[data-setting]').forEach(button => {
    button.setAttribute('aria-pressed', String(preferences[button.dataset.setting] === button.dataset.value));
  });
}
function loadStoredState() {
  preferences = loadPreferences(preferences);
  saveSlots = loadSaveSlots(levels.length);
  activeSaveSlot = loadActiveSlot();
  saveGame = saveSlots[activeSaveSlot];
  if (!saveGame) {
    const firstOccupied = saveSlots.findIndex(Boolean);
    if (firstOccupied >= 0) {
      activeSaveSlot = firstOccupied;
      saveGame = saveSlots[firstOccupied];
      saveActiveSlot(firstOccupied);
    }
  }
  unlockedLevel = saveGame?.unlocked || 0;
  savedLevel = saveGame?.level || 0;
  if (!['full','reduced'].includes(preferences.scenery)) preferences.scenery = 'full';
  if (!['show','hide'].includes(preferences.controls)) preferences.controls = 'show';
  if (!['on','off'].includes(preferences.sound)) preferences.sound = 'on';
}

function selectSaveSlot(index) {
  activeSaveSlot = clamp(index, 0, saveSlots.length - 1);
  saveActiveSlot(activeSaveSlot);
  saveGame = saveSlots[activeSaveSlot];
  unlockedLevel = saveGame?.unlocked || 0;
  savedLevel = saveGame?.level || 0;
  rider = saveGame?.rider || 'max';
  updateMenuDashboard();
}

function riderSymbolMarkup(selectedRider) {
  return selectedRider === 'Maxine'
    ? '<svg class="rider-symbol" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="5"></circle><path d="M12 13v8M8.5 18h7"></path></svg>'
    : '<svg class="rider-symbol" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="15" r="5"></circle><path d="M13 11 20 4M15 4h5v5"></path></svg>';
}

function drawActiveSaveIllustration() {
  const canvasElement = $('active-save-bike');
  const artCtx = canvasElement.getContext('2d');
  artCtx.setTransform(2, 0, 0, 2, 0, 0);
  artCtx.clearRect(0, 0, 120, 84);
  if (!saveGame) {
    artCtx.fillStyle = '#17262b'; artCtx.fillRect(0, 0, 120, 84);
    artCtx.fillStyle = '#91a7a8'; artCtx.font = 'bold 24px ui-monospace, monospace'; artCtx.textAlign = 'center';
    artCtx.fillText('+', 60, 50);
    return;
  }
  artCtx.fillStyle = '#eae9d9'; artCtx.fillRect(0, 0, 120, 84);
  artCtx.fillStyle = '#c5b496';
  artCtx.beginPath(); artCtx.moveTo(0,72); artCtx.quadraticCurveTo(30,58,60,69); artCtx.quadraticCurveTo(90,78,120,58); artCtx.lineTo(120,84); artCtx.lineTo(0,84); artCtx.fill();
  artCtx.strokeStyle = '#375d4d'; artCtx.lineWidth = 5; artCtx.beginPath(); artCtx.moveTo(0,72); artCtx.quadraticCurveTo(30,58,60,69); artCtx.quadraticCurveTo(90,78,120,58); artCtx.stroke();
  drawPreviewRider(artCtx, [35, 61], [85, 65]);
}

// Draws the in-game rider model, including Maxine's simulated hair, at rest.
function drawPreviewRider(artCtx, rearPoint, frontPoint, leanVisual = 0) {
  const pose = {
    rear: { x: rearPoint[0], y: rearPoint[1], spin: 0, compression: 0 },
    front: { x: frontPoint[0], y: frontPoint[1], spin: 0, compression: 0 },
    facing: 1, flipVisual: 1, leanVisual
  };
  if (rider === 'Maxine') {
    const root = hairRoot(pose, true), rest = hairRestDirection(pose);
    const previewHair = createRiderHair(root, rest);
    previewHair.settle(1.5, { root, rest, back: hairBackSupport(pose) });
    previewHair.draw(createDrawingTools(artCtx).pixelPath, hairRoot(pose, false));
  }
  createGameArt(artCtx).drawBike({
    ...pose,
    mx: (rearPoint[0] + frontPoint[0]) / 2,
    my: (rearPoint[1] + frontPoint[1]) / 2,
    angle: Math.atan2(frontPoint[1] - rearPoint[1], frontPoint[0] - rearPoint[0]),
    length: Math.hypot(frontPoint[0] - rearPoint[0], frontPoint[1] - rearPoint[1]),
    rider
  });
}

function deleteSlot(index, button) {
  if (deleteArmedSlot !== index) {
    deleteArmedSlot = index;
    button.textContent = 'SURE?';
    button.classList.add('armed');
    clearTimeout(deleteArmTimer);
    deleteArmTimer = setTimeout(() => {
      if (deleteArmedSlot !== index) return;
      deleteArmedSlot = -1;
      button.textContent = '×';
      button.classList.remove('armed');
    }, 2500);
    return;
  }
  clearTimeout(deleteArmTimer);
  deleteArmedSlot = -1;
  deleteSave(index, levels.length);
  saveSlots[index] = null;
  if (index === activeSaveSlot) {
    saveGame = null; unlockedLevel = 0; savedLevel = 0; rider = 'max';
  }
  updateMenuDashboard();
}

function buildSaveSlots() {
  const rows = saveSlots.map((save, index) => {
    const occupied = Boolean(save);
    const row = document.createElement('div');
    row.className = 'save-slot-row';
    const button = document.createElement('button');
    button.className = 'save-slot';
    button.setAttribute('aria-pressed', String(index === activeSaveSlot && occupied));
    button.innerHTML = '<span class="save-avatar ' + (!occupied ? 'empty' : save.rider === 'Maxine' ? 'female' : 'male') + '">' + (!occupied ? '+' : riderSymbolMarkup(save.rider)) + '</span>'
      + '<span class="save-slot-copy"><span class="save-label">SLOT ' + (index + 1) + '</span><strong>' + (!occupied ? 'EMPTY SLOT' : save.rider === 'Maxine' ? 'MAXINE' : 'MAX') + '</strong><small>'
      + (!occupied ? 'Start a new game' : (save.unlocked + 1) + ' / ' + levels.length + ' trails · ' + levels[save.level].name) + '</small></span>';
    button.addEventListener('click', () => {
      if (occupied) {
        selectSaveSlot(index);
        showMenuView('home');
      } else showSaveCreator(index);
    });
    row.append(button);
    if (occupied) {
      const remove = document.createElement('button');
      remove.className = 'delete-save';
      remove.type = 'button';
      remove.textContent = '×';
      remove.setAttribute('aria-label', 'Delete save slot ' + (index + 1));
      remove.addEventListener('click', () => deleteSlot(index, remove));
      row.append(remove);
    }
    return row;
  });
  $('save-slots').replaceChildren(...rows);
}

function drawHowToPlayIllustrations() {
  document.querySelectorAll('[data-how-art]').forEach(canvasElement => {
    const artCtx = canvasElement.getContext('2d');
    const art = createGameArt(artCtx);
    const kind = canvasElement.dataset.howArt;
    artCtx.setTransform(2, 0, 0, 2, 0, 0);
    artCtx.imageSmoothingEnabled = false;
    artCtx.clearRect(0, 0, 240, 100);
    artCtx.fillStyle = '#eae9d9'; artCtx.fillRect(0, 0, 240, 100);
    artCtx.fillStyle = '#b7c8b1';
    artCtx.beginPath(); artCtx.moveTo(0, 74); artCtx.lineTo(42, 43); artCtx.lineTo(78, 70); artCtx.lineTo(124, 35); artCtx.lineTo(174, 69); artCtx.lineTo(215, 41); artCtx.lineTo(240, 61); artCtx.lineTo(240, 100); artCtx.lineTo(0, 100); artCtx.fill();

    const ground = points => {
      artCtx.fillStyle = '#c5b496'; artCtx.beginPath();
      points.forEach((point, index) => index ? artCtx.lineTo(point[0], point[1]) : artCtx.moveTo(point[0], point[1]));
      artCtx.lineTo(240, 100); artCtx.lineTo(0, 100); artCtx.closePath(); artCtx.fill();
      artCtx.strokeStyle = '#375d4d'; artCtx.lineWidth = 6; artCtx.lineJoin = 'round';
      artCtx.beginPath(); points.forEach((point, index) => index ? artCtx.lineTo(point[0], point[1]) : artCtx.moveTo(point[0], point[1])); artCtx.stroke();
      artCtx.strokeStyle = '#6f8b59'; artCtx.lineWidth = 2; artCtx.stroke();
    };
    const bike = (rear, front, lean = 0) => drawPreviewRider(artCtx, rear, front, lean);

    if (kind === 'drive') {
      ground([[0,84],[55,70],[95,80],[145,70],[190,78],[240,68]]);
      bike([92,68],[141,71]);
    } else if (kind === 'lean') {
      ground([[0,92],[65,82],[105,68],[155,43],[200,30],[240,30]]);
      bike([111,63],[155,41], .8);
    } else if (kind === 'air') {
      ground([[0,88],[58,58],[80,58],[80,100],[176,100],[176,77],[240,69]]);
      bike([104,56],[153,62], -.2);
      artCtx.strokeStyle = '#d96842'; artCtx.lineWidth = 2; artCtx.setLineDash([5,4]);
      artCtx.beginPath(); artCtx.arc(130,68,47,Math.PI*1.1,Math.PI*1.82); artCtx.stroke(); artCtx.setLineDash([]);
    } else {
      ground([[0,82],[55,74],[110,84],[170,73],[240,72]]);
      art.drawApple(59, 55);
      artCtx.save(); artCtx.translate(60, 5); artCtx.scale(.65, .65);
      art.drawFlag(185, 130, true);
      artCtx.restore();
    }
  });
}

function drawMenuBackground() {
  const backgroundCanvas = $('menu-background');
  const bounds = backgroundCanvas.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  backgroundCanvas.width = Math.round(bounds.width * dpr);
  backgroundCanvas.height = Math.round(bounds.height * dpr);
  const backgroundContext = backgroundCanvas.getContext('2d');
  backgroundContext.setTransform(dpr, 0, 0, dpr, 0, 0);
  backgroundContext.imageSmoothingEnabled = false;
  const palette = levels[saveGame?.level || 0];
  createGameArt(backgroundContext).drawBackground({
    width: bounds.width,
    height: bounds.height,
    palette,
    cameraX: 260,
    cameraY: 0,
    full: preferences.scenery === 'full'
  });
}

function updateMenuDashboard() {
  const hasSave = Boolean(saveGame);
  drawActiveSaveIllustration();
  $('active-save-slot').textContent = 'SLOT ' + (activeSaveSlot + 1);
  $('active-save-rider').textContent = hasSave ? (rider === 'Maxine' ? 'MAXINE' : 'MAX') : '';
  $('active-save-progress').textContent = hasSave ? (unlockedLevel + 1) + ' / ' + levels.length + ' trails · ' + levels[savedLevel].name : '';
  $('menu-start').hidden = !hasSave;
  $('menu-new-game').classList.toggle('menu-action-primary', !hasSave);
  $('menu-levels').disabled = !hasSave && customLevelEntries.length === 0;
  buildSaveSlots();
  drawMenuBackground();
  drawHowToPlayIllustrations();
  buildMenuLevelCards();
}

function menuControls() {
  const visibleView = document.querySelector('.menu-view:not([hidden])');
  return visibleView ? [...visibleView.querySelectorAll('button:not([disabled]):not([hidden])')] : [];
}

function selectMenuControl(button) {
  document.querySelectorAll('.menu-selected').forEach(control => control.classList.remove('menu-selected'));
  if (!button) return;
  button.classList.add('menu-selected');
  button.focus({ preventScroll: true });
}

function showMenuView(view) {
  $('menu-home').hidden = view !== 'home';
  $('menu-load-view').hidden = view !== 'load';
  $('menu-level-view').hidden = view !== 'levels';
  $('menu-leaderboard-view').hidden = view !== 'leaderboard';
  $('menu-save-view').hidden = view !== 'save';
  $('menu-how-view').hidden = view !== 'how';
  $('menu-settings-view').hidden = view !== 'settings';
  $('menu-screen').scrollTop = 0;
  requestAnimationFrame(() => {
    const controls = menuControls();
    selectMenuControl(controls.find(button => !button.matches('[data-menu-back]')) || controls[0]);
  });
}

function fullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement;
}

function updateFullscreenControls() {
  const label = fullscreenElement() ? 'Exit fullscreen' : 'Enter fullscreen';
  $('fullscreen').setAttribute('aria-label', label);
  $('menu-fullscreen').setAttribute('aria-label', label);
}

function toggleFullscreen() {
  if ($('menu-screen').hidden) sounds.menuSelect();
  const action = fullscreenElement()
    ? (document.exitFullscreen?.bind(document) || document.webkitExitFullscreen?.bind(document))
    : (game.requestFullscreen?.bind(game) || game.webkitRequestFullscreen?.bind(game));
  if (!action) return;
  const result = action();
  if (result?.catch) result.catch(() => {});
}

function showMainMenu() {
  if (state !== 'menu') stateBeforeMenu = state;
  state = 'menu'; clearInput();
  $('overlay').hidden = true;
  $('pause-overlay').hidden = true;
  game.classList.add('menu-open');
  $('menu-screen').hidden = false;
  updateMenuDashboard(); showMenuView('home');
  requestAnimationFrame(() => selectMenuControl($(saveGame ? 'menu-start' : 'menu-new-game')));
}

function closeMainMenu() {
  if (!gameLoopStarted || (!saveGame && levelSource === 'official')) return;
  $('menu-screen').hidden = true;
  game.classList.remove('menu-open');
  focusGame();
  if (stateBeforeMenu === 'ragdoll') {
    state = 'ragdoll'; clearInput();
  } else if (stateBeforeMenu === 'won') {
    // The win overlay keeps its text; re-running setOverlay('won') would save the result again.
    state = 'won'; clearInput();
    $('overlay').hidden = false;
    requestAnimationFrame(() => $('primary').focus({ preventScroll: true }));
  } else {
    setOverlay(stateBeforeMenu === 'paused' ? 'paused' : 'running');
  }
}

function startSelectedLevel(load, requiresSave = true) {
  if (requiresSave && !saveGame) return;
  $('menu-screen').hidden = true;
  game.classList.remove('menu-open');
  load();
  setOverlay('running');
  focusGame();
  if (!gameLoopStarted) {
    gameLoopStarted = true;
    lastTime = 0;
    requestAnimationFrame(frame);
  }
}

function closeMenuForLevel(index) {
  startSelectedLevel(() => loadLevel(index));
}

function closeMenuForCustomLevel(index) {
  startSelectedLevel(() => loadCustomLevel(index), false);
}

function levelSection(title, description) {
  const heading = document.createElement('div');
  heading.className = 'level-section-title';
  const strong = document.createElement('strong');
  strong.textContent = title;
  const small = document.createElement('small');
  small.textContent = description;
  heading.append(strong, small);
  return heading;
}

function levelCard({ trail, number, status, best = '—', locked = false, custom = false, onSelect }) {
  const button = document.createElement('button');
  button.className = `level-card${custom ? ' custom-level-card' : ''}`;
  button.disabled = locked;
  const numberLabel = document.createElement('span');
  numberLabel.className = 'level-number';
  numberLabel.textContent = number;
  const copy = document.createElement('span');
  copy.className = 'level-copy';
  const name = document.createElement('strong');
  name.textContent = trail.name.toUpperCase();
  const detail = document.createElement('small');
  detail.textContent = status;
  copy.append(name, detail);
  const bestLabel = document.createElement('span');
  bestLabel.className = 'level-best';
  bestLabel.textContent = best;
  button.append(numberLabel, copy, bestLabel);
  if (!locked) button.addEventListener('click', onSelect);
  return button;
}

function buildMenuLevelCards() {
  const cards = [levelSection('OFFICIAL TRAILS', 'Career progression and official best times')];
  levels.forEach((trail, index) => {
    const locked = !saveGame || index > unlockedLevel;
    const best = readBest(activeSaveSlot, index, levels.length);
    cards.push(levelCard({
      trail,
      number: String(index + 1).padStart(2, '0'),
      status: locked ? 'LOCKED' : (index === savedLevel ? 'CURRENT TRAIL' : 'UNLOCKED'),
      best: best === null ? '—' : timeText(best),
      locked,
      onSelect: () => closeMenuForLevel(index)
    }));
  });
  if (customLevelEntries.length) {
    cards.push(levelSection('CUSTOM TRAILS', 'Local trails outside career progression'));
    customLevelEntries.forEach((entry, index) => cards.push(levelCard({
      trail: entry.level,
      number: `C${String(index + 1).padStart(2, '0')}`,
      status: 'CUSTOM TRAIL',
      best: 'CUSTOM',
      custom: true,
      onSelect: () => closeMenuForCustomLevel(index)
    })));
  }
  $('menu-level-grid').replaceChildren(...cards);
}

function trailMarker(index) {
  return index < officialLevelEntries.length
    ? String(index + 1).padStart(2, '0')
    : `C${String(index - officialLevelEntries.length + 1).padStart(2, '0')}`;
}

function currentLeaderboardTrail() {
  if (levelSource === 'custom' && customLevelIndex >= 0) return officialLevelEntries.length + customLevelIndex;
  return gameLoopStarted ? levelIndex : savedLevel;
}

function leaderboardRow(run, rank) {
  const row = document.createElement('li');
  row.className = 'leaderboard-row' + (rank <= 3 && run ? ' podium-' + rank : '') + (run ? '' : ' open');
  const rankLabel = document.createElement('span');
  rankLabel.className = 'leaderboard-rank';
  rankLabel.textContent = String(rank).padStart(2, '0');
  if (!run) {
    const empty = document.createElement('span');
    empty.className = 'leaderboard-open';
    empty.textContent = rank === 1 ? 'NO RUNS YET · FINISH THE TRAIL TO CLAIM IT' : '— — —';
    row.append(rankLabel, empty);
    return row;
  }
  const mine = Boolean(saveGame && run.saveId && run.saveId === saveGame.createdAt);
  row.classList.toggle('mine', mine);
  const avatar = document.createElement('span');
  avatar.className = 'save-avatar ' + (run.rider === 'Maxine' ? 'female' : 'male');
  avatar.innerHTML = riderSymbolMarkup(run.rider);
  const copy = document.createElement('span');
  copy.className = 'leaderboard-copy';
  const name = document.createElement('strong');
  name.textContent = (run.rider === 'Maxine' ? 'MAXINE' : 'MAX') + (mine ? ' · YOU' : '');
  const detail = document.createElement('small');
  const date = run.date ? new Date(run.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }).toUpperCase() : 'CAREER BEST';
  detail.textContent = (run.slot === null ? 'NO SAVE' : 'SLOT ' + (run.slot + 1)) + ' · ' + date;
  copy.append(name, detail);
  const time = document.createElement('span');
  time.className = 'leaderboard-time';
  time.textContent = timeText(run.time);
  row.append(rankLabel, avatar, copy, time);
  return row;
}

function buildLeaderboard() {
  leaderboardTrail = (leaderboardTrail + leaderboardTrails.length) % leaderboardTrails.length;
  const entry = leaderboardTrails[leaderboardTrail];
  const runs = readLeaderboard(entry.id, officialTrailIds);
  $('leaderboard-trail-number').textContent = trailMarker(leaderboardTrail);
  $('leaderboard-trail-name').textContent = entry.name.toUpperCase();
  $('leaderboard-trail-meta').textContent = (entry.source === 'custom' ? 'CUSTOM TRAIL' : 'OFFICIAL TRAIL')
    + ' · ' + (leaderboardTrail + 1) + ' / ' + leaderboardTrails.length;
  const rows = Array.from({ length: LEADERBOARD_SIZE }, (_, index) => leaderboardRow(runs[index], index + 1));
  $('leaderboard-list').replaceChildren(...rows);
}

function stepLeaderboard(direction) {
  leaderboardTrail += direction;
  buildLeaderboard();
}

// Keep the active level binding local while terrain math remains reusable.
const terrain = (x, referenceY = null) => terrainAt(level, x, referenceY);

function wheel(x, startY = null) {
  const y = startY ?? terrain(x).y - RADIUS;
  return { x, y, ox: x, oy: y, inverseMass: 1, grounded: true, contact: null, material: level.terrain || 'grass', spin: 0, angularVelocity: 0, compression: 0, impactSpeed: 0 };
}



function clearInput() {
  keys.clear();
  pointers.clear();
  actionButtons.forEach(b => b.classList.remove('held'));
}
function down(action) {
  for (const code of keys) if (keyActions[code] === action) return true;
  for (const held of pointers.values()) if (held === action) return true;
  return false;
}
function paintInput() {
  actionButtons.forEach(b => b.classList.toggle('held', down(b.dataset.action)));
}
function focusGame() { game.focus({ preventScroll: true }); }
function updateDirectionControls() {
  const left = $('left-control'), right = $('right-control');
  const facingRight = facing > 0;
  left.querySelector('.caption').textContent = facingRight ? 'LEAN BACK' : 'LEAN FWD';
  right.querySelector('.caption').textContent = facingRight ? 'LEAN FWD' : 'LEAN BACK';
  left.setAttribute('aria-label', (facingRight ? 'Lean back' : 'Lean forward') + ', left arrow');
  right.setAttribute('aria-label', (facingRight ? 'Lean forward' : 'Lean back') + ', right arrow');
}
function flipDirection() {
  const airborne = !rear.grounded && !front.grounded;
  facing *= -1;
  updateDirectionControls();
  sounds.flip(airborne);
}

function initializeLevel(trail, marker) {
  level = trail;
  const { x: startX, y: startY, facing: startFacing } = level.start;
  rear = wheel(startX - WHEELBASE / 2, startY); front = wheel(startX + WHEELBASE / 2, startY);
  vehicle = createVehicle(rear, front);
  apples = level.apples.map(apple => ({
    x: apple.x,
    y: Number.isFinite(apple.y) ? apple.y : terrain(apple.x).y - 60,
    taken: false
  }));
  particles = []; skidMarks = []; ragdoll = null; hair = null; elapsed = 0; collected = 0; facing = startFacing; throttle = 0; brakePressure = 0;
  weatherTime = 0; lightningFlash = 0; lightningX = .5; lightningDistance = .5;
  nextLightning = level.weather?.lightning ? 2.5 + Math.random() * 4 : Infinity;
  cameraX = 0; cameraY = 0; leanControl = 0; leanVisual = 0; flipVisual = 1;
  previousRiderContacts = riderCollisionPoints();
  accumulator = 0; sprayAccumulator = 0; skidAccumulator = 0; landingSoundCooldown = 0;
  airRotation = 0; airTurnMilestone = 0; previousAirAngle = 0;
  lastGateNotice = -10; lastTimer = '';
  clearInput(); updateDirectionControls();
  $('scene-label').textContent = level.name.toUpperCase();
  $('scene-label').dataset.trailNumber = marker;
  $('apple-count').textContent = '0 / ' + apples.length;
  $('toast').classList.remove('visible'); toastUntil = 0;
  updateHud();
}

function loadLevel(index) {
  index = clamp(index, 0, unlockedLevel);
  levelSource = 'official'; customLevelIndex = -1; levelIndex = index;
  initializeLevel(levels[index], String(index + 1).padStart(2, '0'));
  saveProgress();
}

function loadCustomLevel(index) {
  const entry = customLevelEntries[index];
  if (!entry) return;
  levelSource = 'custom'; customLevelIndex = index;
  initializeLevel(entry.level, `C${String(index + 1).padStart(2, '0')}`);
}

function setOverlay(next) {
  state = next; clearInput();
  const visible = next === 'won';
  $('overlay').hidden = !visible;
  $('pause-overlay').hidden = next !== 'paused';
  $('secondary').hidden = !visible;
  if (visible) requestAnimationFrame(() => $('primary').focus({ preventScroll: true }));

  if (next === 'paused') {
    $('announcer').textContent = 'Paused. Press P or Escape to resume.';
  } else if (next === 'won') {
    $('overlay-badge').textContent = levelSource === 'official' ? 'TRAIL COMPLETED' : 'CUSTOM TRAIL COMPLETED';
    $('overlay-title').textContent = 'Goal Reached!';
    const trailId = levelSource === 'official' ? officialTrailIds[levelIndex] : customLevelEntries[customLevelIndex]?.id;
    const rank = trailId ? recordLeaderboardRun(trailId, {
      time: elapsed, rider, slot: saveGame ? activeSaveSlot : null, saveId: saveGame?.createdAt
    }, officialTrailIds) : null;
    const rankText = rank ? ' Leaderboard rank #' + rank + '.' : '';
    if (levelSource === 'official') {
      unlockedLevel = Math.max(unlockedLevel, Math.min(levelIndex + 1, levels.length - 1));
      saveProgress();
      const previous = readBest(activeSaveSlot, levelIndex, levels.length);
      const record = previous === null || elapsed < previous;
      if (record) {
        saveBest(activeSaveSlot, levelIndex, elapsed, levels.length);
        saveGame.bestTimes[levelIndex] = elapsed;
      }
      $('overlay-description').textContent = 'Finished in ' + timeText(elapsed) + '. ' + (record ? 'New best time on this trail!' : 'Best: ' + timeText(previous) + '.') + rankText;
      $('primary').textContent = levelIndex === levels.length - 1 ? 'Play Again →' : 'Next Trail →';
    } else {
      $('overlay-description').textContent = 'Finished in ' + timeText(elapsed) + '.' + rankText + ' Custom trails do not affect career progression.';
      $('primary').textContent = 'Play Again →';
    }
    $('secondary').textContent = 'Replay Trail';
    $('announcer').textContent = 'Trail complete in ' + timeText(elapsed) + '. All ' + apples.length + ' apples collected.';
  }
}

function startFresh() {
  if (levelSource === 'custom') loadCustomLevel(customLevelIndex);
  else loadLevel(levelIndex);
  setOverlay('running'); focusGame();
}
function pauseGame() { if (state === 'running') setOverlay('paused'); }
function resumeGame() {
  if (state !== 'paused') return;
  setOverlay('running'); focusGame();
}
function togglePause() { state === 'paused' ? resumeGame() : pauseGame(); }
function notify(message, duration = 2600) {
  $('toast').textContent = message;
  toastUntil = duration === Infinity ? Infinity : performance.now() + duration;
  $('toast').classList.add('visible');
}

function riderCollisionPoints() {
  const angle = Math.atan2(front.y - rear.y, front.x - rear.x);
  const c = Math.cos(angle), s = Math.sin(angle);
  const riderShift = leanVisual * 9;
  const backCompression = facing > 0 ? rear.compression : front.compression;
  const frontCompression = facing > 0 ? front.compression : rear.compression;
  const bodyDrop = (backCompression + frontCompression) * .4;
  const bodyPitch = (frontCompression - backCompression) * .0096;
  const pc = Math.cos(bodyPitch), ps = Math.sin(bodyPitch);
  const transform = (localX, localY, radius) => {
    const shiftedX = localX + riderShift;
    const pitchedX = shiftedX * pc - localY * ps;
    const pitchedY = shiftedX * ps + localY * pc + bodyDrop;
    const facingX = pitchedX * facing;
    return {
      x: (rear.x + front.x) / 2 + c * facingX - s * pitchedY,
      y: (rear.y + front.y) / 2 + s * facingX + c * pitchedY,
      radius
    };
  };
  return {
    head: transform(3, -43, 6),
    shoulder: transform(1, -34, 5),
    hip: transform(-7, -23, 5)
  };
}

function headPosition() {
  return riderCollisionPoints().head;
}

function makeRagdollPoint(x,y,vx,vy,radius=3) {
  return {x,y,ox:x-vx,oy:y-vy,radius};
}
function startRagdoll() {
  if (ragdoll) return;
  sounds.crash();
  const mx=(rear.x+front.x)/2,my=(rear.y+front.y)/2;
  const angle=Math.atan2(front.y-rear.y,front.x-rear.x),c=Math.cos(angle),s=Math.sin(angle);
  const vx=((rear.x-rear.ox)+(front.x-front.ox))/2;
  const vy=((rear.y-rear.oy)+(front.y-front.oy))/2;
  const world=(x,y)=>({x:mx+c*x*facing-s*y,y:my+s*x*facing+c*y});
  const pose={
    head:world(3,-43),shoulder:world(1,-35),hip:world(-8,-24),
    elbow:world(11,-30),hand:world(19,-25),knee:world(4,-14),foot:world(-2,-3)
  };
  const points={};
  for(const [name,p] of Object.entries(pose)) points[name]=makeRagdollPoint(p.x,p.y,vx+(Math.random()-.5)*.35,vy-1.1+(Math.random()-.5)*.25,name==='head'?6:3);
  const links=[['head','shoulder'],['shoulder','hip'],['shoulder','elbow'],['elbow','hand'],['hip','knee'],['knee','foot']]
    .map(([a,b])=>({a,b,length:Math.hypot(points[b].x-points[a].x,points[b].y-points[a].y)}));
  ragdoll={points,links};
  state='ragdoll'; clearInput();
  $('announcer').textContent='Rider down. Press R or select the restart button to try again.';
  notify('Rider down · Press R to retry', Infinity);
}
function resolveRagdollContact(p, contact) {
  if (!contact || (contact.penetration <= 0 && !contact.swept)) return;
  const { nx, ny, penetration } = contact;
  let vx=p.x-p.ox,vy=p.y-p.oy;
  const normal=vx*nx+vy*ny;
  if(normal<0){vx-=nx*normal*1.12;vy-=ny*normal*1.12;}
  const tangentX=-ny,tangentY=nx,tangent=vx*tangentX+vy*tangentY;
  vx-=tangentX*tangent*.16;vy-=tangentY*tangent*.16;
  p.x+=nx*penetration;p.y+=ny*penetration;p.ox=p.x-vx;p.oy=p.y-vy;
}
function collideRagdollPoint(p, sweep) {
  if (sweep) {
    const intendedVx = p.x - p.ox, intendedVy = p.y - p.oy;
    const swept = terrainSweepCollision(level, p.ox, p.oy, p.x, p.y, p.radius);
    if (swept) {
      p.x = swept.x + swept.nx * .01;
      p.y = swept.y + swept.ny * .01;
      p.ox = p.x - intendedVx;
      p.oy = p.y - intendedVy;
      resolveRagdollContact(p, swept);
      // Continue through the unused part of the substep with the resolved
      // velocity. Stopping at time-of-impact discarded most tangential
      // travel on every grounded frame, which felt like artificial glue.
      advanceAfterTimeOfImpact(p, swept.time);
    }
  }
  for (const contact of terrainCollisionsAt(level, p.x, p.y, p.radius)) resolveRagdollContact(p, contact);
  if (p.x < RADIUS) {
    const vx = Math.max(0, p.x - p.ox);
    p.x = RADIUS;
    p.ox = p.x - vx;
  }
}
function updateRagdoll() {
  if(!ragdoll)return;
  for(const p of Object.values(ragdoll.points)){
    const vx=(p.x-p.ox)*.996,vy=(p.y-p.oy)*.996;
    p.ox=p.x;p.oy=p.y;p.x+=vx;p.y+=vy+GRAVITY*STEP*STEP;
  }
  for(let iteration=0;iteration<6;iteration++){
    for(const link of ragdoll.links){
      const a=ragdoll.points[link.a],b=ragdoll.points[link.b];
      const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||.001;
      const correction=(d-link.length)/d*.5;
      a.x+=dx*correction;a.y+=dy*correction;b.x-=dx*correction;b.y-=dy*correction;
    }
    for(const p of Object.values(ragdoll.points))collideRagdollPoint(p, iteration === 0);
  }
}

function burst(x, y, color, count = 12) {
  for (let i = 0; i < count; i++) {
    const angle = TAU * i / count;
    const speed = 25 + Math.random() * 85;
    particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 35, life: .65, max: .65, color });
  }
}

function emitBrakeMarks(bikeSpeed, braking) {
  const speed = Math.abs(bikeSpeed);
  if (state !== 'running' || !braking || speed < 24) {
    skidAccumulator = 0;
    return;
  }
  skidAccumulator += STEP;
  if (skidAccumulator < .045) return;
  skidAccumulator = 0;
  const direction = Math.sign(bikeSpeed || facing);
  for (const wheelPoint of [rear, front]) {
    if (!wheelPoint.grounded) continue;
    const ground = wheelPoint.contact || terrain(wheelPoint.x, wheelPoint.y - RADIUS);
    const length = clamp(speed * .035 * brakePressure, 3, 10);
    skidMarks.push({
      x: ground.pointX ?? wheelPoint.x, y: (ground.pointY ?? ground.y) - 1, slope: ground.slope,
      direction, length, life: 1.6, max: 1.6
    });
  }
}

function emitTerrainSpray(bikeSpeed, braking) {
  if (state !== 'running') return;
  const speed = Math.abs(bikeSpeed);
  const contactWheel = facing > 0 ? rear : front;
  if (!contactWheel.grounded || speed < 28 || (!braking && throttle < .12)) {
    sprayAccumulator = Math.min(sprayAccumulator, .8);
    return;
  }
  const intensity = clamp(speed / 210, .15, 1) * (braking ? 1.5 : .8 + throttle * .7);
  sprayAccumulator += intensity * STEP * 24;
  while (sprayAccumulator >= 1) {
    sprayAccumulator--;
    const direction = Math.sign(bikeSpeed || facing);
    const spray = terrainMaterials[contactWheel.material]?.spray || level.spray;
    const color = spray[Math.floor(Math.random() * spray.length)];
    const life = .28 + Math.random() * .32;
    particles.push({
      x: (contactWheel.contact?.pointX ?? contactWheel.x) - direction * (RADIUS - 2),
      y: (contactWheel.contact?.pointY ?? terrain(contactWheel.x).y) - 2,
      vx: bikeSpeed * .12 - direction * (35 + Math.random() * (braking ? 95 : 65)),
      vy: -(25 + Math.random() * (braking ? 90 : 55)),
      life, max: life, color, size: Math.random() < .7 ? 2 : 4, drag: 2.5, splatter: true
    });
  }
}

function updateWeather() {
  weatherTime += STEP;
  lightningFlash = Math.max(0, lightningFlash - STEP * 4.5);
  const intensity = clamp(Number(level.weather?.lightning) || 0, 0, 1);
  if (!intensity || weatherTime < nextLightning) return;
  lightningDistance = Math.pow(Math.random(), .75);
  const proximity = 1 - lightningDistance;
  lightningFlash = (.4 + intensity * .35) * (.45 + proximity * .55);
  lightningX = .15 + Math.random() * .7;
  const interval = lerp(12, 4.5, intensity);
  nextLightning = weatherTime + interval * (.7 + Math.random() * .65);
  sounds.thunder(intensity, lightningDistance);
}

function physics() {
  if (state !== 'running' && state !== 'ragdoll') return;
  updateWeather();
  if (state === 'running') elapsed += STEP;
  landingSoundCooldown = Math.max(0, landingSoundCooldown - STEP);
  const wasRearGrounded = rear.grounded, wasFrontGrounded = front.grounded;
  rear.impactSpeed = 0; front.impactSpeed = 0;
  physicsDebug.begin({ state, time: elapsed, level: level.name, source: levelSource, facing, throttle }, rear, front);

  const replayInput = physicsDebug.nextReplayInput();
  if (replayInput && Number(replayInput.facing)) facing = replayInput.facing < 0 ? -1 : 1;
  const leanInput = replayInput?.leanInput ?? (Number(down('forward')) - Number(down('back')));
  leanControl = lerp(leanControl, leanInput, 1 - Math.exp(-XPBD_LEAN_INPUT_RESPONSE * STEP));
  const acceptingInput = state === 'running';
  const accelerating = acceptingInput && (replayInput?.accelerating ?? down('up'));
  const braking = acceptingInput && (replayInput?.braking ?? down('down'));
  physicsDebug.recordInput({ facing, leanInput, accelerating, braking });
  const coasting = !accelerating && !braking;
  const throttleTarget = accelerating && !braking ? 1 : 0;
  const throttleRate = throttleTarget > throttle ? XPBD_THROTTLE_INPUT_RESPONSE : 4;
  throttle = lerp(throttle, throttleTarget, 1 - Math.exp(-throttleRate * STEP));
  brakePressure = lerp(brakePressure, braking ? 1 : 0, 1 - Math.exp(-(braking ? 10 : 14) * STEP));
  const bikeSpeed = ((rear.x - rear.ox) + (front.x - front.ox)) / (2 * STEP);
  stepVehicle(vehicle, level, {
    facing, throttle, brakePressure, leanControl, accelerating, braking, coasting
  }, {
    dynamics: values => physicsDebug.recordDynamics(values),
    afterIntegration: () => physicsDebug.capture('afterIntegration', rear, front),
    iteration: value => physicsDebug.setIteration(value),
    constraint: correction => physicsDebug.recordConstraint(correction, rear, front),
    contact: value => physicsDebug.recordContact(value),
    contactsResolved: () => physicsDebug.recordContactsResolved(rear, front),
    traction: (wheelName, result, point) => physicsDebug.recordTraction(wheelName, result, point)
  });
  physicsDebug.capture('afterVelocityConstraint', rear, front);
  physicsDebug.setIteration(-1);
  physicsDebug.finish(rear, front);
  const airborne = !rear.grounded && !front.grounded;
  const wasAirborne = !wasRearGrounded && !wasFrontGrounded;
  const bikeAngle = Math.atan2(front.y - rear.y, front.x - rear.x);
  if (airborne) {
    if (!wasAirborne) {
      airRotation = 0;
      airTurnMilestone = 0;
    } else {
      airRotation += Math.atan2(Math.sin(bikeAngle - previousAirAngle), Math.cos(bikeAngle - previousAirAngle));
      const milestone = Math.floor(Math.abs(airRotation) / Math.PI);
      if (milestone > airTurnMilestone) {
        airTurnMilestone = milestone;
        sounds.airTurn(milestone % 2 === 0);
      }
    }
    previousAirAngle = bikeAngle;
  } else {
    airRotation = 0;
    airTurnMilestone = 0;
    previousAirAngle = bikeAngle;
  }

  const landingImpact = Math.max(
    !wasRearGrounded && rear.grounded ? rear.impactSpeed : 0,
    !wasFrontGrounded && front.grounded ? front.impactSpeed : 0
  );
  if (state === 'running' && landingImpact > 45 && landingSoundCooldown === 0) {
    sounds.land(landingImpact);
    landingSoundCooldown = .12;
  }
  emitTerrainSpray(bikeSpeed, braking);
  emitBrakeMarks(bikeSpeed, braking);

  const riderContacts = riderCollisionPoints();
  const head = riderContacts.head;
  const mx = (rear.x + front.x) / 2, my = (rear.y + front.y) / 2;

  if(state==='ragdoll'){updateRagdoll();return;}
  const riderObstacle = Object.entries(riderContacts).some(([name, point]) => {
    const previous = previousRiderContacts?.[name];
    return (previous && terrainSweepCollision(level, previous.x, previous.y, point.x, point.y, point.radius))
      || terrainCollisionsAt(level, point.x, point.y, point.radius)[0];
  });
  previousRiderContacts = riderContacts;
  if ((riderObstacle && elapsed > .2)
    || my > (level.fallY || 620)) {
    burst(head.x, head.y, '#ed8b54', 15);
    startRagdoll();
    return;
  }

  for (const apple of apples) {
    if (!apple.taken && (
      Math.hypot(head.x - apple.x, head.y - apple.y) < 25 ||
      Math.hypot(mx - apple.x, my - 18 - apple.y) < 34
    )) {
      apple.taken = true; collected++;
      burst(apple.x, apple.y, '#ef8150'); sounds.apple();
      $('apple-count').textContent = collected + ' / ' + apples.length;
      $('announcer').textContent = collected + ' of ' + apples.length + ' apples collected.';
      if (collected === apples.length) notify('All apples collected! Finish gate unlocked ⚑');
    }
  }

  if (mx > level.goal - 20) {
    if (collected === apples.length) {
      burst(mx, my - 55, '#e8964f', 25); sounds.win();
      setOverlay('won');
    } else if (elapsed - lastGateNotice > 5) {
      lastGateNotice = elapsed;
      const missing = apples.length - collected;
      notify(missing + (missing === 1 ? ' apple remaining! Turn back to collect it.' : ' apples remaining! Turn back to collect them.'));
    }
  }

  leanVisual = lerp(leanVisual, leanInput, 1 - Math.exp(-7 * STEP));
}

function updateHud() {
  const text = timeText(elapsed);
  if (text !== lastTimer) { $('timer').textContent = text; lastTimer = text; }
}



function drawBackground() {
  gameArt.drawBackground({
    width: W,
    height: H,
    palette: level,
    cameraX,
    cameraY,
    full: preferences.scenery === 'full'
  });
}


function solidRanges() {
  const start = cameraX - 15, end = cameraX + W + 15;
  const ranges = [];
  let cursor = start;
  for (const gap of level.gaps || []) {
    if (gap[1] <= cursor || gap[0] >= end) continue;
    if (gap[0] > cursor) ranges.push([cursor, Math.min(gap[0], end)]);
    cursor = Math.max(cursor, gap[1]);
    if (cursor >= end) break;
  }
  if (cursor < end) ranges.push([cursor, end]);
  return ranges;
}

function groundPath(offset = 0) {
  ctx.beginPath();
  const bottom = cameraY + H + 100;
  for (const [start, end] of solidRanges()) {
    if (end <= start) continue;
    const floating = level.island && start >= level.island[0] - 1 && end <= level.island[1] + 1;
    const pathStart = floating ? level.island[0] : start;
    const pathEnd = floating ? level.island[1] : end;
    ctx.moveTo(pathStart, floating ? terrain(pathStart).y + 58 + offset : bottom);
    ctx.lineTo(pathStart, terrain(pathStart).y + offset);
    for (let x = pathStart + 5; x < pathEnd; x += 5) ctx.lineTo(x, terrain(x).y + offset);
    ctx.lineTo(pathEnd, terrain(pathEnd).y + offset);
    if (floating) {
      const islandBottom = Math.max(terrain(pathStart).y, terrain(pathEnd).y) + 145 + offset;
      ctx.lineTo(pathEnd - 28, terrain(pathEnd).y + 62 + offset);
      ctx.lineTo((pathStart + pathEnd) / 2, islandBottom);
      ctx.lineTo(pathStart + 28, terrain(pathStart).y + 62 + offset);
    } else ctx.lineTo(pathEnd, bottom);
    ctx.closePath();
  }
}


function materialFor(name) {
  return terrainMaterials[name] || terrainMaterials.grass;
}

function drawBrickPattern(start, end, top, bottom) {
  ctx.fillStyle = '#4e2e2a99';
  for (let y = Math.floor(top / 14) * 14; y < bottom; y += 14) {
    ctx.fillRect(start, y, end - start, 2);
    const offset = (Math.floor(y / 14) % 2) * 15;
    for (let x = Math.floor(start / 30) * 30 + offset; x < end; x += 30) ctx.fillRect(x, y, 2, 14);
  }
}

function platformPath(platform, offset = 0) {
  const polygon = platformPolygon(platform);
  ctx.beginPath();
  polygon.forEach((point, index) => index
    ? ctx.lineTo(point[0], point[1] + offset)
    : ctx.moveTo(point[0], point[1] + offset));
  ctx.closePath();
}

function drawAuthoredPath(path) {
  const bounds = pathBounds(path);
  if (bounds.right < cameraX - 30 || bounds.left > cameraX + W + 30) return;
  const material = materialFor(path.material);
  ctx.beginPath();
  path.points.forEach((point, index) => index ? ctx.lineTo(point[0], point[1]) : ctx.moveTo(point[0], point[1]));
  if (path.closed) ctx.closePath();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const thickness = path.thickness || 32;
  ctx.strokeStyle = material.edge; ctx.lineWidth = thickness + 7; ctx.stroke();
  ctx.strokeStyle = material.surface; ctx.lineWidth = thickness + 3; ctx.stroke();
  ctx.strokeStyle = material.fill; ctx.lineWidth = thickness; ctx.stroke();
}

function drawPlatform(platform) {
  const start = platform.points[0][0], end = platform.points[platform.points.length - 1][0];
  if (end < cameraX - 30 || start > cameraX + W + 30) return;
  const material = materialFor(platform.material);
  platformPath(platform); ctx.fillStyle = material.fill; ctx.fill();
  ctx.save(); platformPath(platform); ctx.clip();
  if (material.pattern === 'brick') {
    const top = Math.min(...platform.points.map(point => point[1]));
    const bottom = Math.max(...platform.points.map(point => point[1])) + (platform.thickness || 48) + 8;
    drawBrickPattern(start, end, top, bottom);
  } else {
    for (let offset = 16, index = 0; offset < (platform.thickness || 48); offset += 16, index++) {
      ctx.beginPath();
      for (let x = start; x <= end; x += 6) {
        const y = terrainAt({ points: platform.points }, x).y + offset;
        if (x === start) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = material.layers[index % material.layers.length]; ctx.lineWidth = 2; ctx.stroke();
    }
  }
  ctx.restore();
  ctx.beginPath(); ctx.moveTo(start, terrainAt({ points: platform.points }, start).y);
  for (let x = start + 3; x < end; x += 3) ctx.lineTo(x, terrainAt({ points: platform.points }, x).y);
  ctx.lineTo(end, terrainAt({ points: platform.points }, end).y);
  ctx.strokeStyle = material.edge; ctx.lineWidth = 7; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.strokeStyle = material.surface; ctx.lineWidth = 2; ctx.stroke();
}

function drawTerrain() {
  const material = materialFor(level.terrain);
  groundPath(); ctx.fillStyle = material.fill; ctx.fill();
  ctx.save(); groundPath(); ctx.clip();
  if (material.pattern === 'brick') {
    drawBrickPattern(cameraX - 20, cameraX + W + 20, cameraY - 20, cameraY + H + 100);
  } else {
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      for (let x = cameraX - 20; x < cameraX + W + 25; x += 8) {
        const y = terrain(x).y + 27 + i * 30 + Math.sin(x * .022 + i) * 5;
        if (x === cameraX - 20) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = material.layers[i % material.layers.length]; ctx.lineWidth = 2; ctx.stroke();
    }
  }
  for (let i = Math.floor(cameraX / 31); i < Math.ceil((cameraX + W) / 31); i++) {
    const x = i * 31 + Math.sin(i * 18) * 9;
    const y = terrain(x).y + 16 + (Math.sin(i * 23) + 1) * 34;
    ctx.fillStyle = material.detail;
    ctx.beginPath(); ctx.ellipse(x, y, 2 + (i % 3 + 3) % 3, 1.5, .3, 0, TAU); ctx.fill();
  }
  ctx.restore();

  ctx.beginPath();
  for (const [start, end] of solidRanges()) {
    ctx.moveTo(start, terrain(start).y);
    for (let x = start + 3; x < end; x += 3) ctx.lineTo(x,terrain(x).y);
    ctx.lineTo(end,terrain(end).y);
  }
  ctx.strokeStyle = material.edge; ctx.lineWidth = 7; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.strokeStyle = material.surface; ctx.lineWidth = 2; ctx.stroke();

  if (material.vegetation) for (let i = Math.floor(cameraX / 45); i < Math.ceil((cameraX + W) / 45); i++) {
    const x = i * 45 + Math.sin(i * 9) * 8, t = terrain(x);
    if (!t.solid) continue;
    pixelPath([[x - 4, t.y - 2],[x - 4, t.y - 8],[x, t.y - 4],[x + 2, t.y - 10]], material.vegetation, 1, 2);
  }

  for (const path of level.paths || []) drawAuthoredPath(path);
  for (const platform of level.platforms || []) drawPlatform(platform);

  if (cameraX < 230) {
    const y = terrain(28).y;
    line([[28,y],[28,y-48]], '#6d7862', 3);
    ctx.fillStyle = '#e8e4ce'; ctx.fillRect(8,y-52,41,19);
    ctx.fillStyle = '#3c5e4b'; ctx.font = 'bold 8px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('GO →',28,y-39);
  }
}

const SCENERY_SHADOWS = {
  tree: { width: 16, alpha: .15, thickness: 3, lift: 36 },
  crystal: { width: 10, alpha: .14, thickness: 3, lift: 28 }
};

function drawProp(prop,layer){
  if(preferences.scenery === 'reduced' && prop.type === 'tree')return;
  if(prop.x<cameraX-70||prop.x>cameraX+W+70)return;
  const ground=terrain(prop.x);if(!ground.solid&&!Number.isFinite(prop.y))return;
  const y=Number.isFinite(prop.y)?prop.y:ground.y;
  gameArt.drawProp(prop.type, prop.x, y, layer==='front'?1:.82, propAlignmentSlope(level, prop), propGroundOffset(level, prop));
}


function drawProps(layer) {
  for (const prop of level.props || []) if (prop.layer === layer) drawProp(prop, layer);
}

function appleDrawY(apple, now) {
  return apple.y + (reducedMotion ? 0 : Math.sin(now * .0025 + apple.x) * 2);
}

function drawSceneryShadow(x, y, light, { width, alpha, thickness, lift = 0 }) {
  const ground = terrain(x, y);
  if (!ground.solid) return;
  const height = Math.max(0, ground.y - y) + lift;
  const offset = sunShadowOffset({
    bikeX: x - cameraX, bikeY: y - cameraY, sunX: light.x, sunY: light.y,
    height, strength: light.strength
  });
  const center = x + offset;
  drawShadowBlob(groundShadowSamples(level, x, y, width, 2, center).flat(), center, width, alpha, thickness);
}

function drawSceneryShadows(now) {
  if (preferences.scenery === 'reduced') return;
  const light = sunLight({ width: W, cameraX, cameraY, weather: level.weather });
  for (const prop of level.props || []) {
    const spec = SCENERY_SHADOWS[prop.type];
    if (!spec || prop.x < cameraX - 80 || prop.x > cameraX + W + 80) continue;
    const ground = terrain(prop.x);
    if (!ground.solid && !Number.isFinite(prop.y)) continue;
    drawSceneryShadow(prop.x, Number.isFinite(prop.y) ? prop.y : ground.y, light, spec);
  }
  for (const apple of apples) {
    if (apple.taken || apple.x < cameraX - 40 || apple.x > cameraX + W + 40) continue;
    drawSceneryShadow(apple.x, appleDrawY(apple, now), light, { width: 8, alpha: .18, thickness: 3 });
  }
}

function drawApple(apple, now) {
  if (apple.taken || apple.x < cameraX - 30 || apple.x > cameraX + W + 30) return;
  gameArt.drawApple(apple.x, appleDrawY(apple, now));
}

function drawFlag() {
  const x=level.goal,y=terrain(x).y;
  if(x<cameraX-65||x>cameraX+W+65)return;
  gameArt.drawFlag(x, y, collected===apples.length, apples.length-collected);
}

function drawPixelBike(mx, my, angle, length) {
  gameArt.drawBike({ rear, front, mx, my, angle, length, flipVisual, facing, brakePressure, state, leanVisual, rider });
}

function riderPose() {
  return { rear, front, facing, flipVisual, leanVisual };
}

function currentHairRoot(exact) {
  if (ragdoll) {
    const head = ragdoll.points.head;
    return { x: head.x - facing * 6, y: head.y };
  }
  return hairRoot(riderPose(), exact);
}

function updateHair(dt) {
  if (rider !== 'Maxine') { hair = null; return; }
  const root = currentHairRoot(true);
  const rest = ragdoll ? freeHairRestDirection(facing) : hairRestDirection(riderPose());
  if (!hair || Math.hypot(root.x - hair.root.x, root.y - hair.root.y) > 60) hair = createRiderHair(root, rest);
  hair.update(dt, { root, rest, back: ragdoll ? null : hairBackSupport(riderPose()), groundAt: x => terrain(x) });
}

function drawHair() {
  if (hair) hair.draw(pixelPath, currentHairRoot(false));
}

function drawShadowBlob(samples, centerX, width, alpha, thickness) {
  for (const sample of samples) {
    const along = (sample.x - centerX) / width;
    if (Math.abs(along) > 1) continue;
    const envelope = Math.sqrt(Math.max(0, 1 - along * along));
    const height = Math.max(2, thickness * envelope);
    pixelRect(sample.x - 1, sample.y - height + 1, 2, height, 'rgba(31,53,39,' + (alpha * (.45 + .55 * envelope)) + ')', 2);
  }
}

function drawBike() {
  const mx=(rear.x+front.x)/2,my=(rear.y+front.y)/2;
  const angle=Math.atan2(front.y-rear.y,front.x-rear.x);
  const length=Math.hypot(front.x-rear.x,front.y-rear.y);
  const ground=terrain(mx,my);
  if(ground.solid){
    const light=sunLight({ width: W, cameraX, cameraY, weather: level.weather });
    const heightAboveGround=Math.max(0,ground.y-my-RADIUS);
    const shadowAlpha=clamp(.22-heightAboveGround/700,.035,.22);
    const shadowWidth=clamp(35-heightAboveGround*.07,13,35);
    const offset=sunShadowOffset({
      bikeX: mx - cameraX, bikeY: my - cameraY, sunX: light.x, sunY: light.y,
      height: heightAboveGround, strength: light.strength
    });
    const center=mx+offset;
    const samples=groundShadowSamples(level, mx, my, shadowWidth, 2, center).flat();
    drawShadowBlob(samples, center, shadowWidth, shadowAlpha, 4);
    drawShadowBlob(samples, center + Math.sign(offset) * 3, shadowWidth * .7, shadowAlpha * .55, 2);
  }
  drawPixelBike(mx,my,angle,length);
}

function updateParticles(dt) {
  for (const mark of skidMarks) mark.life -= dt;
  for (const p of particles) {
    p.life -= dt;
    if (p.drag) p.vx *= Math.exp(-p.drag * dt);
    p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 210 * dt;
    if (p.splatter) {
      const ground = terrain(p.x);
      if (ground.solid && p.y > ground.y - 1) {
        p.y = ground.y - 1;
        p.vx *= .45; p.vy = -Math.abs(p.vy) * .16;
        p.life = Math.min(p.life, .16);
      }
    }
  }
}

function drawSkidMarks() {
  for (const mark of skidMarks) {
    const length = mark.length * mark.direction;
    ctx.globalAlpha = clamp(mark.life / mark.max, 0, 1) * .42;
    pixelPath([
      [mark.x - length, mark.y - mark.slope * length],
      [mark.x, mark.y]
    ], '#263b36', 1, 2);
  }
  ctx.globalAlpha = 1;
}

function drawParticles(splatter) {
  for (const p of particles) {
    if (Boolean(p.splatter) !== splatter) continue;
    ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
    pixelRect(p.x, p.y, p.size || 4, p.size || 4, p.color, 2);
  }
  ctx.globalAlpha = 1;
}

function drawRagdoll() {
  if(!ragdoll)return;
  const p=ragdoll.points,isMaxine=rider==='Maxine';
  const trousers=isMaxine?'#39435d':'#29464e';
  const jacket=isMaxine?'#d86f82':'#e8e5d9';
  const sleeve=isMaxine?'#ef9aa8':'#fff8e7';
  const helmet=isMaxine?'#63aa98':'#f4a442';
  pixelPath([[p.foot.x,p.foot.y],[p.knee.x,p.knee.y],[p.hip.x,p.hip.y]],trousers,3);
  pixelPath([[p.hip.x,p.hip.y],[p.shoulder.x,p.shoulder.y]],jacket,4);
  pixelPath([[p.shoulder.x,p.shoulder.y],[p.elbow.x,p.elbow.y]],sleeve,2);
  pixelPath([[p.elbow.x,p.elbow.y],[p.hand.x,p.hand.y]],'#bd7954',2);
  pixelPath([[p.shoulder.x,p.shoulder.y],[p.head.x,p.head.y]],'#bd7954',2);

  pixelRect(p.head.x-7,p.head.y-7,14,14,'#263b36',2);
  pixelRect(p.head.x-5,p.head.y-7,12,10,helmet,2);
  pixelRect(p.head.x+3,p.head.y-3,8,4,'#234844',2);
}

function drawWeather() {
  const rainIntensity = clamp(Number(level.weather?.rain) || 0, 0, 1);
  if (!rainIntensity && lightningFlash <= 0) return;

  ctx.save();
  if (rainIntensity) {
    const count = Math.round((45 + rainIntensity * 95) * clamp(W / 760, .7, 1.5));
    const motion = reducedMotion ? 0 : weatherTime * 720;
    ctx.fillStyle = `rgba(33, 52, 61, ${.04 + rainIntensity * .08})`;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = `rgba(205, 225, 224, ${.22 + rainIntensity * .3})`;
    ctx.lineWidth = rainIntensity > .6 ? 1.4 : 1;
    ctx.beginPath();
    for (let index = 0; index < count; index++) {
      const seedX = (index * 97.31) % (W + 80);
      const seedY = (index * 53.17) % (H + 100);
      const speed = .72 + (index % 7) * .055;
      const y = (seedY + motion * speed) % (H + 70) - 35;
      const rainWidth = W + 80;
      const rawX = seedX - motion * .13 + y * .08;
      const x = ((rawX % rainWidth) + rainWidth) % rainWidth - 40;
      const length = 7 + rainIntensity * 8 + (index % 4);
      ctx.moveTo(x, y);
      ctx.lineTo(x - length * .22, y + length);
    }
    ctx.stroke();
  }
  if (lightningFlash > 0) {
    ctx.fillStyle = `rgba(225, 239, 237, ${lightningFlash * .28})`;
    ctx.fillRect(0, 0, W, H);
    if (lightningFlash > .3 && !reducedMotion) {
      const proximity = 1 - lightningDistance;
      const startX = lightningX * W;
      ctx.strokeStyle = `rgba(246, 244, 204, ${lightningFlash})`;
      ctx.lineWidth = 1.2 + proximity * 2.3;
      ctx.beginPath(); ctx.moveTo(startX, 0);
      for (let step = 1; step <= 6; step++) {
        const y = step * H * .085;
        const offset = Math.sin(lightningX * 91 + step * 7.3) * 16;
        ctx.lineTo(startX + offset, y);
      }
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawPhysicsOverlay() {
  if (!physicsDebugEnabled || !vehicle) return;
  const { chassis, constraints } = vehicle;
  ctx.save();
  ctx.globalAlpha = .85;
  ctx.lineWidth = 1;
  for (const constraint of [...constraints, vehicle.wheelbaseLimit]) {
    if (constraint.type !== 'distance') continue;
    ctx.strokeStyle = constraint.minLength !== null || constraint.maxLength !== null ? '#f0b45f' : '#83d1ce';
    ctx.beginPath(); ctx.moveTo(constraint.a.x, constraint.a.y); ctx.lineTo(constraint.b.x, constraint.b.y); ctx.stroke();
  }
  for (const point of Object.values(chassis)) {
    ctx.fillStyle = '#fff3be'; ctx.beginPath(); ctx.arc(point.x, point.y, 3, 0, TAU); ctx.fill();
  }
  for (const point of [rear, front]) {
    if (!point.contact) continue;
    ctx.strokeStyle = '#e65e56'; ctx.beginPath(); ctx.moveTo(point.x, point.y);
    ctx.lineTo(point.x + point.contact.nx * 24, point.y + point.contact.ny * 24); ctx.stroke();
  }
  const center = vehicleMetrics(vehicle).center;
  ctx.strokeStyle = '#ff8952'; ctx.beginPath();
  ctx.moveTo(center.x - 5, center.y); ctx.lineTo(center.x + 5, center.y);
  ctx.moveTo(center.x, center.y - 5); ctx.lineTo(center.x, center.y + 5); ctx.stroke();
  ctx.restore();
}

function render(now, dt) {
  const center = vehicleMetrics(vehicle).center;
  let focusX=center.x,focusY=center.y;
  if(ragdoll){
    const points=Object.values(ragdoll.points);
    focusX=points.reduce((sum,p)=>sum+p.x,0)/points.length;
    focusY=points.reduce((sum,p)=>sum+p.y,0)/points.length;
  }
  const lead = clamp(W * .3, 95, W / 2);
  const targetX = Math.max(0, ragdoll ? focusX-W/2 : focusX-(facing > 0 ? lead : W-lead));
  const targetY = clamp(focusY-H*.67,-H*.42,ragdoll?500:100);
  const smoothing = 1 - Math.exp(-8 * dt);
  const flipSmoothing = reducedMotion ? 1 : 1 - Math.exp(-18 * dt);
  flipVisual = lerp(flipVisual, facing, flipSmoothing);
  if (Math.abs(flipVisual - facing) < .002) flipVisual = facing;
  cameraX = lerp(cameraX,targetX,smoothing);
  cameraY = lerp(cameraY,targetY,smoothing);
  drawBackground();
  ctx.save(); ctx.translate(-cameraX,-cameraY);
  const animationDt = state === 'paused' ? 0 : dt;
  updateParticles(animationDt);
  drawTerrain(); drawSkidMarks(); drawSceneryShadows(now); drawProps('back'); drawParticles(true); drawFlag();
  apples.forEach(a => drawApple(a,now));
  updateHair(animationDt);
  drawHair();
  drawBike();
  drawPhysicsOverlay();
  drawRagdoll();
  drawProps('front');
  drawParticles(false);
  particles = particles.filter(p => p.life > 0);
  skidMarks = skidMarks.filter(mark => mark.life > 0);
  ctx.restore();
  drawWeather();
  if (toastUntil && now > toastUntil) {
    $('toast').classList.remove('visible'); toastUntil = 0;
  }
}

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const rect = canvas.getBoundingClientRect();
  const worldScale = clamp(rect.width / 760, 1, 1.45);
  W = Math.max(320, rect.width / worldScale);
  H = Math.max(340, rect.height / worldScale);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr * worldScale,0,0,dpr * worldScale,0,0);
  ctx.imageSmoothingEnabled = false;
}

actionButtons.forEach(button => {
  button.addEventListener('pointerdown', e => {
    if (state !== 'running') return;
    e.preventDefault();
    focusGame();
    const action = button.dataset.action;
    if (action === 'flip') {
      flipDirection();
      return;
    }
    button.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, action);
    paintInput();
  });
  const release = e => { pointers.delete(e.pointerId); paintInput(); };
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('lostpointercapture', release);
  button.addEventListener('contextmenu', e => e.preventDefault());
});

game.addEventListener('keydown', e => {
  if (e.code === 'Escape') {
    e.preventDefault();
    sounds.escape();
    if (!$('menu-screen').hidden) closeMainMenu();
    else if (state === 'paused') resumeGame();
    else showMainMenu();
    return;
  }
  if (!$('menu-screen').hidden) return;
  if (e.code === 'KeyR') {
    e.preventDefault(); if (!e.repeat) startFresh(); return;
  }
  if (e.code === 'KeyP') {
    e.preventDefault(); if (!e.repeat) togglePause(); return;
  }
  if (state !== 'running') return;
  if (e.code === 'Space') {
    e.preventDefault();
    if (!e.repeat) flipDirection();
    return;
  }
  if (!keyActions[e.code]) return;
  e.preventDefault();
  keys.add(e.code); paintInput();
});
// Auto-pause fires when focus leaves the game, so resuming must not need it.
document.addEventListener('keydown', e => {
  if (game.contains(e.target) || state !== 'paused') return;
  if (e.code === 'KeyP' || e.code === 'Escape') { e.preventDefault(); resumeGame(); }
});
window.addEventListener('keyup', e => {
  if (keys.has(e.code)) { keys.delete(e.code); paintInput(); }
});
game.addEventListener('focusout', e => {
  if (!game.contains(e.relatedTarget)) { clearInput(); pauseGame(); }
});
canvas.addEventListener('pointerdown', () => focusGame());
window.addEventListener('blur', () => { clearInput(); pauseGame(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clearInput(); pauseGame(); }
  lastTime = 0; accumulator = 0;
});

$('primary').addEventListener('click', () => {
  if (state === 'won') {
    if (levelSource === 'custom') startFresh();
    else { loadLevel((levelIndex + 1) % levels.length); setOverlay('running'); focusGame(); }
  } else startFresh();
});
$('secondary').addEventListener('click', startFresh);
$('menu-how-to').addEventListener('click', () => showMenuView('how'));
$('menu-editor').addEventListener('click', () => { window.location.href = './editor.html'; });
$('menu-settings').addEventListener('click', () => {
  applyPreferences();
  showMenuView('settings');
});
$('menu-fullscreen').addEventListener('click', toggleFullscreen);
$('fullscreen').addEventListener('click', toggleFullscreen);
$('menu').addEventListener('click', () => { sounds.menuBack(); showMainMenu(); });
$('menu-screen').addEventListener('keydown', event => {
  const trailStep = { ArrowLeft: -1, KeyA: -1, ArrowRight: 1, KeyD: 1 }[event.code];
  if (trailStep && !$('menu-leaderboard-view').hidden) {
    event.preventDefault();
    stepLeaderboard(trailStep);
    sounds.menuMove();
    return;
  }
  const direction = {
    ArrowUp: -1, ArrowLeft: -1, KeyW: -1, KeyA: -1,
    ArrowDown: 1, ArrowRight: 1, KeyS: 1, KeyD: 1
  }[event.code];
  if (!direction) return;
  const controls = menuControls();
  if (!controls.length) return;
  event.preventDefault();
  const selected = $('menu-screen').querySelector('.menu-selected');
  const current = controls.indexOf(selected);
  const next = current < 0 ? 0 : (current + direction + controls.length) % controls.length;
  selectMenuControl(controls[next]);
  sounds.menuMove();
});
$('menu-screen').addEventListener('focusin', event => {
  const button = event.target.closest('button');
  if (!button?.closest('.menu-view')) return;
  document.querySelectorAll('.menu-selected').forEach(control => control.classList.remove('menu-selected'));
  button.classList.add('menu-selected');
});
$('menu-screen').addEventListener('pointerover', event => {
  const button = event.target.closest('button');
  if (event.pointerType === 'mouse' && button && !button.contains(event.relatedTarget)) {
    if (button.closest('.menu-view')) selectMenuControl(button);
    sounds.menuMove();
  }
});
$('menu-screen').addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.matches('[data-menu-back]')) sounds.menuBack();
  else if (button.id === 'create-save' || button.id === 'menu-start') sounds.menuConfirm();
  else sounds.menuSelect();
});
function showSaveCreator(slotIndex = activeSaveSlot) {
  pendingSaveSlot = slotIndex;
  $('new-save-slot-label').textContent = 'SAVE SLOT ' + (pendingSaveSlot + 1);
  $('create-save').textContent = 'Create Save & Ride →';
  showMenuView('save');
}
$('menu-start').addEventListener('click', () => closeMenuForLevel(savedLevel));
$('menu-new-game').addEventListener('click', () => {
  const emptySlot = saveSlots.findIndex(save => !save);
  if (emptySlot < 0) {
    $('load-game-help').textContent = 'All three slots are occupied. Delete a savegame before starting a new one.';
    showMenuView('load');
    return;
  }
  showSaveCreator(emptySlot);
});
$('menu-load-game').addEventListener('click', () => {
  $('load-game-help').textContent = 'Select a savegame to make it active. Empty slots can be used for a new game.';
  buildSaveSlots();
  showMenuView('load');
});
$('menu-levels').addEventListener('click', () => { buildMenuLevelCards(); showMenuView('levels'); });
$('menu-leaderboard').addEventListener('click', () => {
  leaderboardTrail = currentLeaderboardTrail();
  buildLeaderboard();
  showMenuView('leaderboard');
});
$('leaderboard-prev').addEventListener('click', () => stepLeaderboard(-1));
$('leaderboard-next').addEventListener('click', () => stepLeaderboard(1));
document.querySelectorAll('[data-menu-back]').forEach(button => button.addEventListener('click', () => {
  updateMenuDashboard();
  showMenuView('home');
}));
document.querySelectorAll('[data-rider]').forEach(button => button.addEventListener('click', () => {
  selectedNewRider = button.dataset.rider;
  document.querySelectorAll('[data-rider]').forEach(choice => choice.setAttribute('aria-pressed', String(choice === button)));
}));
$('create-save').addEventListener('click', () => {
  saveGame = createSave(pendingSaveSlot, selectedNewRider, levels.length);
  if (!saveGame) { showMenuView('load'); return; }
  activeSaveSlot = pendingSaveSlot;
  saveActiveSlot(activeSaveSlot);
  saveSlots[activeSaveSlot] = saveGame;
  rider = saveGame.rider;
  unlockedLevel = 0; savedLevel = 0;
  closeMenuForLevel(0);
});
document.querySelectorAll('[data-setting]').forEach(button => {
  button.addEventListener('click', () => {
    preferences[button.dataset.setting] = button.dataset.value;
    applyPreferences(); savePreferences(); drawMenuBackground();
  });
});
$('restart').addEventListener('click', startFresh);
window.addEventListener('resize', () => { resizeCanvas(); drawMenuBackground(); });
const fullscreenSupported = Boolean(document.fullscreenEnabled || document.webkitFullscreenEnabled || game.webkitRequestFullscreen);
$('fullscreen').hidden = !fullscreenSupported;
$('menu-fullscreen').hidden = !fullscreenSupported;
const handleFullscreenChange = () => {
  updateFullscreenControls();
  requestAnimationFrame(() => { resizeCanvas(); drawMenuBackground(); });
};
document.addEventListener('fullscreenchange', handleFullscreenChange);
document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
updateFullscreenControls();
if ('ResizeObserver' in window) new ResizeObserver(resizeCanvas).observe(canvas);

function frame(now) {
  const dt = lastTime ? Math.min((now-lastTime)/1000,.05) : 1/60;
  lastTime = now;
  if (state === 'running' || state === 'ragdoll') {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= STEP) {
      physics(); accumulator -= STEP;
      if (state !== 'running' && state !== 'ragdoll') { accumulator = 0; break; }
      // Drop time a slow frame cannot catch up on instead of spiralling.
      if (++steps >= MAX_STEPS_PER_FRAME) { accumulator = Math.min(accumulator, STEP); break; }
    }
  } else accumulator = 0;
  updateHud(); sounds.update(); render(now,dt);
  requestAnimationFrame(frame);
}

const unlockAudio = () => sounds.init();
window.addEventListener('pointerdown', unlockAudio, { once: true, capture: true });
window.addEventListener('keydown', unlockAudio, { once: true, capture: true });

loadStoredState(); applyPreferences(); savePreferences();
resizeCanvas(); showMainMenu();
