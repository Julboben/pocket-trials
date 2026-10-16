// The game loop and state machine: loads trails, steps the ride at a fixed
// rate, turns ride events into sound, effects and UI, and saves results.
import { STEP, MAX_STEPS_PER_FRAME, clamp } from './config.js';
import { trails, officialTrailEntries, bonusTrailEntries, customTrailEntries, readPlaytestTrail, PLAYTEST_EXIT_MESSAGE } from './trails.js';
import { createAudio } from './audio.js';
import { createPhysicsDebugger } from './physics-debug.js';
import { createFpsMeter } from './fps-meter.js';
import { terrainAt } from './terrain.js';
import { createRide, stepRide, bikeSpeed, interpolateRide, RIDE_VERSION } from './ride.js';
import { encodeInputs, decodeInputs } from './replay-codec.js';
import { medalFor, normalizeTrail } from './trail-schema.js';
import {
  readBest, saveBest, readLeaderboard, recordLeaderboardRun, readGhost, saveGhost,
  saveProgress as persistProgress, savePreferences, clearSaveToken, recordAchievements
} from './storage.js';
import { bikeBroken, createFeatTracker, eggAchievements, eventAchievements, finishAchievements, interactAchievements, newlyEarned, statGains } from './achievements.js';
import { createLimWatcher, installConsoleCheats } from './easter-eggs.js';
import { submitOnlineRun, fetchWorldGhost, refreshOnlineBoard, cachedOnlineBoard } from './online-leaderboard.js';
import { queueSaveSync } from './account.js';
import { createInput, keyLabel } from './input.js';
import { createCamera } from './camera.js';
import { createEffects } from './effects.js';
import { createRenderer } from './render.js';
import { riderPalette } from './drawing.js';
import { legacyRider, lookOf, lookParts } from './cosmetics.js';
import { createOverlay } from './ui/overlay.js';
import { createMenu, loadStoredState } from './ui/menu.js';
import { $, session, currentTrailEntry, trailKey, timeText, isRankedSource, bonusUnlock, riderLook, progressOf } from './state.js';

const LANDING_SOUND_IMPACT = 45;
const HARD_LANDING_IMPACT = 170;
const CRASH_COLORS = { spike: '#d95832', head: '#ed8b54', fall: '#ed8b54', water: '#8fd6e8' };

/**
 * @param {{ shared?: { entry?: any, error?: Error } | null }} [options]
 *   `shared`: the trail a share link opened (see trail-link.js), or why it couldn't.
 */
