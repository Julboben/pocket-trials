// The game loop and state machine: loads trails, steps the ride at a fixed
// rate, turns ride events into sound, effects and UI, and saves results.
import { STEP, MAX_STEPS_PER_FRAME, clamp } from './config.js';
import { levels, customLevelEntries, readPlaytestLevel, PLAYTEST_EXIT_MESSAGE } from './levels.js';
import { createAudio } from './audio.js';
import { createPhysicsDebugger } from './physics-debug.js';
import { terrainAt, terrainSegmentSlopeAt } from './terrain.js';
import { createRide, stepRide, bikeSpeed, interpolateRide, RIDE_VERSION } from './ride.js';
import { encodeInputs, decodeInputs } from './replay-codec.js';
import { medalFor, normalizeLevel } from './level-schema.js';
import {
  readBest, saveBest, readLeaderboard, recordLeaderboardRun, readGhost, saveGhost,
  saveProgress as persistProgress
} from './storage.js';
import { createInput, keyLabel } from './input.js';
import { createCamera } from './camera.js';
import { createEffects } from './effects.js';
import { createRenderer } from './render.js';
import { createOverlay } from './ui/overlay.js';
import { createMenu, loadStoredState } from './ui/menu.js';
import { $, session, currentTrailEntry, trailKey, timeText } from './state.js';

const LANDING_SOUND_IMPACT = 45;
const HARD_LANDING_IMPACT = 170;
const CRASH_COLORS = { spike: '#d95832', head: '#ed8b54', fall: '#ed8b54' };

