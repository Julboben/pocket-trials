import {
  STEP, RADIUS, WHEELBASE, TAU, GRAVITY, MAX_DRIVE_SPEED, MAX_POINT_SPEED,
  ENGINE_FORCE, BRAKE_FORCE, GROUND_LEAN_TORQUE, AIR_LEAN_TORQUE,
  COAST_RESISTANCE_LOW_SPEED, COAST_RESISTANCE_HIGH_SPEED,
  COAST_SPEED_REFERENCE, UPHILL_TORQUE_BOOST, clamp, lerp
} from './config.js';
import { levels } from './levels.js';
import { createAudio } from './audio.js';
import { createDrawingTools, createGameArt } from './drawing.js';
import { terrainAt } from './terrain.js';
import {
  loadPreferences,
  loadSaveSlots,
  loadActiveSlot,
  saveActiveSlot,
  createSave,
  deleteSave,
  readBest,
  saveBest,
  savePreferences as persistPreferences,
  saveProgress as persistProgress
} from './storage.js';

(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const game = $('game');
  const canvas = $('canvas');
  const ctx = canvas.getContext('2d');
  const { line, circle, pixelRect, pixelPath, drawPixelDisc } = createDrawingTools(ctx);
  const gameArt = createGameArt(ctx);
  let W = 380, H = 410;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let levelIndex = 0, level = levels[0], state = 'menu', stateBeforeMenu = 'ready', rider = 'max';
  let unlockedLevel = 0, savedLevel = 0, saveGame = null;
  let saveSlots = [null, null, null], activeSaveSlot = 0, pendingSaveSlot = 0, selectedNewRider = 'max', gameLoopStarted = false;
  let deleteArmedSlot = -1, deleteArmTimer = 0;
  let preferences = { scenery: 'full', controls: 'show', sound: 'on' };
  let rear, front, apples = [], particles = [], skidMarks = [], ragdoll = null, hair = null;
  let elapsed = 0, collected = 0, facing = 1, throttle = 0, brakePressure = 0;
  let weatherTime = 0, nextLightning = Infinity, lightningFlash = 0, lightningX = .5, lightningDistance = .5;
  let cameraX = 0, cameraY = 0, leanControl = 0, leanVisual = 0, flipVisual = 1;
  let lastTime = 0, accumulator = 0, sprayAccumulator = 0, skidAccumulator = 0, landingSoundCooldown = 0, airRotation = 0, airTurnMilestone = 0, previousAirAngle = 0, lastGateNotice = -10, toastUntil = 0;
  let lastProgress = -1, lastTimer = '';
  const sounds = createAudio(() => ({ state, rear, front, throttle, brakePressure, weather: level?.weather }));
  const keys = new Set();
  const pointers = new Map();
  const actionButtons = [...document.querySelectorAll('[data-action]')];
  const keyActions = {
    ArrowUp:'up', KeyW:'up', ArrowDown:'down', KeyS:'down',
    ArrowLeft:'back', KeyA:'back', ArrowRight:'forward', KeyD:'forward'
  };


  function timeText(seconds) {
    const tenths = Math.floor(seconds * 10 + 0.00001);
    return Math.floor(tenths / 600) + ':' + String(Math.floor(tenths / 10) % 60).padStart(2, '0') + '.' + (tenths % 10);
  }
  function savePreferences() { persistPreferences(preferences); }
  function saveProgress() {
    if (!saveGame) return;
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
    const art = createGameArt(artCtx);
    artCtx.fillStyle = '#eae9d9'; artCtx.fillRect(0, 0, 120, 84);
    artCtx.fillStyle = '#c5b496';
    artCtx.beginPath(); artCtx.moveTo(0,72); artCtx.quadraticCurveTo(30,58,60,69); artCtx.quadraticCurveTo(90,78,120,58); artCtx.lineTo(120,84); artCtx.lineTo(0,84); artCtx.fill();
    artCtx.strokeStyle = '#375d4d'; artCtx.lineWidth = 5; artCtx.beginPath(); artCtx.moveTo(0,72); artCtx.quadraticCurveTo(30,58,60,69); artCtx.quadraticCurveTo(90,78,120,58); artCtx.stroke();
    art.drawBike({
      rear: { x: 35, y: 61, spin: 0, compression: 0 },
      front: { x: 85, y: 65, spin: 0, compression: 0 },
      mx: 60, my: 63, angle: Math.atan2(4, 50), length: 50, rider
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
      const bike = (rear, front, lean = 0) => art.drawBike({
        rear: { x: rear[0], y: rear[1], spin: 0, compression: 0 },
        front: { x: front[0], y: front[1], spin: 0, compression: 0 },
        mx: (rear[0] + front[0]) / 2,
        my: (rear[1] + front[1]) / 2,
        angle: Math.atan2(front[1] - rear[1], front[0] - rear[0]),
        length: Math.hypot(front[0] - rear[0], front[1] - rear[1]),
        leanVisual: lean,
        rider
      });

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
    $('menu-levels').disabled = !hasSave;
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
    $('menu-save-view').hidden = view !== 'save';
    $('menu-how-view').hidden = view !== 'how';
    $('menu-settings-view').hidden = view !== 'settings';
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
    $('pause').disabled = true;
    game.classList.add('menu-open');
    $('menu-screen').hidden = false;
    updateMenuDashboard(); showMenuView('home');
    requestAnimationFrame(() => selectMenuControl($(saveGame ? 'menu-start' : 'menu-new-game')));
  }

  function closeMainMenu() {
    if (!gameLoopStarted || !saveGame) return;
    $('menu-screen').hidden = true;
    game.classList.remove('menu-open');
    setOverlay(stateBeforeMenu === 'paused' ? 'paused' : 'running');
    focusGame();
  }

  function closeMenuForLevel(index) {
    if (!saveGame) return;
    $('menu-screen').hidden = true;
    game.classList.remove('menu-open');
    loadLevel(index);
    setOverlay('running');
    focusGame();
    if (!gameLoopStarted) {
      gameLoopStarted = true;
      lastTime = 0;
      requestAnimationFrame(frame);
    }
  }

  function buildMenuLevelCards() {
    const cards = levels.map((trail, index) => {
      const button = document.createElement('button');
      const locked = !saveGame || index > unlockedLevel;
      const best = readBest(activeSaveSlot, index, levels.length);
      button.className = 'level-card';
      button.disabled = locked;
      button.innerHTML = '<span class="level-number">' + String(index + 1).padStart(2, '0') + '</span>'
        + '<span class="level-copy"><strong>' + trail.name.toUpperCase() + '</strong><small>' + (locked ? 'LOCKED' : (index === savedLevel ? 'CURRENT TRAIL' : 'UNLOCKED')) + '</small></span>'
        + '<span class="level-best">' + (best === null ? '—' : timeText(best)) + '</span>';
      if (!locked) button.addEventListener('click', () => closeMenuForLevel(index));
      return button;
    });
    $('menu-level-grid').replaceChildren(...cards);
  }

  // Keep the active level binding local while terrain math remains reusable.
  const terrain = x => terrainAt(level, x);

  function wheel(x) {
    const y = terrain(x).y - RADIUS;
    return { x, y, ox: x, oy: y, grounded: true, spin: 0, compression: 0, springVelocity: 0, impactSpeed: 0 };
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

  function loadLevel(index) {
    index = clamp(index, 0, unlockedLevel);
    levelIndex = index; level = levels[index];
    rear = wheel(65); front = wheel(115);
    apples = level.apples.map(x => ({ x, y: terrain(x).y - 60, taken: false }));
    particles = []; skidMarks = []; ragdoll = null; hair = null; elapsed = 0; collected = 0; facing = 1; throttle = 0; brakePressure = 0;
    weatherTime = 0; lightningFlash = 0; lightningX = .5; lightningDistance = .5;
    nextLightning = level.weather?.lightning ? 2.5 + Math.random() * 4 : Infinity;
    cameraX = 0; cameraY = 0; leanControl = 0; leanVisual = 0; flipVisual = 1;
    accumulator = 0; sprayAccumulator = 0; skidAccumulator = 0; landingSoundCooldown = 0;
    airRotation = 0; airTurnMilestone = 0; previousAirAngle = 0;
    lastGateNotice = -10; lastProgress = -1; lastTimer = '';
    clearInput(); updateDirectionControls();
    $('scene-label').textContent = level.name.toUpperCase();
    $('scene-label').dataset.trailNumber = String(index + 1).padStart(2, '0');
    $('apple-count').textContent = '0 / ' + apples.length;
    $('toast').classList.remove('visible'); toastUntil = 0;
    updateHud(); saveProgress();
  }

  function setOverlay(next) {
    state = next; clearInput();
    const visible = next !== 'running';
    $('overlay').hidden = !visible;
    $('pause').disabled = !['running','paused'].includes(next);
    $('pause').setAttribute('aria-label', next === 'paused' ? 'Resume game' : 'Pause game');
    $('secondary').hidden = next === 'running';
    if (visible) requestAnimationFrame(() => $('primary').focus({ preventScroll: true }));

    if (next === 'paused') {
      $('overlay-badge').textContent = 'PAUSED';
      $('overlay-title').textContent = 'Game Paused';
      $('overlay-description').textContent = 'Resume when you are ready, or restart the current trail.';
      $('primary').textContent = 'Resume →';
      $('secondary').textContent = 'Restart Trail';
    } else if (next === 'crashed') {
      $('overlay-badge').textContent = 'CRASHED';
      $('overlay-title').textContent = 'Wiped Out';
      $('overlay-description').textContent = 'Your helmet hit the ground. Reset and give the trail another run.';
      $('primary').textContent = 'Try Again ↗';
      $('secondary').textContent = 'Change Trail';
      $('announcer').textContent = 'Crashed. Press R or select Try Again to retry.';
    } else if (next === 'won') {
      unlockedLevel = Math.max(unlockedLevel, Math.min(levelIndex + 1, levels.length - 1));
      saveProgress();
      $('overlay-badge').textContent = 'TRAIL COMPLETED';
      $('overlay-title').textContent = 'Goal Reached!';
      const previous = readBest(activeSaveSlot, levelIndex, levels.length);
      const record = previous === null || elapsed < previous;
      if (record) {
        saveBest(activeSaveSlot, levelIndex, elapsed, levels.length);
        saveGame.bestTimes[levelIndex] = elapsed;
      }
      $('overlay-description').textContent = 'Finished in ' + timeText(elapsed) + '. ' + (record ? 'New best time on this trail!' : 'Best: ' + timeText(previous) + '.');
      $('primary').textContent = levelIndex === levels.length - 1 ? 'Play Again →' : 'Next Trail →';
      $('secondary').textContent = 'Replay Trail';
      $('announcer').textContent = 'Trail complete in ' + timeText(elapsed) + '. All ' + apples.length + ' apples collected.';
    }
  }

  function startFresh() { loadLevel(levelIndex); setOverlay('running'); focusGame(); }
  function pauseGame() { if (state === 'running') setOverlay('paused'); }
  function notify(message, duration = 2600) {
    $('toast').textContent = message;
    toastUntil = duration === Infinity ? Infinity : performance.now() + duration;
    $('toast').classList.add('visible');
  }

  function headPosition() {
    const angle = Math.atan2(front.y - rear.y, front.x - rear.x);
    const c = Math.cos(angle), s = Math.sin(angle);
    const riderShift = leanVisual * 9;
    const backCompression = facing > 0 ? rear.compression : front.compression;
    const frontCompression = facing > 0 ? front.compression : rear.compression;
    const bodyDrop = (backCompression + frontCompression) * .4;
    const bodyPitch = (frontCompression - backCompression) * .0096;
    const pc = Math.cos(bodyPitch), ps = Math.sin(bodyPitch);
    const localX = (3 + riderShift) * pc + 43 * ps;
    const localY = (3 + riderShift) * ps - 43 * pc + bodyDrop;
    const facingX = localX * facing;
    return {
      x: (rear.x + front.x) / 2 + c * facingX - s * localY,
      y: (rear.y + front.y) / 2 + s * facingX + c * localY
    };
  }

  // Verlet integration: two tires joined by an elastic distance constraint.
  function integrate(p, drive, speedLimit, lean, leanTorque, driveGrip, brakeGrip, braking, coasting) {
    let vx = (p.x - p.ox) * (p.grounded ? .9997 : .9998);
    let vy = (p.y - p.oy) * .9998;
    let ax = 0, ay = GRAVITY;

    if (p.grounded) {
      const slope = terrain(p.x).slope;
      const length = Math.hypot(1, slope);
      const tx = 1 / length, ty = slope / length;
      const tangentialVelocity = vx * tx + vy * ty;

      if (braking) {
        // Both wheels brake, with a stronger front-wheel bias. Clamping the
        // low-speed velocity makes the brake hold instead of merely adding drag.
        const brakeStep = BRAKE_FORCE * brakeGrip * STEP * STEP;
        const reduction = clamp(tangentialVelocity, -brakeStep, brakeStep);
        vx -= tx * reduction;
        vy -= ty * reduction;
      } else if (coasting) {
        // Rolling resistance is strongest near rest, so shallow valleys settle,
        // while high-speed momentum still carries over long hills and jumps.
        const coastSpeed = Math.abs(tangentialVelocity) / STEP;
        const climbing = tangentialVelocity * slope < 0;
        const baseResistance = lerp(COAST_RESISTANCE_LOW_SPEED, COAST_RESISTANCE_HIGH_SPEED, clamp(coastSpeed / COAST_SPEED_REFERENCE, 0, 1));
        const resistance = baseResistance * (climbing ? .18 : 1);
        const reduction = clamp(tangentialVelocity, -resistance * STEP * STEP, resistance * STEP * STEP);
        vx -= tx * reduction;
        vy -= ty * reduction;
      } else if (drive) {
        const tangentialSpeed = tangentialVelocity / STEP;
        const speedRatio = clamp(tangentialSpeed * Math.sign(drive) / speedLimit, 0, 1);
        if (speedRatio < 1) {
          const torqueCurve = .28 + .72 * (1 - speedRatio);
          const uphillLoad = clamp(-slope * Math.sign(drive), 0, 1);
          const climbTorque = 1 + uphillLoad * UPHILL_TORQUE_BOOST * (1 - speedRatio);
          const power = drive * driveGrip * torqueCurve * climbTorque;
          ax += tx * power;
          ay += ty * power;
        }
      }
    }

    const dx = front.x - rear.x, dy = front.y - rear.y;
    const length = Math.hypot(dx, dy) || WHEELBASE;
    const sign = p === front ? 1 : -1;
    ax += (-dy / length) * lean * leanTorque * sign;
    ay += ( dx / length) * lean * leanTorque * sign;

    const speed = Math.hypot(vx, vy);
    if (speed > MAX_POINT_SPEED * STEP) { vx *= MAX_POINT_SPEED * STEP / speed; vy *= MAX_POINT_SPEED * STEP / speed; }
    p.ox = p.x; p.oy = p.y;
    p.x += vx + ax * STEP * STEP;
    p.y += vy + ay * STEP * STEP;
    p.grounded = false;
  }

  function collide(p) {
    const t = terrain(p.x);
    if (!t.solid) return;
    const length = Math.hypot(t.slope, 1);
    const nx = t.slope / length, ny = -1 / length;
    const penetration = RADIUS + (p.y - t.y) / length;
    if (penetration > 0) {
      let vx = p.x - p.ox, vy = p.y - p.oy;
      const intoGround = vx * nx + vy * ny;
      if (intoGround < 0) {
        const impactSpeed = -intoGround / STEP;
        p.impactSpeed = Math.max(p.impactSpeed, impactSpeed);
        const restitution = impactSpeed > 35 ? clamp(.08 + impactSpeed / 1200, .08, .22) : 0;
        vx -= nx * intoGround * (1 + restitution);
        vy -= ny * intoGround * (1 + restitution);
        if (impactSpeed > 12) {
          p.compression = clamp(p.compression + (impactSpeed - 12) * .065, 0, 16);
          p.springVelocity += impactSpeed * .018;
        }
      }
      p.x += nx * penetration;
      p.y += ny * penetration;
      p.ox = p.x - vx;
      p.oy = p.y - vy;
      p.grounded = true;
    }
    if (p.x < RADIUS) {
      const vx = Math.max(0, p.x - p.ox);
      p.x = RADIUS;
      p.ox = p.x - vx;
    }
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
    $('pause').disabled=true;
    $('announcer').textContent='Rider down. Press R or select the restart button to try again.';
    notify('Rider down · Press R to retry', Infinity);
  }
  function collideRagdollPoint(p) {
    const t=terrain(p.x);
    if(!t.solid)return;
    const length=Math.hypot(t.slope,1),nx=t.slope/length,ny=-1/length;
    const penetration=p.radius+(p.y-t.y)/length;
    if(penetration<=0)return;
    let vx=p.x-p.ox,vy=p.y-p.oy;
    const normal=vx*nx+vy*ny;
    if(normal<0){vx-=nx*normal*1.12;vy-=ny*normal*1.12;}
    const tangentX=-ny,tangentY=nx,tangent=vx*tangentX+vy*tangentY;
    vx-=tangentX*tangent*.16;vy-=tangentY*tangent*.16;
    p.x+=nx*penetration;p.y+=ny*penetration;p.ox=p.x-vx;p.oy=p.y-vy;
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
      for(const p of Object.values(ragdoll.points))collideRagdollPoint(p);
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
      const ground = terrain(wheelPoint.x);
      const length = clamp(speed * .035 * brakePressure, 3, 10);
      skidMarks.push({
        x: wheelPoint.x, y: ground.y - 1, slope: ground.slope,
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
      const color = level.spray[Math.floor(Math.random() * level.spray.length)];
      const life = .28 + Math.random() * .32;
      particles.push({
        x: contactWheel.x - direction * (RADIUS - 2),
        y: terrain(contactWheel.x).y - 2,
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
    for (const p of [rear, front]) {
      p.springVelocity += -42 * p.compression * STEP;
      p.springVelocity *= Math.exp(-6.4 * STEP);
      p.compression += p.springVelocity * STEP;
      if (p.compression <= 0) { p.compression = 0; p.springVelocity = 0; }
    }

    const leanInput = Number(down('forward')) - Number(down('back'));
    const leanTarget = leanInput;
    leanControl = lerp(leanControl, leanTarget, 1 - Math.exp(-5.8 * STEP));
    const acceptingInput = state === 'running';
    const accelerating = acceptingInput && down('up'), braking = acceptingInput && down('down');
    const coasting = !accelerating && !braking;
    const throttleTarget = accelerating && !braking ? 1 : 0;
    const throttleRate = throttleTarget > throttle ? 1.1 : 4;
    throttle = lerp(throttle, throttleTarget, 1 - Math.exp(-throttleRate * STEP));
    brakePressure = lerp(brakePressure, braking ? 1 : 0, 1 - Math.exp(-(braking ? 10 : 14) * STEP));
    const speedLimit = MAX_DRIVE_SPEED;
    const grounded = rear.grounded || front.grounded;
    const bikeSpeed = ((rear.x - rear.ox) + (front.x - front.ox)) / (2 * STEP);
    const speedFactor = clamp(Math.abs(bikeSpeed) / 300, 0, 1);
    const midSlope = terrain((rear.x + front.x) / 2).slope;
    const uphill = clamp(-midSlope * facing, 0, 1);
    const downhill = clamp(midSlope * facing, 0, 1);
    const forwardLean = clamp(leanControl * facing, 0, 1);
    const drive = facing * ENGINE_FORCE * throttle * (1 + uphill * forwardLean * .25);
    // Front bias grows with speed while the rear remains useful for stability.
    const frontBrakeGrip = (.72 + speedFactor * .28) * brakePressure;
    const rearBrakeGrip = (.55 - speedFactor * .2) * brakePressure;
    // Braking pitches with travel; rear-wheel drive reacts the other way.
    // Downhill speed transfers additional weight onto the front wheel.
    const brakePitch = braking && grounded
      ? clamp(bikeSpeed / 220 * brakePressure * (1 + downhill * .55), -1.2, 1.2)
      : 0;
    const throttlePitch = accelerating && !braking && grounded
      ? -facing * throttle * (.2 + uphill * .95) * (1 - forwardLean * .7)
      : 0;
    const effectiveLean = clamp(leanControl + brakePitch + throttlePitch, -1.45, 1.45);
    // On the ground the rider's shifted weight can unload either wheel;
    // in the air, lower torque keeps rotation deliberate and momentum-led.
    const leanTorque = grounded ? GROUND_LEAN_TORQUE : AIR_LEAN_TORQUE;

    // Mild angular damping makes small corrective taps more controllable.
    const dx = front.x - rear.x, dy = front.y - rear.y;
    const length = Math.hypot(dx, dy) || WHEELBASE;
    const px = -dy / length, py = dx / length;
    const relative = ((front.x - front.ox) - (rear.x - rear.ox)) * px
      + ((front.y - front.oy) - (rear.y - rear.oy)) * py;
    const dampingRate = Math.abs(effectiveLean) > .02 ? .001 : coasting && Math.abs(bikeSpeed) < 60 ? .01 : .005;
    const damping = relative * dampingRate;
    front.ox += px * damping; front.oy += py * damping;
    rear.ox -= px * damping; rear.oy -= py * damping;

    integrate(rear, drive, speedLimit, effectiveLean, leanTorque, facing > 0 ? 1 : 0, facing > 0 ? rearBrakeGrip : frontBrakeGrip, braking, coasting);
    integrate(front, drive, speedLimit, effectiveLean, leanTorque, facing > 0 ? 0 : 1, facing > 0 ? frontBrakeGrip : rearBrakeGrip, braking, coasting);

    for (let i = 0; i < 7; i++) {
      const x = front.x - rear.x, y = front.y - rear.y;
      const d = Math.hypot(x, y) || .001;
      const correction = ((d - WHEELBASE) / d) * .43;
      rear.x += x * correction; rear.y += y * correction;
      front.x -= x * correction; front.y -= y * correction;
      collide(rear); collide(front);
    }

    for (const p of [rear, front]) {
      const slope = terrain(p.x).slope;
      if (!(braking && p.grounded)) {
        p.spin += ((p.x - p.ox) + slope * (p.y - p.oy)) / Math.hypot(1, slope) / RADIUS;
      }
    }
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

    const head = headPosition();
    const mx = (rear.x + front.x) / 2, my = (rear.y + front.y) / 2;

    if(state==='ragdoll'){updateRagdoll();return;}
    const headGround = terrain(head.x);
    if ((headGround.solid && head.y + 6 > headGround.y && elapsed > .2)
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
    const mid = (rear.x + front.x) / 2;
    const progress = Math.round(clamp((mid - 90) / (level.goal - 90), 0, 1) * 100);
    if (progress !== lastProgress) {
      $('progress-fill').style.width = progress + '%';
      $('progress').setAttribute('aria-valuenow', String(progress));
      lastProgress = progress;
    }
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


  function drawTerrain() {
    groundPath(); ctx.fillStyle = '#c5b496'; ctx.fill();
    ctx.save(); groundPath(); ctx.clip();
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      for (let x = cameraX - 20; x < cameraX + W + 25; x += 8) {
        const y = terrain(x).y + 27 + i * 30 + Math.sin(x * .022 + i) * 5;
        if (x === cameraX - 20) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = i % 2 ? '#d3c2a2' : '#b7a687'; ctx.lineWidth = 2; ctx.stroke();
    }
    for (let i = Math.floor(cameraX / 31); i < Math.ceil((cameraX + W) / 31); i++) {
      const x = i * 31 + Math.sin(i * 18) * 9;
      const y = terrain(x).y + 16 + (Math.sin(i * 23) + 1) * 34;
      ctx.fillStyle = '#ac9c806e';
      ctx.beginPath(); ctx.ellipse(x, y, 2 + (i % 3 + 3) % 3, 1.5, .3, 0, TAU); ctx.fill();
    }
    ctx.restore();

    ctx.beginPath();
    for (const [start, end] of solidRanges()) {
      ctx.moveTo(start, terrain(start).y);
      for (let x = start + 3; x < end; x += 3) ctx.lineTo(x,terrain(x).y);
      ctx.lineTo(end,terrain(end).y);
    }
    ctx.strokeStyle = '#375d4d'; ctx.lineWidth = 7; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.strokeStyle = '#6f8b59'; ctx.lineWidth = 2; ctx.stroke();

    for (let i = Math.floor(cameraX / 45); i < Math.ceil((cameraX + W) / 45); i++) {
      const x = i * 45 + Math.sin(i * 9) * 8, t = terrain(x);
      if (!t.solid) continue;
      pixelPath([[x - 4, t.y - 2],[x - 4, t.y - 8],[x, t.y - 4],[x + 2, t.y - 10]], '#628455', 1, 2);
    }

    if (cameraX < 230) {
      const y = terrain(28).y;
      line([[28,y],[28,y-48]], '#6d7862', 3);
      ctx.fillStyle = '#e8e4ce'; ctx.fillRect(8,y-52,41,19);
      ctx.fillStyle = '#3c5e4b'; ctx.font = 'bold 8px system-ui'; ctx.textAlign = 'center';
      ctx.fillText('GO →',28,y-39);
    }
  }

  function drawProp(prop,layer){
    if(preferences.scenery === 'reduced' && prop.type === 'tree')return;
    if(prop.x<cameraX-70||prop.x>cameraX+W+70)return;
    const ground=terrain(prop.x);if(!ground.solid)return;
    const y=ground.y;
    ctx.save(); ctx.translate(Math.round(prop.x/2)*2,Math.round(y/2)*2);
    ctx.globalAlpha=layer==='front'?1:.82;
    if(prop.type==='tree'){
      pixelRect(-4,-44,8,44,'#66543f',2);
      drawPixelDisc(-8,-52,14,'#477158',4); drawPixelDisc(8,-56,16,'#568061',4); drawPixelDisc(0,-70,12,'#618b66',4);
    } else if(prop.type==='fence'){
      pixelRect(-22,-26,4,26,'#856d4f',2); pixelRect(18,-26,4,26,'#856d4f',2);
      pixelRect(-24,-20,46,4,'#aa8a60',2); pixelRect(-24,-10,46,4,'#aa8a60',2);
    } else if(prop.type==='rock'){
      pixelRect(-16,-8,34,8,'#697872',2); pixelRect(-10,-14,22,6,'#7f8d83',2); pixelRect(-4,-18,10,4,'#aeb5a7',2);
    } else if(prop.type==='flowers'){
      for(let i=-2;i<=2;i++){const x=i*6,h=8+(Math.abs(i)%2)*4;pixelRect(x,-h,2,h,'#58784d',2);pixelRect(x-2,-h-4,6,4,i%2?'#f1b95d':'#e8755b',2);}
    } else if(prop.type==='stump'){
      pixelRect(-10,-14,20,14,'#806244',2); pixelRect(-10,-16,20,4,'#c39664',2); pixelRect(-4,-16,8,2,'#76573d',2);
    } else if(prop.type==='crystal'){
      pixelPath([[-14,0],[-8,-28],[0,-40],[8,-24],[14,0]],'#83d1ce',3);
      pixelPath([[0,-36],[0,-4]],'#d9ffff',1);
    }
    ctx.restore();
  }


  function drawProps(layer) {
    for (const prop of level.props || []) if (prop.layer === layer) drawProp(prop, layer);
  }

  function drawApple(apple, now) {
    if (apple.taken || apple.x < cameraX - 30 || apple.x > cameraX + W + 30) return;
    const y = apple.y + (reducedMotion ? 0 : Math.sin(now * .0025 + apple.x) * 2);
    gameArt.drawApple(apple.x, y);
  }

  function drawFlag() {
    const x=level.goal,y=terrain(x).y;
    if(x<cameraX-65||x>cameraX+W+65)return;
    gameArt.drawFlag(x, y, collected===apples.length);
  }

  function drawPixelBike(mx, my, angle, length) {
    gameArt.drawBike({ rear, front, mx, my, angle, length, flipVisual, facing, brakePressure, state, leanVisual, rider });
  }

  function hairAnchors() {
    if (ragdoll) {
      const head = ragdoll.points.head;
      return [-4, 0, 4].map(offset => ({ x: head.x - facing * 6, y: head.y + offset }));
    }
    const mx = Math.round((rear.x + front.x) / 2);
    const my = Math.round((rear.y + front.y) / 2);
    const angle = Math.atan2(front.y - rear.y, front.x - rear.x);
    const pixelAngle = Math.round(angle / (TAU / 32)) * (TAU / 32);
    const backCompression = facing > 0 ? rear.compression : front.compression;
    const frontCompression = facing > 0 ? front.compression : rear.compression;
    const bodyDrop = Math.round((backCompression + frontCompression) * .2) * 2;
    const bodyPitch = (frontCompression - backCompression) * .0096;
    const shift = Math.round(leanVisual * 4.5) * 2;
    return [-48, -44, -40].map((localY, index) => {
      const localX = -5 - index + shift;
      const pitchedX = localX * Math.cos(bodyPitch) - localY * Math.sin(bodyPitch);
      const pitchedY = localX * Math.sin(bodyPitch) + localY * Math.cos(bodyPitch) + bodyDrop;
      const flippedX = pitchedX * flipVisual;
      return {
        x: mx + Math.cos(pixelAngle) * flippedX - Math.sin(pixelAngle) * pitchedY,
        y: my + Math.sin(pixelAngle) * flippedX + Math.cos(pixelAngle) * pitchedY
      };
    });
  }

  function hairBackSupport() {
    if (ragdoll) return null;
    const mx = Math.round((rear.x + front.x) / 2);
    const my = Math.round((rear.y + front.y) / 2);
    const angle = Math.atan2(front.y - rear.y, front.x - rear.x);
    const pixelAngle = Math.round(angle / (TAU / 32)) * (TAU / 32);
    const backCompression = facing > 0 ? rear.compression : front.compression;
    const frontCompression = facing > 0 ? front.compression : rear.compression;
    const bodyDrop = Math.round((backCompression + frontCompression) * .2) * 2;
    const bodyPitch = (frontCompression - backCompression) * .0096;
    const shift = Math.round(leanVisual * 4.5) * 2;
    const transform = (localX, localY) => {
      const pitchedX = localX * Math.cos(bodyPitch) - localY * Math.sin(bodyPitch);
      const pitchedY = localX * Math.sin(bodyPitch) + localY * Math.cos(bodyPitch) + bodyDrop;
      const flippedX = pitchedX * flipVisual;
      return {
        x: mx + Math.cos(pixelAngle) * flippedX - Math.sin(pixelAngle) * pitchedY,
        y: my + Math.sin(pixelAngle) * flippedX + Math.cos(pixelAngle) * pitchedY
      };
    };
    const top = transform(-7 + shift, -39);
    const bottom = transform(-8 + shift, -27);
    const outside = transform(-9 + shift, -33);
    const inside = transform(-7 + shift, -33);
    const dx = outside.x - inside.x, dy = outside.y - inside.y;
    const length = Math.hypot(dx, dy) || 1;
    return { top, bottom, nx: dx / length, ny: dy / length };
  }

  function updateHair(dt) {
    if (rider !== 'Maxine') { hair = null; return; }
    const anchors = hairAnchors();
    const strandLengths = [[5, 5], [5, 5, 6], [5, 6, 6]];
    if (!hair) {
      const backward = ragdoll ? -facing : -Math.sign(flipVisual || facing);
      hair = strandLengths.map((lengths, strandIndex) => {
        let x = anchors[strandIndex].x, y = anchors[strandIndex].y;
        return lengths.map(length => {
          x += backward * length * .45;
          y += length * .89;
          return { x, y, vx: 0, vy: 0 };
        });
      });
    }
    if (dt <= 0) return;
    const step = Math.min(dt, 1 / 30);
    const damping = Math.exp(-13 * step);
    const back = hairBackSupport();
    for (const strand of hair) for (const point of strand) {
      point.startX = point.x; point.startY = point.y;
      point.vx *= damping;
      point.vy = point.vy * damping + 620 * step;
      point.x += point.vx * step;
      point.y += point.vy * step;
    }
    for (let iteration = 0; iteration < 7; iteration++) {
      hair.forEach((strand, strandIndex) => {
        let parent = anchors[strandIndex];
        strand.forEach((point, pointIndex) => {
          const dx = point.x - parent.x, dy = point.y - parent.y;
          const distance = Math.hypot(dx, dy) || 1;
          const length = strandLengths[strandIndex][pointIndex];
          point.x = parent.x + dx / distance * length;
          point.y = parent.y + dy / distance * length;
          if (back) {
            const bx = back.bottom.x - back.top.x, by = back.bottom.y - back.top.y;
            const backLengthSquared = bx * bx + by * by || 1;
            const t = clamp(((point.x - back.top.x) * bx + (point.y - back.top.y) * by) / backLengthSquared, 0, 1);
            const nearestX = back.top.x + bx * t, nearestY = back.top.y + by * t;
            const clearance = (point.x - nearestX) * back.nx + (point.y - nearestY) * back.ny;
            if (clearance < 2) {
              point.x += back.nx * (2 - clearance);
              point.y += back.ny * (2 - clearance);
            }
          }
          const ground = terrain(point.x);
          if (ground.solid) point.y = Math.min(point.y, ground.y - 2);
          parent = point;
        });
      });
    }
    for (const strand of hair) for (const point of strand) {
      point.vx = clamp((point.x - point.startX) / step, -100, 100);
      point.vy = clamp((point.y - point.startY) / step, -100, 100);
    }
  }

  function drawHair() {
    if (!hair) return;
    const anchors = hairAnchors();
    hair.forEach((strand, strandIndex) => {
      const points = [[anchors[strandIndex].x, anchors[strandIndex].y], ...strand.map(point => [point.x, point.y])];
      pixelPath(points, strandIndex === 1 ? '#684438' : '#54362d', 2, 2);
      for (let i = 1; i < points.length; i++) pixelRect(points[i][0] - 2, points[i][1] - 2, 4, 4, '#54362d', 2);
    });
  }

  function drawBike() {
    const mx=(rear.x+front.x)/2,my=(rear.y+front.y)/2;
    const angle=Math.atan2(front.y-rear.y,front.x-rear.x);
    const length=Math.hypot(front.x-rear.x,front.y-rear.y);
    const ground=terrain(mx);
    if(ground.solid){
      const heightAboveGround=Math.max(0,ground.y-my-RADIUS);
      const shadowAlpha=clamp(.22-heightAboveGround/700,.035,.22);
      const shadowWidth=clamp(35-heightAboveGround*.07,13,35);
      ctx.save();ctx.translate(mx,ground.y-1);ctx.rotate(Math.atan(ground.slope));
      pixelRect(-shadowWidth,-2,shadowWidth*2,4,'rgba(31,53,39,'+shadowAlpha+')',2);
      pixelRect(-shadowWidth*.7,-4,shadowWidth*1.4,2,'rgba(31,53,39,'+(shadowAlpha*.6)+')',2);
      ctx.restore();
    }
    drawPixelBike(mx,my,angle,length);
  }

  function updateParticles(dt) {
    if (state === 'paused') return;
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

  function render(now, dt) {
    const midX = (rear.x + front.x)/2, midY = (rear.y + front.y)/2;
    let focusX=midX,focusY=midY;
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
    updateParticles(dt);
    drawTerrain(); drawSkidMarks(); drawProps('back'); drawParticles(true); drawFlag();
    apples.forEach(a => drawApple(a,now));
    updateHair(state === 'paused' ? 0 : dt);
    drawHair();
    drawBike();
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
      else showMainMenu();
      return;
    }
    if (!$('menu-screen').hidden) return;
    if (e.code === 'KeyR') {
      e.preventDefault(); if (!e.repeat) startFresh(); return;
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
    if (state === 'paused') { setOverlay('running'); focusGame(); }
    else if (state === 'won') {
      loadLevel((levelIndex + 1) % levels.length); setOverlay('running'); focusGame();
    } else startFresh();
  });
  $('secondary').addEventListener('click', () => {
    if (state === 'crashed') {
      showMainMenu();
      buildMenuLevelCards();
      showMenuView('levels');
    } else startFresh();
  });
  $('menu-how-to').addEventListener('click', () => showMenuView('how'));
  $('menu-settings').addEventListener('click', () => {
    applyPreferences();
    showMenuView('settings');
  });
  $('menu-fullscreen').addEventListener('click', toggleFullscreen);
  $('fullscreen').addEventListener('click', toggleFullscreen);
  $('menu').addEventListener('click', () => { sounds.menuBack(); showMainMenu(); });
  $('menu-screen').addEventListener('keydown', event => {
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
  $('pause').addEventListener('click', () => {
    if (state === 'running') pauseGame();
    else if (state === 'paused') { setOverlay('running'); focusGame(); }
  });
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
      while (accumulator >= STEP) {
        physics(); accumulator -= STEP;
        if (state !== 'running' && state !== 'ragdoll') { accumulator = 0; break; }
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
})();