export function startGame({ shared = null } = {}) {
  const game = $('game');
  const renderer = createRenderer(/** @type {HTMLCanvasElement} */ ($('canvas')));
  const camera = createCamera();
  const effects = createEffects();
  const overlay = createOverlay();
  // The rider's hand on the grip, ahead of the physics' smoothed throttle.
  let gasHeld = false;
  const sounds = createAudio(() => {
    const ride = session.ride;
    return {
      state: session.state, rear: ride?.rear, front: ride?.front, facing: ride?.facing ?? 1, gas: gasHeld && session.state === 'running', started: ride?.started ?? false,
      brakePressure: ride?.brakePressure ?? 0, weather: session.trail?.weather,
    };
  });
  const input = createInput({
    element: game,
    buttons: [...document.querySelectorAll('[data-action]')],
    indicators: [...document.querySelectorAll('[data-shows]')],
    isActive: () => session.state === 'running' && !menu.isOpen(),
    onPress: handlePress
  });
  const menu = createMenu({
    sounds, input,
    onStartTrail: index => startSelectedTrail(() => loadTrail(index)),
    onStartBonus: index => startSelectedTrail(() => loadBonusTrail(index), false),
    onStartCustom: index => startSelectedTrail(() => loadCustomTrail(index), false),
    onClose: closeMainMenu,
    onRetry: retryFromMenu,
    onWatchReplay: watchReplay,
    onPreferences: applyPreferences
  });

  const params = new URLSearchParams(window.location.search);
  const physicsDebugEnabled = params.get('physicsDebug') === '1';
  const fpsMeter = params.get('fps') === '1' ? createFpsMeter(/** @type {Element} */ (document.querySelector('.viewport'))) : null;
  const physicsDebug = createPhysicsDebugger({
    enabled: physicsDebugEnabled,
    step: STEP,
    inspectPoint(point, round) {
      const ground = terrainAt(session.trail, point.x, point.y);
      return {
        groundY: round(ground.y),
        slope: round(ground.slope)
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
    // Reaching in from the console is an easter egg (see achievements.js).
    window.hjulbenGame = {
      get ride() { egg('debug-console'); return session.ride; },
      get ghost() { egg('debug-console'); return ghost; },
      get state() { return session.state; },
      // Copies the current attempt (trail, seed and every step's input) so it
      // can be replayed exactly outside the browser.
      dumpRun() {
        const ride = session.ride;
        const run = JSON.stringify({ physics: RIDE_VERSION, seed: ride?.seed, trail: session.trail, inputs: encodeInputs(recorded) });
        console.log('[Hjulben] Run JSON:\n' + run);
        navigator.clipboard?.writeText(run).then(() => console.log('[Hjulben] Copied the run.'), () => {});
        return run;
      }
    };
  }

  let lastTime = 0, accumulator = 0, landingSoundCooldown = 0, splashSoundCooldown = 0;
  // A paused scene is still, as is the scene behind the results once it has
  // settled, so it is only redrawn when something changes it.
  let redraw = true;
  /** Inputs of the current attempt, one per step, for saving a ghost. */
  let recorded = [], startStep = 0, flips = 0;
  /** Whether the current attempt's physics has come apart, for Here Be Kraken. */
  let broken = false;
  // Attempts that got going since the trail was opened from the menu or Next
  // Trail, for achievements such as First Try.
  let attempts = 0, openingTrail = false;
  /** Time in the air and on one wheel during the current attempt, for achievements. */
  const feats = createFeatTracker(STEP);
  /** @type {{ ride: any, inputs: any[], index: number, data: any } | null} */
  let ghost = null;
  /**
   * A recorded run being played back instead of the player's input: its
   * trail, inputs and rider. Nothing a replay does is saved or earned.
   * @type {{ source: string, index: number, data: any, inputs: any[], step: number, look: any, name: string } | null}
   */
  let replay = null;
  /** The last finished run, for Watch Replay on the results. */
  let lastRun = null;
  let wakeLock = null;
  const playtestData = readPlaytestTrail();
  const playtestTrail = playtestData ? normalizeTrail(playtestData) : null;
  /** Best play-test run; kept in memory so edited trails never reach saved ghosts or leaderboards. */
  let playtestBest = null;

  // --- Device features -----------------------------------------------------

  const restartKey = () => keyLabel(session.preferences.bindings.restart[0] || 'KeyR');

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

  // True only while an in-game action (F, Settings) is turning fullscreen off.
  let fullscreenExitRequested = false;

  function toggleFullscreen() {
    if (!menu.isOpen()) sounds.menuSelect();
    const leaving = Boolean(fullscreenElement());
    const action = leaving
      ? (document.exitFullscreen?.bind(document) || document.webkitExitFullscreen?.bind(document))
      : (game.requestFullscreen?.bind(game) || game.webkitRequestFullscreen?.bind(game));
    if (!action) return;
    fullscreenExitRequested = leaving;
    const result = action();
    if (result?.catch) result.catch(() => { fullscreenExitRequested = false; });
  }

  function syncFullscreenSetting() {
    const on = Boolean(fullscreenElement());
    document.querySelectorAll('[data-fullscreen]').forEach(button => {
      button.setAttribute('aria-pressed', String((button.dataset.fullscreen === 'on') === on));
    });
  }

  function setEscapeLock(on) {
    // Keyboard Lock API (Chromium only). Without it, Esc always exits fullscreen.
    const keyboard = /** @type {any} */ (navigator).keyboard;
    if (!keyboard?.lock) return;
    if (on) keyboard.lock(['Escape']).catch(() => {});
    else keyboard.unlock();
  }

  function handleFullscreenChange() {
    const on = Boolean(fullscreenElement());
    syncFullscreenSetting();
    setEscapeLock(on);
    if (!on) {
      const requested = fullscreenExitRequested;
      fullscreenExitRequested = false;
      // Esc (or the browser's own UI) left fullscreen: treat it like Esc in-game.
      if (!requested && !menu.isOpen() && session.gameLoopStarted) {
        // A playtest ride only pauses; showMainMenu() would exit to the editor.
        if (session.trailSource === 'playtest') pauseGame();
        else { sounds.escape(); showMainMenu(); }
      }
    }
    // Phones play better sideways; locking only works while fullscreen.
    if (coarsePointer && screen.orientation) {
      try {
        if (on) screen.orientation.lock?.('landscape').catch(() => {});
        else screen.orientation.unlock?.();
      } catch (_) {}
    }
    requestAnimationFrame(() => { resize(); menu.drawBackground(); });
  }

  // --- Preferences and progress --------------------------------------------

  function applyPreferences() {
    const { preferences } = session;
    session.look = riderLook();
    $('control-area').hidden = preferences.controls === 'hide';
    sounds.setVolume(preferences.volume / 100);
    syncSound();
    input.setBindings(preferences.bindings);
    renderer.setInteractKey(preferences.bindings.interact?.[0] ? keyLabel(preferences.bindings.interact[0]) : '');
    if (preferences.ghost === 'off') ghost = null;
    syncHeadlight();
  }

  function syncHeadlight() {
    const on = session.preferences.headlight !== 'off';
    redraw = true;
    renderer.setHeadlights(on);
    $('headlight').setAttribute('aria-pressed', String(on));
  }

  /** Uses whatever the rider is close enough to interact with (see interactions.js). */
  function interact() {
    const result = renderer.interact();
    if (!result) return;
    if (result.sound) sounds[result.sound]?.();
    if (result.announce) overlay.announce(result.announce);
    if (result.type) earn(interactAchievements(result.type));
  }

  /** Achievements from an easter egg (see easter-eggs.js). */
  function egg(name) {
    earn(eggAchievements(name));
  }

  /** Lifetime stats and achievements from a ride event or feat. */
  function trackAchievements(event) {
    const gains = statGains(event), ids = eventAchievements(event);
    if (gains || ids.length) earn(ids, gains ?? {});
  }

  /**
   * Gives the active save the achievements in `ids` and adds `gains` to its
   * lifetime stats, then announces every achievement that is new since
   * `before`, including career and stat ones the change completed. Without a
   * save nothing is kept: achievements belong to a rider. Editor play-tests
   * never count, like their times.
   * @param {string[]} ids
   * @param {Record<string, number>} [gains]
   */
  function earn(ids, gains = {}, before = progressOf(session.saveGame)) {
    const { saveGame } = session;
    if (!saveGame || !before || session.trailSource === 'playtest' || replay) return;
    const fresh = ids.filter(id => !before.has(id));
    if (fresh.length || Object.keys(gains).length) {
      const updated = recordAchievements(session.activeSaveSlot, trails.length, fresh, gains);
      if (updated) Object.assign(saveGame, updated);
    }
    const earned = newlyEarned(before, progressOf(saveGame));
    for (const { name } of earned) overlay.achievement(name);
    if (fresh.length || Object.keys(gains).length || earned.length) queueSaveSync(saveGame);
  }

  /**
   * The achievements a run that just reached the finish earns, given the best
   * time on the trail before it and the world-best time.
   */
  function finishedRunAchievements(ride, previousBest, worldBest) {
    const { medals, weather, timeOfDay } = session.trail;
    return finishAchievements({
      flips, time: ride.elapsed, medal: medalFor(medals, ride.elapsed), gold: medals?.gold ?? null,
      helmet: lookParts(session.look).helmet, bike: session.look.bike,
      night: timeOfDay === 'night', rain: (weather?.rain ?? 0) > 0, snow: (weather?.snow ?? 0) > 0,
      attempts, previousBest, worldBest, custom: session.trailSource === 'custom'
    });
  }

  function syncSound() {
    const on = session.preferences.sound === 'on';
    sounds.setEnabled(on);
    $('sound-control').setAttribute('aria-pressed', String(on));
  }

  function toggleSound() {
    session.preferences.sound = session.preferences.sound === 'on' ? 'off' : 'on';
    savePreferences(session.preferences);
    syncSound();
  }

  function toggleHeadlight() {
    const on = session.preferences.headlight === 'off';
    session.preferences.headlight = on ? 'on' : 'off';
    savePreferences(session.preferences);
    syncHeadlight();
    sounds.headlight(on);
  }

  function saveProgress() {
    const { saveGame } = session;
    if (!saveGame || session.trailSource !== 'official') return;
    session.savedTrail = session.trailIndex;
    saveGame.trail = session.trailIndex;
    saveGame.unlocked = session.unlockedTrail;
    session.saveSlots[session.activeSaveSlot] = saveGame;
    persistProgress(session.activeSaveSlot, session.trailIndex, session.unlockedTrail, trails.length);
    queueSaveSync(saveGame);
  }

  // --- Trails ----------------------------------------------------------------

  /** 'on' races your own best run; 'world' the fastest of that and the world's best. */
  function loadGhost(trail) {
    ghost = null;
    const mode = session.preferences.ghost;
    if (mode === 'off') return;
    useGhost(trail, session.trailSource === 'playtest' ? playtestBest : readGhost(trailKey(currentTrailEntry())));
    if (mode !== 'world' || !isRankedSource(session.trailSource)) return;
    const ride = session.ride;
    fetchWorldGhost(trailKey(currentTrailEntry())).then(world => {
      // The player may have restarted, switched trail or changed the setting meanwhile.
      if (!world || session.ride !== ride || session.preferences.ghost !== 'world') return;
      if (ghost && ghost.data.time <= world.time) return;
      // Steps the ghost would already have taken alongside the player.
      useGhost(trail, world, ride.started ? recorded.length - startStep : 0);
    });
  }

  function useGhost(trail, data, catchUp = 0) {
    if (!data || data.physics !== RIDE_VERSION) return;
    const inputs = decodeInputs(data.inputs);
    // Ghosts from before looks existed were always drawn as the player.
    const look = data.look || data.rider ? lookOf(data) : session.look;
    const ride = createRide(trail, { seed: data.seed, helmet: lookParts(look).helmet });
    // Play the idle lead-in now so the ghost sets off with the player.
    const lead = Math.min(data.startStep + catchUp, inputs.length);
    for (let index = 0; index < lead; index++) stepRide(ride, inputs[index]);
    ghost = { ride, inputs, index: lead, data, look };
  }

  function initializeTrail(trail, marker) {
    if (openingTrail) attempts = 0;
    openingTrail = false;
    feats.reset();
    session.trail = trail;
    const seed = replay ? replay.data.seed : (Math.random() * 2 ** 31) >>> 0;
    const ride = createRide(trail, { seed, helmet: lookParts(replay?.look ?? session.look).helmet });
    session.ride = ride;
    recorded = []; startStep = 0; flips = 0; broken = false;
    accumulator = 0; landingSoundCooldown = 0; splashSoundCooldown = 0;
    effects.reset(trail);
    renderer.reset(trail, ride.facing);
    camera.reset();
    if (replay) ghost = null;
    else loadGhost(trail);
    // The world board's best time, ready for Ghostbuster when the run finishes.
    if (isRankedSource(session.trailSource)) refreshOnlineBoard(trailKey(currentTrailEntry()));
    input.clear();
    overlay.setDirection(ride.facing);
    overlay.setTrail(trail.name, marker, ride.apples.length, trail.medals);
    overlay.setReplay(replay?.name ?? null);
    overlay.setTimer(0);
  }

  function loadTrail(index) {
    index = clamp(index, 0, session.unlockedTrail);
    session.trailSource = 'official'; session.bonusTrailIndex = -1; session.customTrailIndex = -1; session.trailIndex = index;
    initializeTrail(trails[index], String(index + 1).padStart(2, '0'));
    saveProgress();
  }

  function loadBonusTrail(index) {
    const entry = bonusTrailEntries[index];
    // A locked bonus trail stays shut, even if the menu was bypassed.
    if (!entry || !bonusUnlock(entry).open) return;
    session.trailSource = 'bonus'; session.bonusTrailIndex = index; session.customTrailIndex = -1;
    initializeTrail(entry.trail, `B${String(index + 1).padStart(2, '0')}`);
  }

  function loadCustomTrail(index) {
    const entry = customTrailEntries[index];
    if (!entry) return;
    session.trailSource = 'custom'; session.bonusTrailIndex = -1; session.customTrailIndex = index;
    initializeTrail(entry.trail, `C${String(index + 1).padStart(2, '0')}`);
  }

  // --- Replays --------------------------------------------------------------

  /**
   * Plays back a recorded run (inputs, seed and lead-in, as saved for a ghost)
   * on one of the trails. `entry` is the trail's catalog entry; without one,
   * the trail being ridden now.
   */
  function watchReplay({ entry = null, data, name }) {
    if (!data || data.physics !== RIDE_VERSION) return;
    const source = entry ? entry.source : session.trailSource;
    const index = !entry ? currentIndex()
      : source === 'official' ? officialTrailEntries.indexOf(entry)
        : source === 'bonus' ? bonusTrailEntries.indexOf(entry)
          : customTrailEntries.indexOf(entry);
    if (index < 0 && source !== 'playtest') return;
    // Ghosts from before looks existed were always drawn as the player.
    const look = data.look || data.rider ? lookOf(data) : session.look;
    replay = { source, index, data, inputs: decodeInputs(data.inputs), step: 0, look, name: name || 'Replay' };
    menu.close();
    game.classList.remove('menu-open');
    session.rideSaveId = session.saveGame?.createdAt ?? null;
    session.gameLoopStarted = true;
    restartReplay();
  }

  function currentIndex() {
    return session.trailSource === 'bonus' ? session.bonusTrailIndex
      : session.trailSource === 'custom' ? session.customTrailIndex
        : session.trailSource === 'playtest' ? 0 : session.trailIndex;
  }

  function restartReplay() {
    const { source, index } = replay;
    session.trailSource = source;
    session.bonusTrailIndex = source === 'bonus' ? index : -1;
    session.customTrailIndex = source === 'custom' ? index : -1;
    if (source === 'official') session.trailIndex = index;
    const trail = source === 'official' ? trails[index]
      : source === 'bonus' ? bonusTrailEntries[index].trail
        : source === 'custom' ? customTrailEntries[index].trail : playtestTrail;
    const marker = source === 'playtest' ? 'TEST'
      : (source === 'bonus' ? 'B' : source === 'custom' ? 'C' : '') + String(index + 1).padStart(2, '0');
    initializeTrail(trail, marker);
    // Skip the wait before the rider set off.
    replay.step = 0;
    const lead = Math.min(replay.data.startStep || 0, replay.inputs.length);
    while (replay.step < lead) stepRide(session.ride, replay.inputs[replay.step++]);
    setState('running');
    focusGame();
  }

  function endReplay() {
    replay = null;
    overlay.setReplay(null);
  }

  function finishReplay() {
    setState('won');
    $('crash-retry').hidden = false;
    // Focused, so Enter rides the trail, as it continues from the results.
    $('crash-retry').focus({ preventScroll: true });
    overlay.toast('Replay finished · Press ' + restartKey() + ' to watch again', Infinity);
    overlay.announce('Replay finished. Press ' + restartKey() + ' to watch it again, or Enter to ride the trail.');
  }

  /** Leaves a replay for a ride of your own on its trail. */
  function rideAfterReplay() {
    endReplay();
    openingTrail = true;
    startFresh();
  }

  function loadPlaytestTrail() {
    session.trailSource = 'playtest'; session.bonusTrailIndex = -1; session.customTrailIndex = -1;
    initializeTrail(playtestTrail, 'TEST');
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
    redraw = true;
    input.clear();
    if (next !== 'won') overlay.hide();
    $('crash-retry').hidden = next !== 'ragdoll';
    $('crash-retry').textContent = replay ? 'Ride This Trail' : 'Retry';
    overlay.showPause(next === 'paused');
    holdWakeLock(next === 'running' || next === 'ragdoll');
  }

  const focusGame = () => game.focus({ preventScroll: true });

  function startFresh() {
    if (replay) { restartReplay(); return; }
    if (session.trailSource === 'playtest') loadPlaytestTrail();
    else if (session.trailSource === 'bonus') loadBonusTrail(session.bonusTrailIndex);
    else if (session.trailSource === 'custom') loadCustomTrail(session.customTrailIndex);
    else loadTrail(session.trailIndex);
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
    if (session.trailSource === 'playtest') { exitPlaytest(); return; }
    if (session.state !== 'menu') session.stateBeforeMenu = session.state;
    session.state = 'menu';
    input.clear();
    overlay.hide();
    $('crash-retry').hidden = true;
    holdWakeLock(false);
    game.classList.add('menu-open');
    menu.open();
  }

  function closeMainMenu() {
    if (!menu.canResume()) return;
    menu.close();
    game.classList.remove('menu-open');
    focusGame();
    const previous = session.stateBeforeMenu;
    if (previous === 'ragdoll') setState('ragdoll');
    else if (previous === 'won') {
      // Reopen the results as they were; finishing again would save the run twice.
      setState('won');
      if (!replay) overlay.reopen();
    } else setState(previous === 'paused' ? 'paused' : 'running');
  }

  function retryFromMenu() {
    if (!menu.canResume()) return;
    menu.close();
    game.classList.remove('menu-open');
    startFresh();
  }

  function startSelectedTrail(load, requiresSave = true) {
    if (requiresSave && !session.saveGame) return;
    endReplay();
    menu.close();
    game.classList.remove('menu-open');
    openingTrail = true;
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
    else if (action === 'flip') { if (state === 'running' && !replay) flipDirection(); }
    else if (action === 'lights') toggleHeadlight();
    else if (action === 'fullscreen') toggleFullscreen();
    else if (action === 'interact') { if (state === 'running' || state === 'ragdoll') interact(); }
    else if (action === 'confirm' || action === 'cancel') {
      if (state === 'paused') resumeGame();
      else if (state === 'won' && action === 'confirm') { if (replay) rideAfterReplay(); else $('primary').click(); }
      else if (state === 'ragdoll' && action === 'confirm') startFresh();
    }
  }

  // --- Simulation ------------------------------------------------------------

  function finishPlaytestRun(ride) {
    const time = ride.elapsed;
    const previousBest = playtestBest?.time ?? null;
    lastRun = { time, startStep, seed: ride.seed, inputs: encodeInputs(recorded), physics: RIDE_VERSION, look: session.look };
    if (previousBest === null || time < previousBest) {
      playtestBest = { ...lastRun, splits: ride.splits.slice() };
    }
    const medals = session.trail.medals;
    overlay.showResults({
      official: false, time, previousBest, rank: null, medals, medal: medalFor(medals, time), flips,
      apples: ride.apples.length, author: session.trail.author,
      primaryLabel: 'Play Again',
      restartKey: restartKey()
    });
    $('overlay-badge').textContent = 'PLAY TEST COMPLETED';
    $('overlay-description').textContent = 'Play-test runs are not saved. Press Escape to return to the editor.';
    $('overlay-description').hidden = false;
    setState('won');
  }

  function finishRun(ride) {
    if (session.trailSource === 'playtest') { finishPlaytestRun(ride); return; }
    const entry = currentTrailEntry();
    const key = trailKey(entry);
    const time = ride.elapsed;
    const official = session.trailSource === 'official';
    // Official and bonus times are save bests and go online; only official ones progress the career.
    const ranked = isRankedSource(session.trailSource);
    const { saveGame } = session;
    // Taken before this run counts, so career achievements it completes are announced.
    const before = progressOf(saveGame);
    const worldBest = ranked ? cachedOnlineBoard(key)?.[0]?.time ?? null : null;
    const previousBest = official
      ? (saveGame ? readBest(session.activeSaveSlot, key, trails.length) : null)
      : ranked && saveGame
        ? readBest(session.activeSaveSlot, key, trails.length)
        // An open bonus trail can be ridden without a save, like a custom one.
        : readLeaderboard(key)[0]?.time ?? null;
    const rank = recordLeaderboardRun(key, {
      time, look: session.look, rider: legacyRider(session.look), name: saveGame?.name,
      slot: saveGame ? session.activeSaveSlot : null, saveId: saveGame?.createdAt
    });
    if (official) {
      session.unlockedTrail = Math.max(session.unlockedTrail, Math.min(session.trailIndex + 1, trails.length - 1));
      saveProgress();
    }
    if (ranked) {
      if (saveGame && (previousBest === null || time < previousBest)) {
        saveBest(session.activeSaveSlot, key, time, trails.length);
        saveGame.bestTimes[key] = time;
        queueSaveSync(saveGame);
      }
    }
    const storedGhost = readGhost(key);
    const inputs = encodeInputs(recorded);
    lastRun = { time, startStep, seed: ride.seed, inputs, physics: RIDE_VERSION, look: session.look };
    if (!storedGhost || storedGhost.physics !== RIDE_VERSION || time < storedGhost.time) {
      saveGhost(key, { time, splits: ride.splits.slice(), startStep, seed: ride.seed, inputs, physics: RIDE_VERSION, look: session.look });
    }
    earn(finishedRunAchievements(ride, previousBest, worldBest), {}, before);
    const medals = session.trail.medals;
    const last = session.trailIndex === trails.length - 1;
    // Only a run the player actually rode is sent to the world board.
    // Offline saves stay local-only. The server replays the inputs to time the run.
    const submission = ranked && session.state === 'running' && saveGame?.token
      ? submitOnlineRun(key, { look: session.look, token: saveGame.token, run: { inputs, seed: ride.seed, physics: RIDE_VERSION } })
      : null;
    overlay.showResults({
      official, bonus: session.trailSource === 'bonus', time, previousBest, rank, worldPending: !!submission,
      medals, medal: medalFor(medals, time), flips,
      apples: ride.apples.length, author: session.trail.author,
      primaryLabel: official && !last ? 'Next Trail' : 'Play Again',
      restartKey: restartKey()
    });
    if (submission) {
      const slot = session.activeSaveSlot;
      const shown = overlay.currentResults();
      submission.then(result => {
        if (result && 'signedOut' in result) {
          clearSaveToken(slot, trails.length);
          if (session.saveSlots[slot]) Object.assign(session.saveSlots[slot], { token: null, online: true });
          overlay.toast('Signed out · Log in from the menu to post world times', 5000);
        } else if (result && 'rejected' in result) egg('rejected-run');
        const standing = result && 'rank' in result ? result : null;
        // Riders who have already moved on still hear how the run placed.
        if (!overlay.showWorldStanding(shown, standing) && standing) {
          overlay.toast(`WORLD RANK #${standing.rank} OF ${standing.total}`, 4000);
        }
      });
    }
    setState('won');
    vibrate([20, 40, 20, 40, 60]);
  }

  function handleEvent(ride, event) {
    // How long the rider waited at the start, for Patience.
    if (!replay) trackAchievements(event.type === 'start' ? { ...event, wait: ride.time } : event);
    switch (event.type) {
      case 'start':
        startStep = recorded.length - 1;
        attempts++;
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
        if (event.impact > HARD_LANDING_IMPACT) {
          vibrate(Math.round(clamp(event.impact / 12, 10, 40)));
          // Shakes the snow off nearby snowy pines.
          renderer.land((ride.rear.x + ride.front.x) / 2, (ride.rear.y + ride.front.y) / 2, clamp(.4 + (event.impact - HARD_LANDING_IMPACT) / 380, .4, 1));
        }
        break;
      case 'splash':
        effects.splash(event.x, event.y, event.speed);
        if (splashSoundCooldown <= 0) {
          sounds.splash(event.speed);
          splashSoundCooldown = .15;
        }
        break;
      case 'shatter':
        effects.shatter(event);
        sounds.shatter(event.speed);
        if (session.preferences.shake === 'on') camera.kick(3);
        vibrate(30);
        break;
      case 'crack':
        effects.crack(event);
        sounds.crack(event.speed);
        vibrate(12);
        break;
      case 'crash':
        effects.burst(event.x, event.y, CRASH_COLORS[event.cause], event.cause === 'spike' ? 18 : 15);
        sounds.crash();
        if (session.preferences.shake === 'on') camera.kick(6);
        vibrate([40, 30, 80]);
        setState('ragdoll');
        overlay.announce('Rider down. Press ' + restartKey() + ' or select Retry to try again.');
        overlay.toast('Rider down · Press ' + restartKey() + ' to retry', Infinity);
        break;
      case 'helmet':
        effects.burst(event.x, event.y, riderPalette(replay?.look ?? session.look).helmet, 8);
        sounds.helmet(event.speed);
        vibrate(25);
        overlay.announce('The helmet came off.');
        break;
      case 'apple': {
        effects.burst(event.apple.x, event.apple.y, '#ef8150');
        sounds.apple();
        overlay.setApples(event.collected, event.total);
        overlay.announce(event.collected + ' of ' + event.total + ' apples collected.');
        const ghostSplit = ghost?.data.splits?.[event.collected - 1];
        if (Number.isFinite(ghostSplit)) overlay.split(event.split - ghostSplit);
        if (event.collected === event.total) overlay.toast('All apples collected! Finish gate unlocked', undefined, 'flag');
        break;
      }
      case 'goalLocked':
        // Only at the finish do the missing apples get pointed out, so
        // finding them along the way stays part of the trail.
        overlay.toast(event.missing + (event.missing === 1 ? ' apple left to collect!' : ' apples left to collect!'), 4000);
        renderer.pointToApples(4);
        break;
      case 'win': {
        const mx = (ride.rear.x + ride.front.x) / 2, my = (ride.rear.y + ride.front.y) / 2;
        effects.burst(mx, my - 55, '#e8964f', 25);
        sounds.win();
        if (replay) finishReplay();
        else finishRun(ride);
        break;
      }
    }
  }

  function physicsStep() {
    const ride = session.ride;
    const thunder = effects.stepWeather();
    if (thunder) sounds.thunder(thunder.intensity, thunder.distance, thunder.x);
    landingSoundCooldown = Math.max(0, landingSoundCooldown - STEP);
    splashSoundCooldown = Math.max(0, splashSoundCooldown - STEP);
    physicsDebug.begin({ state: session.state, time: ride.elapsed, trail: session.trail.name, source: session.trailSource, facing: ride.facing, throttle: ride.throttle }, ride.rear, ride.front);

    // Holding restart keeps the bike on the start line with the clock stopped.
    const holding = input.held('restart');
    const replayInput = physicsDebug.nextReplayInput();
    const stepInput = replay ? {
      facing: ride.facing, leanInput: 0, accelerating: false, braking: false,
      ...replay.inputs[replay.step++]
    } : replayInput ? {
      facing: Number(replayInput.facing) ? (replayInput.facing < 0 ? -1 : 1) : ride.facing,
      leanInput: replayInput.leanInput ?? 0,
      accelerating: Boolean(replayInput.accelerating),
      braking: Boolean(replayInput.braking)
    } : {
      facing: ride.facing,
      // Rounded like the replay codec, so the recorded run is exactly the run
      // that was simulated and replays (ghost, server check) match it.
      leanInput: holding ? 0 : Math.round(input.leanInput() * 100) / 100,
      accelerating: !holding && input.held('up'),
      braking: !holding && input.held('down')
    };
    const running = ride.status === 'running';
    gasHeld = running && stepInput.accelerating && !stepInput.braking;
    physicsDebug.recordInput({ ...stepInput, accelerating: running && stepInput.accelerating, braking: running && stepInput.braking });
    if (running && !replay) recorded.push(stepInput);
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
    effects.waterWake(ride, speed);
    effects.brakeMarks(ride, speed, stepInput.braking);
    effects.wheelGrime(ride, stepInput.braking);
    // A crash throws away the feat in progress; reaching the finish completes it.
    if (replay) feats.reset();
    else if (ride.status === 'running') feats.step(ride.rear.grounded, ride.front.grounded).forEach(trackAchievements);
    else if (ride.status === 'won') feats.finish().forEach(trackAchievements);
    else feats.reset();
    for (const event of events) handleEvent(ride, event);
    if (!broken && !replay && ride.status === 'running' && bikeBroken(ride.rear, ride.front)) {
      broken = true;
      egg('kraken');
    }
  }

  // --- Frame loop ----------------------------------------------------------

  function frame(now) {
    fpsMeter?.frame(now);
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
      const still = session.state === 'paused' || (session.state === 'won' && renderer.settled());
      if (!still || redraw) {
        redraw = false;
        const restore = interpolateRide(ride, alpha);
        const ghostRide = ghost?.ride;
        // A finished ghost is no longer stepped: hold it where it stopped.
        const restoreGhost = ghostRide ? interpolateRide(ghostRide, ghostRide.status === 'won' ? 1 : alpha) : null;
        renderer.draw({
          ride, ghost: ghostRide, camera, effects, look: replay?.look ?? session.look, ghostLook: ghost?.look, state: session.state,
          full: session.preferences.scenery === 'full', dt, debug: physicsDebugEnabled
        });
        restoreGhost?.();
        restore();
        if (renderer.takeWoofs()) sounds.woof();
      }
    }
    fpsMeter?.drawn(now);
    sounds.update();
    requestAnimationFrame(frame);
  }

  // --- Wiring ----------------------------------------------------------------

  game.addEventListener('keydown', event => {
    if (input.capturing) { input.keyDown(event); return; }
    if (event.code === 'Escape') {
      event.preventDefault();
      // With the keyboard lock held, Esc can repeat; one press must be one action.
      if (event.repeat) return;
      sounds.escape();
      if (menu.isOpen()) { if (!menu.back()) closeMainMenu(); }
      else if (session.state === 'paused') resumeGame();
      else showMainMenu();
      return;
    }
    if (menu.isOpen()) return;
    input.keyDown(event);
  });
  // Auto-pause fires when focus leaves the game, so resuming must not need it.
  document.addEventListener('keydown', event => {
    if (event.repeat) return;
    if (game.contains(/** @type {Node} */ (event.target)) || session.state !== 'paused') return;
    if (session.preferences.bindings.pause.includes(event.code) || event.code === 'Escape') { event.preventDefault(); resumeGame(); }
  });
  window.addEventListener('keyup', event => input.keyUp(event));
  game.addEventListener('focusout', event => {
    if (!game.contains(/** @type {Node} */ (event.relatedTarget))) { input.clear(); pauseGame(); }
  });
  $('canvas').addEventListener('pointerdown', focusGame);
  // On touch screens, tapping the game tells a nearby Coda to sit.
  $('canvas').addEventListener('pointerdown', () => { if (!menu.isOpen()) handlePress('interact'); });
  window.addEventListener('blur', () => { input.clear(); pauseGame(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { input.clear(); pauseGame(); }
    else {
      holdWakeLock(session.state === 'running' || session.state === 'ragdoll');
      // Another device may have changed the rider while this tab was away.
      if (menu.isOpen()) menu.refreshCloudSave();
    }
    lastTime = 0; accumulator = 0;
  });

  $('primary').addEventListener('click', () => {
    // On the last trail the button reads Play Again, so it falls through to a retry.
    if (session.state === 'won' && session.trailSource === 'official' && session.trailIndex < trails.length - 1) {
      openingTrail = true;
      loadTrail(session.trailIndex + 1);
      setState('running'); focusGame();
    } else startFresh();
  });
  $('secondary').addEventListener('click', startFresh);
  $('watch-replay').addEventListener('click', () => {
    if (session.state === 'won' && lastRun) watchReplay({ data: lastRun, name: session.saveGame?.name || 'Your run' });
  });
  // Focus the game first: hiding the focused button would blur it and auto-pause.
  $('crash-retry').addEventListener('click', () => { focusGame(); if (replay) rideAfterReplay(); else startFresh(); });
  $('headlight').addEventListener('click', () => { toggleHeadlight(); focusGame(); });
  $('sound-control').addEventListener('click', () => { toggleSound(); focusGame(); });
  // A click rather than a data-action: the touch buttons only work mid-ride,
  // and restart is wanted most after a crash.
  $('restart-control').addEventListener('click', () => handlePress('restart'));
  $('menu').addEventListener('click', () => { sounds.menuBack(); showMainMenu(); });
  document.querySelectorAll('[data-fullscreen]').forEach(button => button.addEventListener('click', () => {
    const wantOn = button.dataset.fullscreen === 'on';
    if (wantOn !== Boolean(fullscreenElement())) toggleFullscreen();
  }));
  const fullscreenSupported = Boolean(document.fullscreenEnabled || document.webkitFullscreenEnabled || game.webkitRequestFullscreen);
  $('setting-fullscreen-group').hidden = !fullscreenSupported;
  syncFullscreenSetting();
  document.addEventListener('fullscreenchange', handleFullscreenChange);
  document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
  function resize() {
    renderer.resize();
    redraw = true;
  }
  window.addEventListener('resize', () => { resize(); menu.drawBackground(); });
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe($('canvas'));
  window.addEventListener('gamepadconnected', () => { if (menu.isOpen()) sounds.menuMove(); });

  const unlockAudio = () => sounds.init();
  window.addEventListener('pointerdown', unlockAudio, { once: true, capture: true });
  window.addEventListener('keydown', unlockAudio, { once: true, capture: true });
  const lim = createLimWatcher();
  window.addEventListener('keydown', event => {
    if (event.repeat || !lim.down(event.code)) return;
    console.info('[Hjulben] You now have 100% Health, 99 Ammo and both Keys! Note that you have basically eliminated your chances of getting a high score!');
    egg('lim');
  }, { capture: true });
  window.addEventListener('keyup', event => lim.up(event.code), { capture: true });
  window.addEventListener('blur', () => lim.clear());
  installConsoleCheats(() => egg('cheat'));

  loadStoredState();
  applyPreferences();
  handleFullscreenChange();
  resize();
  if (playtestTrail) {
    $('menu').setAttribute('aria-label', 'Back to the editor');
    startSelectedTrail(loadPlaytestTrail, false);
  } else if (shared?.entry) {
    startSelectedTrail(() => loadCustomTrail(customTrailEntries.indexOf(shared.entry)), false);
    overlay.toast(`Shared trail “${shared.entry.name}” · Saved under Custom Trails`, 5000);
  } else {
    showMainMenu();
    if (shared?.error) menu.showTrailsStatus(`Could not open the shared trail: ${shared.error.message}`, true);
  }
  requestAnimationFrame(frame);
  // Queued after the first frame, so the reveal shows a fully drawn screen.
  requestAnimationFrame(() => game.removeAttribute('data-booting'));
}