export function startGame() {
  const game = $('game');
  const renderer = createRenderer(/** @type {HTMLCanvasElement} */ ($('canvas')));
  const camera = createCamera();
  const effects = createEffects();
  const overlay = createOverlay();
  const sounds = createAudio(() => {
    const ride = session.ride;
    return { state: session.state, rear: ride?.rear, front: ride?.front, throttle: ride?.throttle ?? 0, brakePressure: ride?.brakePressure ?? 0, weather: session.level?.weather };
  });
  const input = createInput({
    element: game,
    buttons: [...document.querySelectorAll('[data-action]')],
    isActive: () => session.state === 'running' && !menu.isOpen(),
    onPress: handlePress
  });
  const menu = createMenu({
    sounds, input,
    onStartLevel: index => startSelectedLevel(() => loadLevel(index)),
    onStartCustom: index => startSelectedLevel(() => loadCustomLevel(index), false),
    onClose: closeMainMenu,
    onPreferences: applyPreferences
  });

  const physicsDebugEnabled = new URLSearchParams(window.location.search).get('physicsDebug') === '1';
  const physicsDebug = createPhysicsDebugger({
    enabled: physicsDebugEnabled,
    step: STEP,
    inspectPoint(point, round) {
      const ground = terrainAt(session.level, point.x);
      return {
        groundY: round(ground.y),
        curveSlope: round(ground.slope),
        segmentSlope: round(terrainSegmentSlopeAt(session.level.points, point.x))
      };
    }
  });
  const debugHooks = physicsDebugEnabled ? {
    dynamics: values => physicsDebug.recordDynamics(values),
    afterIntegration: () => physicsDebug.capture('afterIntegration', session.ride.rear, session.ride.front),
    iteration: value => physicsDebug.setIteration(value),
    constraint: correction => physicsDebug.recordConstraint(correction, session.ride.rear, session.ride.front),
    contact: value => physicsDebug.recordContact(value),
    contactsResolved: () => physicsDebug.recordContactsResolved(session.ride.rear, session.ride.front),
    traction: (wheelName, result, point) => physicsDebug.recordTraction(wheelName, result, point)
  } : undefined;

  if (physicsDebugEnabled) {
    window.pocketTrialsGame = {
      get ride() { return session.ride; },
      get ghost() { return ghost; },
      get state() { return session.state; }
    };
  }

  let lastTime = 0, accumulator = 0, landingSoundCooldown = 0;
  /** Inputs of the current attempt, one per step, for saving a ghost. */
  let recorded = [], startStep = 0, flips = 0;
  /** @type {{ ride: any, inputs: any[], index: number, data: any } | null} */
  let ghost = null;
  let wakeLock = null;
  const playtestData = readPlaytestLevel();
  const playtestLevel = playtestData ? normalizeLevel(playtestData) : null;
  /** Best play-test run; kept in memory so edited trails never reach saved ghosts or leaderboards. */
  let playtestBest = null;

  // --- Device features -----------------------------------------------------

  function vibrate(pattern) {
    if (session.preferences.haptics === 'on' && typeof navigator.vibrate === 'function') navigator.vibrate(pattern);
  }

  async function holdWakeLock(wanted) {
    if (!('wakeLock' in navigator)) return;
    if (wanted && !wakeLock && document.visibilityState === 'visible') {
      try {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      } catch (_) { wakeLock = null; }
    } else if (!wanted && wakeLock) {
      const lock = wakeLock;
      wakeLock = null;
      lock.release().catch(() => {});
    }
  }

  const fullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement;
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;

  function toggleFullscreen() {
    if (!menu.isOpen()) sounds.menuSelect();
    const action = fullscreenElement()
      ? (document.exitFullscreen?.bind(document) || document.webkitExitFullscreen?.bind(document))
      : (game.requestFullscreen?.bind(game) || game.webkitRequestFullscreen?.bind(game));
    if (!action) return;
    const result = action();
    if (result?.catch) result.catch(() => {});
  }

  function handleFullscreenChange() {
    const label = fullscreenElement() ? 'Exit fullscreen' : 'Enter fullscreen';
    $('fullscreen').setAttribute('aria-label', label);
    $('menu-fullscreen').setAttribute('aria-label', label);
    // Phones play better sideways; locking only works while fullscreen.
    if (coarsePointer && screen.orientation) {
      try {
        if (fullscreenElement()) screen.orientation.lock?.('landscape').catch(() => {});
        else screen.orientation.unlock?.();
      } catch (_) {}
    }
    requestAnimationFrame(() => { renderer.resize(); menu.drawBackground(); });
  }

  // --- Preferences and progress --------------------------------------------

  function applyPreferences() {
    const { preferences } = session;
    session.rider = session.saveGame?.rider || 'max';
    const controlsHidden = preferences.controls === 'hide';
    $('control-area').hidden = controlsHidden;
    game.classList.toggle('controls-hidden', controlsHidden);
    sounds.setEnabled(preferences.sound === 'on');
    sounds.setVolume(preferences.volume / 100);
    input.setBindings(preferences.bindings);
    if (preferences.ghost === 'off') ghost = null;
  }

  function saveProgress() {
    const { saveGame } = session;
    if (!saveGame || session.levelSource !== 'official') return;
    session.savedLevel = session.levelIndex;
    saveGame.level = session.levelIndex;
    saveGame.unlocked = session.unlockedLevel;
    session.saveSlots[session.activeSaveSlot] = saveGame;
    persistProgress(session.activeSaveSlot, session.levelIndex, session.unlockedLevel, levels.length);
  }

  // --- Trails ----------------------------------------------------------------

  function loadGhost(level) {
    ghost = null;
    if (session.preferences.ghost !== 'on') return;
    const data = session.levelSource === 'playtest' ? playtestBest : readGhost(trailKey(currentTrailEntry()));
    if (!data || data.physics !== RIDE_VERSION) return;
    const inputs = decodeInputs(data.inputs);
    const ride = createRide(level, { seed: data.seed });
    // Play the idle lead-in now so the ghost sets off with the player.
    for (let index = 0; index < data.startStep && index < inputs.length; index++) stepRide(ride, inputs[index]);
    ghost = { ride, inputs, index: data.startStep, data };
  }

  function initializeLevel(trail, marker) {
    session.level = trail;
    const ride = createRide(trail, { seed: (Math.random() * 2 ** 31) >>> 0 });
    session.ride = ride;
    recorded = []; startStep = 0; flips = 0;
    accumulator = 0; landingSoundCooldown = 0;
    effects.reset(trail);
    renderer.reset(trail, ride.facing);
    camera.reset();
    loadGhost(trail);
    input.clear();
    overlay.setDirection(ride.facing);
    overlay.setTrail(trail.name, marker, ride.apples.length);
    overlay.setTimer(0);
  }

  function loadLevel(index) {
    index = clamp(index, 0, session.unlockedLevel);
    session.levelSource = 'official'; session.customLevelIndex = -1; session.levelIndex = index;
    initializeLevel(levels[index], String(index + 1).padStart(2, '0'));
    saveProgress();
  }

  function loadCustomLevel(index) {
    const entry = customLevelEntries[index];
    if (!entry) return;
    session.levelSource = 'custom'; session.customLevelIndex = index;
    initializeLevel(entry.level, `C${String(index + 1).padStart(2, '0')}`);
  }

  function loadPlaytestLevel() {
    session.levelSource = 'playtest'; session.customLevelIndex = -1;
    initializeLevel(playtestLevel, 'TEST');
  }

  function exitPlaytest() {
    input.clear();
    pauseGame();
    if (window.parent !== window) window.parent.postMessage({ type: PLAYTEST_EXIT_MESSAGE }, window.location.origin);
    else window.location.href = './editor.html';
  }

  // --- State machine ---------------------------------------------------------

  function setState(next) {
    session.state = next;
    input.clear();
    if (next !== 'won') overlay.hide();
    overlay.showPause(next === 'paused');
    holdWakeLock(next === 'running' || next === 'ragdoll' || next === 'won');
  }

  const focusGame = () => game.focus({ preventScroll: true });

  function startFresh() {
    if (session.levelSource === 'playtest') loadPlaytestLevel();
    else if (session.levelSource === 'custom') loadCustomLevel(session.customLevelIndex);
    else loadLevel(session.levelIndex);
    setState('running'); focusGame();
  }

  function pauseGame() { if (session.state === 'running') setState('paused'); }
  function resumeGame() {
    if (session.state !== 'paused') return;
    setState('running'); focusGame();
  }
  function togglePause() { session.state === 'paused' ? resumeGame() : pauseGame(); }

  function flipDirection() {
    const ride = session.ride;
    const airborne = !ride.rear.grounded && !ride.front.grounded;
    ride.facing *= -1;
    overlay.setDirection(ride.facing);
    sounds.flip(airborne);
  }

  function showMainMenu() {
    if (session.levelSource === 'playtest') { exitPlaytest(); return; }
    if (session.state !== 'menu') session.stateBeforeMenu = session.state;
    session.state = 'menu';
    input.clear();
    overlay.hide();
    holdWakeLock(false);
    game.classList.add('menu-open');
    menu.open();
  }

  function closeMainMenu() {
    if (!session.gameLoopStarted || (!session.saveGame && session.levelSource === 'official')) return;
    menu.close();
    game.classList.remove('menu-open');
    focusGame();
    const previous = session.stateBeforeMenu;
    if (previous === 'ragdoll') setState('ragdoll');
    else if (previous === 'won') {
      // Reopen the results as they were; finishing again would save the run twice.
      setState('won');
      overlay.reopen();
    } else setState(previous === 'paused' ? 'paused' : 'running');
  }

  function startSelectedLevel(load, requiresSave = true) {
    if (requiresSave && !session.saveGame) return;
    menu.close();
    game.classList.remove('menu-open');
    load();
    setState('running');
    focusGame();
    session.gameLoopStarted = true;
  }

  function handlePress(action) {
    if (menu.isOpen()) {
      if (action === 'menu' || action === 'pause') closeMainMenu();
      else menu.handlePad(action);
      return;
    }
    const { state } = session;
    if (action === 'restart') startFresh();
    else if (action === 'pause') { if (state === 'running' || state === 'paused') togglePause(); }
    else if (action === 'menu') { sounds.menuBack(); showMainMenu(); }
    else if (action === 'flip') { if (state === 'running') flipDirection(); }
    else if (action === 'confirm' || action === 'cancel') {
      if (state === 'paused') resumeGame();
      else if (state === 'won' && action === 'confirm') $('primary').click();
      else if (state === 'ragdoll' && action === 'confirm') startFresh();
    }
  }

  // --- Simulation ------------------------------------------------------------

  function finishPlaytestRun(ride) {
    const time = ride.elapsed;
    const previousBest = playtestBest?.time ?? null;
    if (previousBest === null || time < previousBest) {
      playtestBest = { time, splits: ride.splits.slice(), startStep, seed: ride.seed, inputs: encodeInputs(recorded), physics: RIDE_VERSION };
    }
    const medals = session.level.medals;
    overlay.showResults({
      official: false, time, previousBest, rank: null, medals, medal: medalFor(medals, time), flips,
      apples: ride.apples.length,
      primaryLabel: 'Play Again →',
      restartKey: keyLabel(session.preferences.bindings.restart[0] || 'KeyR')
    });
    $('overlay-badge').textContent = 'PLAY TEST COMPLETED';
    $('overlay-description').textContent = 'Play-test runs are not saved. Press Escape to return to the editor.';
    $('overlay-description').hidden = false;
    setState('won');
  }

  function finishRun(ride) {
    if (session.levelSource === 'playtest') { finishPlaytestRun(ride); return; }
    const entry = currentTrailEntry();
    const key = trailKey(entry);
    const time = ride.elapsed;
    const official = session.levelSource === 'official';
    const { saveGame } = session;
    const previousBest = official
      ? (saveGame ? readBest(session.activeSaveSlot, session.levelIndex, levels.length) : null)
      : readLeaderboard(key)[0]?.time ?? null;
    const rank = recordLeaderboardRun(key, {
      time, rider: session.rider, slot: saveGame ? session.activeSaveSlot : null, saveId: saveGame?.createdAt
    });
    if (official) {
      session.unlockedLevel = Math.max(session.unlockedLevel, Math.min(session.levelIndex + 1, levels.length - 1));
      saveProgress();
      if (saveGame && (previousBest === null || time < previousBest)) {
        saveBest(session.activeSaveSlot, session.levelIndex, time, levels.length);
        saveGame.bestTimes[session.levelIndex] = time;
      }
    }
    const storedGhost = readGhost(key);
    if (!storedGhost || storedGhost.physics !== RIDE_VERSION || time < storedGhost.time) {
      saveGhost(key, { time, splits: ride.splits.slice(), startStep, seed: ride.seed, inputs: encodeInputs(recorded), physics: RIDE_VERSION });
    }
    const medals = session.level.medals;
    const last = session.levelIndex === levels.length - 1;
    overlay.showResults({
      official, time, previousBest, rank, medals, medal: medalFor(medals, time), flips,
      apples: ride.apples.length,
      primaryLabel: official && !last ? 'Next Trail →' : 'Play Again →',
      restartKey: keyLabel(session.preferences.bindings.restart[0] || 'KeyR')
    });
    setState('won');
    vibrate([20, 40, 20, 40, 60]);
  }

  function handleEvent(ride, event) {
    switch (event.type) {
      case 'start':
        startStep = recorded.length - 1;
        break;
      case 'airTurn':
        sounds.airTurn(event.full);
        break;
      case 'flip': {
        flips += event.count;
        const mx = (ride.rear.x + ride.front.x) / 2, my = (ride.rear.y + ride.front.y) / 2;
        renderer.popup('+' + event.count + (event.count === 1 ? ' FLIP' : ' FLIPS'), mx, my - 70);
        overlay.announce(event.count + (event.count === 1 ? ' flip.' : ' flips.'));
        vibrate(25);
        break;
      }
      case 'land':
        if (ride.status !== 'running' || event.impact <= LANDING_SOUND_IMPACT || landingSoundCooldown > 0) break;
        sounds.land(event.impact);
        landingSoundCooldown = .12;
        for (const wheel of [ride.rear, ride.front]) if (wheel.grounded && wheel.impactSpeed > LANDING_SOUND_IMPACT) effects.dustPuff(wheel, wheel.impactSpeed);
        if (event.impact > HARD_LANDING_IMPACT) vibrate(Math.round(clamp(event.impact / 12, 10, 40)));
        break;
      case 'crash':
        effects.burst(event.x, event.y, CRASH_COLORS[event.cause], event.cause === 'spike' ? 18 : 15);
        sounds.crash();
        if (session.preferences.shake === 'on') camera.kick(6);
        vibrate([40, 30, 80]);
        setState('ragdoll');
        overlay.announce('Rider down. Press ' + keyLabel(session.preferences.bindings.restart[0] || 'KeyR') + ' or select the restart button to try again.');
        overlay.toast('Rider down · Press ' + keyLabel(session.preferences.bindings.restart[0] || 'KeyR') + ' to retry', Infinity);
        break;
      case 'apple': {
        effects.burst(event.apple.x, event.apple.y, '#ef8150');
        sounds.apple();
        overlay.setApples(event.collected, event.total);
        overlay.announce(event.collected + ' of ' + event.total + ' apples collected.');
        const ghostSplit = ghost?.data.splits?.[event.collected - 1];
        if (Number.isFinite(ghostSplit)) overlay.split(event.split - ghostSplit);
        if (event.collected === event.total) overlay.toast('All apples collected! Finish gate unlocked ⚑');
        break;
      }
      case 'goalLocked':
        overlay.toast(event.missing + (event.missing === 1 ? ' apple remaining! Turn back to collect it.' : ' apples remaining! Turn back to collect them.'));
        break;
      case 'win': {
        const mx = (ride.rear.x + ride.front.x) / 2, my = (ride.rear.y + ride.front.y) / 2;
        effects.burst(mx, my - 55, '#e8964f', 25);
        sounds.win();
        finishRun(ride);
        break;
      }
    }
  }

  function physicsStep() {
    const ride = session.ride;
    const thunder = effects.stepWeather();
    if (thunder) sounds.thunder(thunder.intensity, thunder.distance);
    landingSoundCooldown = Math.max(0, landingSoundCooldown - STEP);
    physicsDebug.begin({ state: session.state, time: ride.elapsed, level: session.level.name, source: session.levelSource, facing: ride.facing, throttle: ride.throttle }, ride.rear, ride.front);

    // Holding restart keeps the bike on the start line with the clock stopped.
    const holding = input.held('restart');
    const replayInput = physicsDebug.nextReplayInput();
    const stepInput = replayInput ? {
      facing: Number(replayInput.facing) ? (replayInput.facing < 0 ? -1 : 1) : ride.facing,
      leanInput: replayInput.leanInput ?? 0,
      accelerating: Boolean(replayInput.accelerating),
      braking: Boolean(replayInput.braking)
    } : {
      facing: ride.facing,
      leanInput: holding ? 0 : input.leanInput(),
      accelerating: !holding && input.held('up'),
      braking: !holding && input.held('down')
    };
    const running = ride.status === 'running';
    physicsDebug.recordInput({ ...stepInput, accelerating: running && stepInput.accelerating, braking: running && stepInput.braking });
    if (running) recorded.push(stepInput);
    const speed = bikeSpeed(ride);
    const facingBefore = ride.facing;
    const events = stepRide(ride, stepInput, debugHooks);
    if (ride.facing !== facingBefore) overlay.setDirection(ride.facing);
    physicsDebug.capture('afterVelocityConstraint', ride.rear, ride.front);
    physicsDebug.setIteration(-1);
    physicsDebug.finish(ride.rear, ride.front);

    if (ghost && ride.started && ghost.index < ghost.inputs.length) stepRide(ghost.ride, ghost.inputs[ghost.index++]);
    else if (ghost && ghost.index >= ghost.inputs.length && ghost.ride.status === 'crashed') stepRide(ghost.ride, {});

    effects.terrainSpray(ride, speed, stepInput.braking);
    effects.brakeMarks(ride, speed, stepInput.braking);
    for (const event of events) handleEvent(ride, event);
  }

  // --- Frame loop ----------------------------------------------------------

  function frame(now) {
    const dt = lastTime ? Math.min((now - lastTime) / 1000, .05) : 1 / 60;
    lastTime = now;
    input.pollGamepad();
    const ride = session.ride;
    if (ride && !menu.isOpen()) {
      const { state } = session;
      if (state === 'running' || state === 'ragdoll') {
        accumulator += dt;
        let steps = 0;
        while (accumulator >= STEP) {
          physicsStep(); accumulator -= STEP;
          if (session.state !== 'running' && session.state !== 'ragdoll') { accumulator = 0; break; }
          // Drop time a slow frame cannot catch up on instead of spiralling.
          if (++steps >= MAX_STEPS_PER_FRAME) { accumulator = Math.min(accumulator, STEP); break; }
        }
      } else accumulator = 0;
      const stepping = session.state === 'running' || session.state === 'ragdoll';
      const alpha = stepping ? accumulator / STEP : 1;
      overlay.setTimer(ride.elapsed);
      overlay.tick(now);
      const restore = interpolateRide(ride, alpha);
      const ghostRide = ghost?.ride;
      const restoreGhost = ghostRide ? interpolateRide(ghostRide, alpha) : null;
      renderer.draw({
        ride, ghost: ghostRide, camera, effects, rider: session.rider, state: session.state,
        full: session.preferences.scenery === 'full', now, dt, debug: physicsDebugEnabled
      });
      restoreGhost?.();
      restore();
    }
    sounds.update();
    requestAnimationFrame(frame);
  }

  // --- Wiring ----------------------------------------------------------------

  game.addEventListener('keydown', event => {
    if (input.capturing) { input.keyDown(event); return; }
    if (event.code === 'Escape') {
      event.preventDefault();
      sounds.escape();
      if (menu.isOpen()) closeMainMenu();
      else if (session.state === 'paused') resumeGame();
      else showMainMenu();
      return;
    }
    if (menu.isOpen()) return;
    input.keyDown(event);
  });
  // Auto-pause fires when focus leaves the game, so resuming must not need it.
  document.addEventListener('keydown', event => {
    if (game.contains(/** @type {Node} */ (event.target)) || session.state !== 'paused') return;
    if (session.preferences.bindings.pause.includes(event.code) || event.code === 'Escape') { event.preventDefault(); resumeGame(); }
  });
  window.addEventListener('keyup', event => input.keyUp(event));
  game.addEventListener('focusout', event => {
    if (!game.contains(/** @type {Node} */ (event.relatedTarget))) { input.clear(); pauseGame(); }
  });
  $('canvas').addEventListener('pointerdown', focusGame);
  window.addEventListener('blur', () => { input.clear(); pauseGame(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { input.clear(); pauseGame(); }
    else holdWakeLock(session.state === 'running' || session.state === 'ragdoll' || session.state === 'won');
    lastTime = 0; accumulator = 0;
  });

  $('primary').addEventListener('click', () => {
    if (session.state === 'won' && session.levelSource === 'official') {
      loadLevel((session.levelIndex + 1) % levels.length);
      setState('running'); focusGame();
    } else startFresh();
  });
  $('secondary').addEventListener('click', startFresh);
  $('restart').addEventListener('click', startFresh);
  $('menu').addEventListener('click', () => { sounds.menuBack(); showMainMenu(); });
  $('menu-fullscreen').addEventListener('click', toggleFullscreen);
  $('fullscreen').addEventListener('click', toggleFullscreen);
  const fullscreenSupported = Boolean(document.fullscreenEnabled || document.webkitFullscreenEnabled || game.webkitRequestFullscreen);
  $('fullscreen').hidden = !fullscreenSupported;
  $('menu-fullscreen').hidden = !fullscreenSupported;
  document.addEventListener('fullscreenchange', handleFullscreenChange);
  document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
  window.addEventListener('resize', () => { renderer.resize(); menu.drawBackground(); });
  if ('ResizeObserver' in window) new ResizeObserver(() => renderer.resize()).observe($('canvas'));
  window.addEventListener('gamepadconnected', () => { if (menu.isOpen()) sounds.menuMove(); });

  const unlockAudio = () => sounds.init();
  window.addEventListener('pointerdown', unlockAudio, { once: true, capture: true });
  window.addEventListener('keydown', unlockAudio, { once: true, capture: true });

  loadStoredState();
  applyPreferences();
  handleFullscreenChange();
  renderer.resize();
  if (playtestLevel) {
    $('menu').setAttribute('aria-label', 'Back to the editor');
    startSelectedLevel(loadPlaytestLevel, false);
  } else showMainMenu();
  requestAnimationFrame(frame);
}
