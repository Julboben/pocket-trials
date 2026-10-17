// Main menu: savegames, trail select, leaderboard, achievements, settings and how-to-play.
import { clamp } from '../config.js';
import { trails, officialTrailEntries, bonusTrailEntries, customTrailEntries, saveBrowserTrail } from '../trails.js';
import { createGameArt } from '../drawing.js';
import { drawScene, posedRide, parkedRide, findClimb, findJump, finishScene, findHighlight } from '../scene-preview.js';
import {
  loadSaveSlots, loadActiveSlot, saveActiveSlot, createSave, deleteSave, readBest,
  readLeaderboard, LEADERBOARD_SIZE, loadPreferences, savePreferences, cleanRiderName,
  restoreOnlineSave, linkSave, readGhost, saveLook, loadSeenVersion, saveSeenVersion, applyCloudSave, clearSaveToken, hasNisse
} from '../storage.js';
import { DEFAULT_LOOK, keepIdentity, lookKey, sameLook, starterLook } from '../cosmetics.js';
import { createCustomizer, createIdentityPicker, drawLook } from './customizer.js';
import { ONLINE_LEADERBOARD_EVENT, isOnlineBoardLoading, isOnlineTrail, fetchWorldGhost, settledWorldGhost, refreshOnlineBoard, submitOnlineRun } from '../online-leaderboard.js';
import { registerRider, loginRider, accountErrorText, passkeysSupported, queueSaveSync, fetchCloudSave } from '../account.js';
import { isSandbox } from '../local-store.js';
import { NAME_HINT, disallowedNameChars } from '../rider-name.js';
import { RIDE_VERSION } from '../ride.js';
import { normalizeAuthor, normalizeTrail, validateTrail, medalFor } from '../trail-schema.js';
import { ACTION_LABELS, keyLabel } from '../input.js';
import { createGamepadDiagram } from './gamepad-diagram.js';
import { VERSION } from '../version.js';
import { RELEASES } from '../changelog.js';
import { ACHIEVEMENTS, ACHIEVEMENT_GROUPS, statProgressText } from '../achievements.js';
import {
  $, session, DEFAULT_BINDINGS, DEFAULT_PREFERENCES, sanitizePreferences,
  leaderboardTrails, trailKey, nisseKey, trailMarker, runTimeText, bonusUnlock, lookOwner, riderLook, lookItemHint, progressOf
} from '../state.js';

// Runs made without a savegame have no name.
const runnerName = name => name || 'RIDER';

/** Loads saves and preferences into the session. */
export function loadStoredState() {
  session.preferences = sanitizePreferences(loadPreferences(DEFAULT_PREFERENCES));
  session.saveSlots = loadSaveSlots(trails.length);
  session.activeSaveSlot = loadActiveSlot();
  session.saveGame = session.saveSlots[session.activeSaveSlot];
  if (!session.saveGame) {
    const firstOccupied = session.saveSlots.findIndex(Boolean);
    if (firstOccupied >= 0) {
      session.activeSaveSlot = firstOccupied;
      session.saveGame = session.saveSlots[firstOccupied];
      saveActiveSlot(firstOccupied);
    }
  }
  session.unlockedTrail = session.saveGame?.unlocked || 0;
  session.savedTrail = session.saveGame?.trail || 0;
  session.look = riderLook();
}

/**
 * @param {{
 *   sounds: any, input: any,
 *   onStartTrail: (index: number) => void,
 *   onStartBonus: (index: number) => void,
 *   onStartCustom: (index: number) => void,
 *   onClose: () => void,
 *   onRetry: () => void,
 *   onPreferences: () => void
 * }} hooks
 */
export function createMenu({ sounds, input, onStartTrail, onStartBonus, onStartCustom, onClose, onRetry, onPreferences, onWatchReplay, onRiderChange }) {
  let pendingSaveSlot = 0;
  $('app-version').textContent = 'v' + VERSION;
  let deleteArmedSlot = -1, deleteArmTimer = 0, leaderboardTrail = 0;
  let creatorFromRiders = false;
  // Sandbox riders are throwaway, so they never get an online account.
  const onlineAvailable = passkeysSupported() && !isSandbox();
  let saveMode = onlineAvailable ? 'online' : 'offline';
  /** True while a passkey prompt or account request is in flight. */
  let accountBusy = false;

  const isOpen = () => !$('menu-screen').hidden;

  // Fresh world results rebuild the board while the menu is on screen.
  window.addEventListener(ONLINE_LEADERBOARD_EVENT, () => {
    if (isOpen()) buildLeaderboard();
  });

  // Opening the board, flipping to a trail or coming back to the tab fetches
  // other riders' runs, unless the board is only seconds old.
  const BOARD_VIEW_MAX_AGE = 5_000;
  const isBoardShown = () => isOpen() && !$('menu-leaderboard-view').hidden;
  const shownBoardKey = () => trailKey(leaderboardTrails()[leaderboardTrail]);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && isBoardShown()) refreshOnlineBoard(shownBoardKey(), BOARD_VIEW_MAX_AGE);
  });

  // Typing a name must not reach the game's key handlers (W/A/S/D, R, Esc).
  // Escape is left alone so it still closes the menu.
  const nameInput = $('new-save-name');
  for (const type of ['keydown', 'keyup', 'keypress']) {
    nameInput.addEventListener(type, event => { if (event.key !== 'Escape') event.stopPropagation(); });
  }
  nameInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); $('new-save-next').click(); }
  });
  // Says which characters won't be kept, instead of dropping them silently.
  nameInput.addEventListener('input', () => {
    nameInput.classList.remove('invalid');
    const bad = disallowedNameChars(nameInput.value);
    setStatus('save-status', bad.length ? `Can’t use ${bad.join(' ')} in names. ${NAME_HINT}.` : '', bad.length > 0);
    if (bad.length) nameInput.classList.add('invalid');
  });

  /** A ride is only resumable while it still belongs to the active save. */
  function canResume() {
    if (!session.gameLoopStarted) return false;
    if (session.trailSource === 'official' && !session.saveGame) return false;
    return (session.saveGame?.createdAt ?? null) === session.rideSaveId;
  }

  function startTrail(index) {
    session.rideSaveId = session.saveGame?.createdAt ?? null;
    onStartTrail(index);
  }

  function startBonus(index) {
    session.rideSaveId = session.saveGame?.createdAt ?? null;
    onStartBonus(index);
  }

  function startCustom(index) {
    session.rideSaveId = session.saveGame?.createdAt ?? null;
    onStartCustom(index);
  }

  // Menu art is drawn by the game's renderer from the trails themselves, a
  // frame at a time, and kept until the rider or scenery changes.
  // Room for the trail cards plus a slot's worth of look swatches and avatars.
  const PREVIEW_CACHE_SIZE = 96;
  const previewCache = new Map();
  let previewQueue = [], previewFrame = 0;

  /** A cache key for a scene that shows the active rider. */
  function previewKey(...parts) {
    return sceneKey(...parts, lookKey(session.look));
  }

  /** A cache key for a scene, with the settings that change how it looks. */
  function sceneKey(...parts) {
    const { scenery, headlight } = session.preferences;
    return [...parts, scenery, headlight].join('|');
  }

  function sceneOptions() {
    return {
      look: session.look,
      full: session.preferences.scenery === 'full',
      headlights: session.preferences.headlight !== 'off'
    };
  }

  function copyPreview(source, target) {
    target.width = source.width;
    target.height = source.height;
    const context = target.getContext('2d');
    context.imageSmoothingEnabled = false;
    context.drawImage(source, 0, 0);
  }

  function renderPreview(key, render) {
    let image = previewCache.get(key);
    if (!image) {
      image = document.createElement('canvas');
      render(image);
      previewCache.set(key, image);
      if (previewCache.size > PREVIEW_CACHE_SIZE) previewCache.delete(previewCache.keys().next().value);
    }
    return image;
  }

  /** Paints a cached preview now, or queues it so menus open without a stall. */
  function paintPreview(target, key, render, { now = false } = {}) {
    if (now || previewCache.has(key)) { copyPreview(renderPreview(key, render), target); return; }
    previewQueue = previewQueue.filter(job => job.target !== target);
    previewQueue.push({ target, key, render });
    previewFrame ||= requestAnimationFrame(drainPreviews);
  }

  function drainPreviews() {
    previewFrame = 0;
    if (!isOpen()) { previewQueue = []; return; }
    let job;
    while ((job = previewQueue.shift()) && !job.target.isConnected);
    if (job) copyPreview(renderPreview(job.key, job.render), job.target);
    if (previewQueue.length) previewFrame = requestAnimationFrame(drainPreviews);
  }

  /** A rider's head, as a round avatar for the rider list and leaderboard. */
  function riderAvatar(look) {
    const avatar = document.createElement('span');
    avatar.className = 'save-avatar';
    const portrait = document.createElement('canvas');
    portrait.setAttribute('aria-hidden', 'true');
    paintPreview(portrait, sceneKey('avatar', lookKey(look)), image => drawLook(image, look, 'head'));
    avatar.append(portrait);
    return avatar;
  }

  function drawActiveSaveIllustration() {
    const canvasElement = $('active-save-bike');
    if (!session.saveGame) {
      canvasElement.getContext('2d').clearRect(0, 0, canvasElement.width, canvasElement.height);
      return;
    }
    const entry = officialTrailEntries[session.savedTrail];
    paintPreview(canvasElement, previewKey('continue', trailKey(entry)), image => drawScene(image, {
      ...sceneOptions(), trail: entry.trail, width: 120, height: 84
    }), { now: true });
  }

  // Creating a rider takes two steps: who they are (name, gender, skin), then
  // their style. The Garage changes the active rider's style later.
  const customizerHooks = { paint: paintPreview, previewKey: sceneKey, hint: lookItemHint };
  // Until the style step is changed by hand, it follows the gender picked.
  let creatorTouched = false;
  const identityPicker = createIdentityPicker($('new-save-identity'), {
    ...customizerHooks,
    onChange: identity => creator.setLook(creatorTouched
      ? keepIdentity(creator.look(), identity)
      : starterLook(identity.gender, identity.skin))
  });
  const creator = createCustomizer($('new-save-look'), {
    ...customizerHooks,
    onChange: look => { creatorTouched = !sameLook(look, starterLook(look.gender, look.skin)); }
  });
  // The Garage offers what the active rider has unlocked, checked when it opens.
  let garageOwns = lookOwner(null);
  const garage = createCustomizer($('garage-look'), {
    ...customizerHooks, onChange: syncGarage, owns: (slot, id) => garageOwns(slot, id)
  });
  garage.actions.append($('save-look'));

  function showSaveStep(step) {
    $('new-save-identity-step').hidden = step !== 1;
    $('new-save-style-step').hidden = step !== 2;
    $('new-save-step-1').classList.toggle('active', step === 1);
    $('new-save-step-2').classList.toggle('active', step === 2);
    $('new-save-title').textContent = step === 1 ? 'Who are you?' : 'Pick your style';
    if (step === 2) creator.refresh();
  }

  /** Checks the rider name before moving on; false (and a marked field) if it won't do. */
  function checkNewSaveName() {
    const name = cleanRiderName(nameInput.value);
    if (name && !disallowedNameChars(nameInput.value).length) return name;
    showSaveStep(1);
    nameInput.classList.add('invalid');
    nameInput.focus();
    return null;
  }

  function syncGarage() {
    $('save-look').disabled = !session.saveGame || sameLook(garage.look(), session.look);
  }

  function openGarage() {
    if (!session.saveGame) return;
    $('garage-rider').textContent = session.saveGame.name;
    garageOwns = lookOwner(session.saveGame);
    // Opens on the tab the rider was last on.
    garage.setLook(session.look);
    syncGarage();
    showView('look');
  }

  /** True while the Garage shows a look that differs from the saved one. */
  function garageUnsaved() {
    return !$('menu-look-view').hidden && Boolean(session.saveGame) && !sameLook(garage.look(), session.look);
  }

  const lookConfirm = /** @type {HTMLDialogElement} */ ($('look-confirm'));
  const isLookConfirmOpen = () => lookConfirm.open;

  // Leaving the Garage with an unsaved look asks first, so Back never silently drops it.
  function setLookConfirm(open) {
    if (open && !lookConfirm.open) lookConfirm.showModal();
    else if (!open && lookConfirm.open) lookConfirm.close();
    if (open) requestAnimationFrame(() => selectControl($('look-confirm-save')));
  }

  function closeLookConfirm() {
    if (!isLookConfirmOpen()) return false;
    setLookConfirm(false);
    selectControl($('save-look'));
    return true;
  }

  function discardGarageLook() {
    setLookConfirm(false);
    updateDashboard();
    showView('home');
  }

  function saveGarageLook() {
    if (!session.saveGame) return;
    const saved = saveLook(session.activeSaveSlot, trails.length, garage.look(), garageOwns);
    setLookConfirm(false);
    if (!saved) return;
    session.saveSlots[session.activeSaveSlot] = saved;
    session.saveGame = saved;
    session.look = saved.look;
    queueSaveSync(saved);
    updateDashboard();
    showView('home');
  }

  function selectSaveSlot(index) {
    session.activeSaveSlot = clamp(index, 0, session.saveSlots.length - 1);
    saveActiveSlot(session.activeSaveSlot);
    session.saveGame = session.saveSlots[session.activeSaveSlot];
    session.unlockedTrail = session.saveGame?.unlocked || 0;
    session.savedTrail = session.saveGame?.trail || 0;
    session.look = riderLook();
    updateDashboard();
    onRiderChange();
  }

  function disarmDelete() {
    clearTimeout(deleteArmTimer);
    deleteArmedSlot = -1;
    document.querySelectorAll('.delete-save.armed').forEach(button => {
      button.classList.remove('armed');
      button.textContent = '×';
      button.setAttribute('aria-label', 'Delete save slot ' + (Number(button.dataset.slot) + 1));
    });
  }

  function deleteSlot(index, button) {
    if (deleteArmedSlot !== index) {
      disarmDelete();
      deleteArmedSlot = index;
      button.textContent = 'SURE?';
      button.classList.add('armed');
      button.setAttribute('aria-label', 'Press again to delete save slot ' + (index + 1));
      deleteArmTimer = setTimeout(disarmDelete, 3000);
      return;
    }
    disarmDelete();
    deleteSave(index, trails.length);
    session.saveSlots[index] = null;
    if (index === session.activeSaveSlot) {
      const fallback = session.saveSlots.findIndex(Boolean);
      selectSaveSlot(fallback >= 0 ? fallback : index); // also refreshes the dashboard
    } else updateDashboard();
    requestAnimationFrame(() => selectControl($('save-slots').children[index]?.querySelector('.save-slot')));
  }

  function buildSaveSlots() {
    const rows = session.saveSlots.map((save, index) => {
      const row = document.createElement('div');
      row.className = 'save-slot-row';
      const button = document.createElement('button');
      button.className = 'save-slot';
      button.setAttribute('aria-pressed', String(Boolean(save) && index === session.activeSaveSlot));
      const active = save && index === session.activeSaveSlot ? ' · ACTIVE' : '';
      const mode = save ? (save.token ? ' · ONLINE' : save.online ? ' · SIGNED OUT' : ' · OFFLINE') : '';
      const gender = save?.look.gender === 'female' ? 'female' : 'male';
      button.innerHTML = save
        ? '<span class="save-slot-copy"><span class="save-label">SLOT ' + (index + 1) + active + mode + '</span>'
          // The rider's gender before their name, in the creator's symbols.
          + '<span class="save-slot-name"><span class="save-gender" data-gender="' + gender + '" data-icon="' + gender + '" aria-hidden="true"></span>'
          + '<strong>' + save.name + '<span class="sr-only">, ' + gender + '</span></strong></span><small>'
          + (save.unlocked + 1) + ' / ' + trails.length + ' trails · ' + trails[save.trail].name + '</small></span>'
        : '<span class="save-avatar empty"><span data-icon="plus" aria-hidden="true"></span></span>'
          + '<span class="save-slot-copy"><span class="save-label">SLOT ' + (index + 1) + '</span><strong>NEW RIDER</strong><small>Start a fresh career in this slot</small></span>';
      if (save) button.prepend(riderAvatar(save.look));
      button.addEventListener('click', () => {
        if (save) { selectSaveSlot(index); showView('home'); return; }
        creatorFromRiders = true;
        showSaveCreator(index);
      });
      row.append(button);
      if (save && !save.token && onlineAvailable) {
        // A signed-out online rider logs back in; an offline one claims its name.
        const link = document.createElement('button');
        link.className = 'link-save';
        link.type = 'button';
        link.textContent = save.online ? 'LOG IN' : 'GO ONLINE';
        link.disabled = accountBusy;
        link.setAttribute('aria-label', (save.online ? 'Log ' + save.name + ' back in' : 'Take ' + save.name + ' online') + ' with a passkey');
        link.addEventListener('click', () => (save.online ? logIn('riders-status') : goOnline(index)));
        row.classList.add('has-link');
        row.append(link);
      }
      if (save) {
        const remove = document.createElement('button');
        remove.className = 'delete-save';
        remove.type = 'button';
        remove.textContent = '×';
        remove.dataset.slot = String(index);
        remove.setAttribute('aria-label', 'Delete save slot ' + (index + 1));
        remove.addEventListener('click', () => deleteSlot(index, remove));
        row.append(remove);
      }
      return row;
    });
    $('save-slots').replaceChildren(...rows);
  }

  function goBack() {
    if (closeLookConfirm()) return;
    if (garageUnsaved()) { setLookConfirm(true); return; }
    if (!$('menu-save-view').hidden && $('new-save-identity-step').hidden) { showSaveStep(1); return; }
    if (!$('menu-save-view').hidden && creatorFromRiders) { showView('riders'); return; }
    updateDashboard();
    showView('home');
  }

  // Each card shows its move where it really happens on the official trails.
  const HOW_TO_SCENES = {
    drive: () => {
      const trail = trails[0];
      return { trail, ride: posedRide(trail) };
    },
    lean: () => {
      const climb = findClimb(trails);
      if (!climb) return HOW_TO_SCENES.drive();
      return { trail: climb.trail, ride: posedRide(climb.trail, { x: climb.x, facing: climb.facing, lean: .8 }) };
    },
    air: () => {
      const jump = findJump(trails);
      const trail = jump?.trail ?? trails[0];
      const ride = posedRide(trail, { x: jump?.x ?? trail.start.x, facing: jump?.facing ?? trail.start.facing, air: 16, ground: jump?.lip, lean: -.2 });
      // Higher in the frame, so the lip it took off from shows below.
      return { trail, ride, arc: true, anchor: [.5, .6] };
    },
    goal: () => {
      const trail = trails[0];
      return { trail, ...finishScene(trail) };
    }
  };

  function drawHowToPlayIllustrations() {
    document.querySelectorAll('[data-how-art]').forEach(canvasElement => {
      const kind = canvasElement.dataset.howArt;
      const scene = HOW_TO_SCENES[kind];
      if (!scene) return;
      paintPreview(canvasElement, previewKey('how', kind), image => {
        const { trail, ride, focus, anchor, arc } = scene();
        const view = drawScene(image, { ...sceneOptions(), trail, ride, focus, anchor, width: 240, height: 100 });
        if (!arc) return;
        // The path through the air, as a guide drawn over the scene.
        const context = image.getContext('2d');
        const scale = view.worldToDevice;
        const x = ((ride.rear.x + ride.front.x) / 2 - view.x) * scale;
        const y = ((ride.rear.y + ride.front.y) / 2 - view.y + 12) * scale;
        context.save();
        context.strokeStyle = '#d96842'; context.lineWidth = 2 * scale; context.setLineDash([5 * scale, 4 * scale]);
        context.beginPath();
        if (ride.facing > 0) context.arc(x, y, 47 * scale, Math.PI * 1.1, Math.PI * 1.82);
        else context.arc(x, y, 47 * scale, Math.PI * 1.18, Math.PI * 1.9);
        context.stroke();
        context.restore();
      });
    });
  }

  function drawBackground() {
    const backgroundCanvas = $('menu-background');
    const bounds = backgroundCanvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    backgroundCanvas.width = Math.round(bounds.width * dpr);
    backgroundCanvas.height = Math.round(bounds.height * dpr);
    const backgroundContext = backgroundCanvas.getContext('2d');
    backgroundContext.setTransform(dpr, 0, 0, dpr, 0, 0);
    backgroundContext.imageSmoothingEnabled = false;
    createGameArt(backgroundContext).drawBackground({
      width: bounds.width, height: bounds.height,
      palette: trails[session.saveGame?.trail || 0],
      cameraX: 260, cameraY: 0,
      full: session.preferences.scenery === 'full'
    });
  }

  function updateDashboard() {
    const hasSave = Boolean(session.saveGame);
    drawActiveSaveIllustration();
    $('active-save-slot').textContent = 'SLOT ' + (session.activeSaveSlot + 1);
    $('active-save-rider').textContent = hasSave ? session.saveGame.name : '';
    $('active-save-progress').textContent = hasSave ? (session.unlockedTrail + 1) + ' / ' + trails.length + ' trails · ' + trails[session.savedTrail].name : '';
    $('menu-trails').disabled = !hasSave && customTrailEntries.length === 0
      && !bonusTrailEntries.some(entry => bonusUnlock(entry).open);
    // One orange call to action: resume a ride, else continue the save, else start one.
    const resumable = canResume();
    $('menu-resume').hidden = !resumable;
    // Retry sits beside Resume whenever there is a ride to restart.
    $('menu-retry').hidden = !resumable;
    $('menu-resume').classList.toggle('menu-action-half', resumable);
    $('menu-continue').hidden = !hasSave;
    $('menu-continue').classList.toggle('menu-action-primary', !resumable);
    $('menu-first-ride').hidden = hasSave;
    $('menu-first-ride').classList.toggle('menu-action-primary', !resumable);
    $('menu-riders').hidden = !hasSave;
    $('menu-garage').hidden = !hasSave;
    $('menu-achievements').hidden = !hasSave;
    if (hasSave) $('menu-achievements-detail').textContent = earnedCount(progressOf(session.saveGame)) + ' / ' + ACHIEVEMENTS.length + ' earned';
    if (resumable) {
      $('menu-resume-detail').textContent = 'Back to ' + (session.trail?.name ?? 'the trail')
        + (session.stateBeforeMenu === 'paused' ? ' · paused' : '');
    }
    buildSaveSlots();
    drawBackground();
    drawHowToPlayIllustrations();
    buildTrailCards();
  }

  function controls() {
    if (isLookConfirmOpen()) return [...$('look-confirm').querySelectorAll('button')];
    const visibleView = document.querySelector('.menu-view:not([hidden])');
    // Skips controls in hidden parts of the view, such as another tab's panel.
    return visibleView ? [...visibleView.querySelectorAll('button:not([disabled]), input:not([disabled])')]
      .filter(control => !control.closest('[hidden]')) : [];
  }

  function selectControl(control) {
    document.querySelectorAll('.menu-selected').forEach(item => item.classList.remove('menu-selected'));
    if (!control) return;
    control.classList.add('menu-selected');
    control.focus({ preventScroll: false });
  }

  function moveSelection(direction) {
    const list = controls();
    if (!list.length) return false;
    const selected = $('menu-screen').querySelector('.menu-selected');
    const current = list.indexOf(selected);
    const next = current < 0 ? 0 : (current + direction + list.length) % list.length;
    selectControl(list[next]);
    sounds.menuMove();
    return true;
  }

  /** LB / RB on a gamepad: the previous or next tab of the open view's tab bar, wrapping round. */
  function stepTab(direction) {
    if (isLookConfirmOpen()) return;
    const tablist = [...document.querySelectorAll('.menu-view:not([hidden]) [role="tablist"]')]
      .find(list => !list.closest('[hidden]'));
    if (!tablist) return;
    const tabs = [...tablist.querySelectorAll('[role="tab"]')];
    const current = tabs.findIndex(tab => tab.getAttribute('aria-selected') === 'true');
    const next = /** @type {HTMLElement} */ (tabs[(current + direction + tabs.length) % tabs.length]);
    next.click();
    selectControl(next);
  }

  /** Settings tabs; the one picked stays picked for the next visit. */
  function showSettingsTab(picked) {
    document.querySelectorAll('#menu-settings-view [role="tab"]').forEach(tab => {
      tab.setAttribute('aria-selected', String(tab === picked));
      $(tab.getAttribute('aria-controls')).hidden = tab !== picked;
    });
  }

  function showView(view) {
    disarmDelete();
    setTrailPicker(false);
    setLookConfirm(false);
    $('menu-home').hidden = view !== 'home';
    $('menu-riders-view').hidden = view !== 'riders';
    $('menu-trail-view').hidden = view !== 'trails';
    $('menu-leaderboard-view').hidden = view !== 'leaderboard';
    $('menu-save-view').hidden = view !== 'save';
    $('menu-look-view').hidden = view !== 'look';
    $('menu-how-view').hidden = view !== 'how';
    $('menu-settings-view').hidden = view !== 'settings';
    $('menu-changelog-view').hidden = view !== 'changelog';
    $('menu-achievements-view').hidden = view !== 'achievements';
    $('menu-scroll').scrollTop = 0;
    requestAnimationFrame(() => {
      const list = controls();
      // The login shortcut is for returning riders, so a new rider starts on the form.
      selectControl(list.find(button => !button.matches('[data-menu-back], #save-login-button')) || list[0]);
    });
  }

  function open() {
    $('menu-screen').hidden = false;
    // Catches up with a cloud look that arrived while riding.
    if (session.saveGame) session.look = riderLook();
    syncWhatsNew();
    updateDashboard();
    showView('home');
    requestAnimationFrame(() => selectControl($(canResume() ? 'menu-resume' : session.saveGame ? 'menu-continue' : 'menu-first-ride')));
    refreshCloudSave();
  }

  /**
   * Pulls the active online rider's look and progress from the cloud, so a
   * change made on another device shows up here without logging in again.
   */
  async function refreshCloudSave() {
    const slot = session.activeSaveSlot;
    const token = session.saveGame?.token;
    if (!token) return;
    const cloud = await fetchCloudSave(token);
    // The rider may have switched slots, signed out, or left the menu meanwhile.
    if (!cloud || session.activeSaveSlot !== slot || session.saveGame?.token !== token) return;
    if ('signedOut' in cloud) {
      clearSaveToken(slot, trails.length);
      session.saveSlots = loadSaveSlots(trails.length);
      session.saveGame = session.saveSlots[slot];
      if (isOpen()) buildSaveSlots();
      return;
    }
    const result = applyCloudSave(slot, trails.length, cloud);
    if (!result) return;
    if (result.ahead) queueSaveSync(result.save);
    if (!result.changed) return;
    session.saveSlots[slot] = result.save;
    session.saveGame = result.save;
    session.unlockedTrail = result.save.unlocked;
    // Mid-ride the rider keeps their look until they are back in the menu.
    if (!isOpen()) return;
    session.look = riderLook();
    // An open Garage keeps the look being edited; Home and the rest redraw.
    if ($('menu-look-view').hidden) updateDashboard();
  }

  function close() {
    setLookConfirm(false);
    $('menu-screen').hidden = true;
  }

  // Riders from an earlier version get a NEW badge on What's new until they
  // open it. Brand-new players have nothing to catch up on.
  function syncWhatsNew() {
    let seen = loadSeenVersion();
    if (seen === null && !session.saveSlots?.some(Boolean)) {
      seen = VERSION;
      saveSeenVersion(seen);
    }
    $('whats-new-badge').hidden = seen === VERSION;
  }

  const CHANGE_LABELS = { 'heads-up': 'HEADS UP', new: 'NEW', improved: 'IMPROVED', fixed: 'FIXED' };

  function buildChangelog() {
    const releases = RELEASES.map((release, index) => {
      const article = document.createElement('article');
      article.className = 'changelog-release';
      const head = document.createElement('header');
      const title = document.createElement('h4');
      title.textContent = 'v' + release.version;
      if (index === 0) {
        const latest = document.createElement('span');
        latest.className = 'changelog-latest';
        latest.textContent = 'LATEST';
        title.append(' ', latest);
      }
      const date = document.createElement('time');
      date.dateTime = release.date;
      date.textContent = new Date(release.date + 'T12:00:00')
        .toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
      head.append(title, date);
      const list = document.createElement('ul');
      for (const change of release.changes) {
        const item = document.createElement('li');
        const type = document.createElement('b');
        type.className = 'changelog-type';
        type.dataset.type = change.type;
        type.textContent = CHANGE_LABELS[change.type] || change.type.toUpperCase();
        const text = document.createElement('span');
        text.textContent = change.text;
        item.append(type, text);
        list.append(item);
      }
      article.append(head, list);
      return article;
    });
    $('changelog-list').replaceChildren(...releases);
  }

  function showChangelog() {
    buildChangelog();
    saveSeenVersion(VERSION);
    $('whats-new-badge').hidden = true;
    showView('changelog');
  }

  const earnedCount = progress => ACHIEVEMENTS.filter(a => progress.has(a.id)).length;

  /** One achievement: earned, locked, counting towards its goal, or a secret. */
  function achievementRow(achievement, progress) {
    const earned = progress.has(achievement.id);
    const hidden = achievement.secret && !earned;
    const row = document.createElement('div');
    row.className = 'achievement' + (earned ? ' earned' : '');
    const icon = document.createElement('span');
    icon.className = 'achievement-icon';
    icon.dataset.icon = hidden ? 'lock' : achievement.icon;
    icon.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('span');
    copy.className = 'achievement-copy';
    const name = document.createElement('strong');
    name.textContent = hidden ? 'SECRET' : achievement.name.toUpperCase();
    const blurb = document.createElement('small');
    blurb.textContent = hidden ? achievement.hint ?? 'Keep riding to find out.' : achievement.blurb;
    copy.append(name, blurb);
    const state = document.createElement('span');
    state.className = 'achievement-state';
    if (earned) {
      const check = document.createElement('span');
      check.dataset.icon = 'check';
      state.append(check);
      state.setAttribute('aria-label', 'Earned');
    } else if (achievement.stat) {
      const count = Math.min(progress.stats[achievement.stat] || 0, achievement.goal);
      state.textContent = statProgressText(achievement, count);
      const bar = document.createElement('span');
      bar.className = 'achievement-bar';
      bar.style.setProperty('--progress', String(count / achievement.goal));
      copy.append(bar);
    } else {
      state.textContent = 'LOCKED';
    }
    row.append(icon, copy, state);
    return row;
  }

  function buildAchievements() {
    const progress = progressOf(session.saveGame);
    if (!progress) return;
    $('achievements-summary').textContent = session.saveGame.name + ' has earned ' + earnedCount(progress)
      + ' of ' + ACHIEVEMENTS.length + ' achievements. Each rider earns their own.';
    const items = [];
    for (const group of ACHIEVEMENT_GROUPS) {
      items.push(trailSection(group.title, group.blurb));
      for (const achievement of ACHIEVEMENTS) if (achievement.group === group.id) items.push(achievementRow(achievement, progress));
    }
    $('achievement-list').replaceChildren(...items);
  }

  // Views with only a Back button, where the arrow keys scroll instead.
  const scrollsWithArrows = () => !$('menu-changelog-view').hidden || !$('menu-achievements-view').hidden;

  function trailSection(title, description) {
    const heading = document.createElement('div');
    heading.className = 'trail-section-title';
    const strong = document.createElement('strong');
    strong.textContent = title;
    const small = document.createElement('small');
    small.textContent = description;
    heading.append(strong, small);
    return heading;
  }

  function trailCard({ trail, key, number, status, best = null, locked = false, kind = 'official', nisse = false, onSelect }) {
    const button = document.createElement('button');
    button.className = `trail-card${kind === 'official' ? '' : ` ${kind}-trail-card`}`;
    button.disabled = locked;
    const preview = document.createElement('canvas');
    preview.className = 'trail-preview';
    preview.setAttribute('aria-hidden', 'true');
    // The trail's most eventful stretch, zoomed out, without a rider.
    paintPreview(preview, previewKey('trail', key), image => drawScene(image, {
      ...sceneOptions(), trail, ride: parkedRide(trail), focus: findHighlight(trail, 576),
      width: 576, height: 192, scale: 2, anchor: [.5, .55]
    }));
    const numberLabel = document.createElement('span');
    numberLabel.className = 'trail-number';
    numberLabel.textContent = number;
    const copy = document.createElement('span');
    copy.className = 'trail-copy';
    const name = document.createElement('strong');
    name.textContent = trail.name.toUpperCase();
    const detail = document.createElement('small');
    const author = normalizeAuthor(trail.author);
    detail.textContent = author ? status + ' · BY ' + author.toUpperCase() : status;
    copy.append(name, detail);
    const bestLabel = document.createElement('span');
    bestLabel.className = 'trail-best';
    bestLabel.textContent = best === null ? '—' : runTimeText(best);
    const medal = best === null ? null : medalFor(trail.medals, best);
    if (medal) {
      bestLabel.dataset.medal = medal;
      bestLabel.dataset.iconAfter = 'medal';
      bestLabel.title = medal + ' medal';
    }
    button.append(preview, numberLabel, copy, bestLabel);
    // A trail that hides a nisse says so, and whether this rider found it.
    if (trail.nisse) {
      const badge = document.createElement('span');
      badge.className = 'trail-nisse';
      badge.dataset.found = String(Boolean(nisse));
      // The icon paints its own background, so it sits inside the badge's frame.
      const icon = document.createElement('span');
      icon.dataset.icon = 'nisse';
      icon.setAttribute('aria-hidden', 'true');
      badge.append(icon);
      badge.title = nisse ? 'Nisse found' : 'A nisse hides on this trail';
      badge.setAttribute('aria-label', badge.title);
      button.append(badge);
    }
    if (!locked) button.addEventListener('click', onSelect);
    return button;
  }

  /** Whether the active rider has found a trail's nisse; never, without a rider. */
  const nisseFound = entry => Boolean(session.saveGame) && hasNisse(session.activeSaveSlot, nisseKey(entry), trails.length);

  function buildTrailCards() {
    const cards = [trailSection('OFFICIAL TRAILS', 'Career progression and official best times')];
    trails.forEach((trail, index) => {
      const locked = !session.saveGame || index > session.unlockedTrail;
      cards.push(trailCard({
        trail,
        key: trailKey(officialTrailEntries[index]),
        number: String(index + 1).padStart(2, '0'),
        status: locked ? 'LOCKED' : (index === session.savedTrail ? 'CURRENT TRAIL' : 'UNLOCKED'),
        best: readBest(session.activeSaveSlot, trailKey(officialTrailEntries[index]), trails.length),
        locked,
        nisse: nisseFound(officialTrailEntries[index]),
        onSelect: () => startTrail(index)
      }));
    });
    if (bonusTrailEntries.length) {
      cards.push(trailSection('BONUS TRAILS', 'Extra trails outside career progression, with best times and world boards'));
      bonusTrailEntries.forEach((entry, index) => {
        const key = trailKey(entry);
        const { open, hint } = bonusUnlock(entry);
        cards.push(trailCard({
          trail: entry.trail,
          key,
          number: `B${String(index + 1).padStart(2, '0')}`,
          status: open ? 'BONUS TRAIL' : hint,
          best: session.saveGame ? readBest(session.activeSaveSlot, key, trails.length) : readLeaderboard(key)[0]?.time ?? null,
          locked: !open,
          kind: 'bonus',
          nisse: nisseFound(entry),
          onSelect: () => startBonus(index)
        }));
      });
    }
    if (customTrailEntries.length) {
      cards.push(trailSection('CUSTOM TRAILS', 'Local trails outside career progression'));
      customTrailEntries.forEach((entry, index) => cards.push(trailCard({
        trail: entry.trail,
        key: trailKey(entry),
        number: `C${String(index + 1).padStart(2, '0')}`,
        status: entry.storage === 'browser' ? 'CUSTOM · SAVED IN BROWSER' : 'CUSTOM TRAIL',
        best: readLeaderboard(trailKey(entry))[0]?.time ?? null,
        kind: 'custom',
        nisse: nisseFound(entry),
        onSelect: () => startCustom(index)
      })));
    }
    $('menu-trail-grid').replaceChildren(...cards);
  }

  /** Trail keys whose world-best replay is on its way, so the board redraws once. */
  const awaitingWorld = new Set();

  /** Whether the player may open a trail, and so watch runs on it. */
  function canWatch(entry) {
    if (entry.source === 'official') return Boolean(session.saveGame) && officialTrailEntries.indexOf(entry) <= session.unlockedTrail;
    if (entry.source === 'bonus') return bonusUnlock(entry).open;
    return true;
  }

  /** The recorded run behind a board row: this device's best, or the world's. */
  function replayFor(run, key) {
    const same = replay => replay?.physics === RIDE_VERSION && Math.abs(replay.time - run.time) < .001;
    const local = readGhost(key);
    if (same(local)) return local;
    const world = settledWorldGhost(key);
    return same(world) && (!run.name || run.name === world.name) ? world : null;
  }

  function leaderboardRow(run, rank, loading = false, entry = null, replay = null) {
    const row = document.createElement('li');
    row.className = 'leaderboard-row' + (rank <= 3 && run ? ' podium-' + rank : '') + (run ? '' : ' open');
    const rankLabel = document.createElement('span');
    rankLabel.className = 'leaderboard-rank';
    rankLabel.textContent = String(rank).padStart(2, '0');
    if (!run) {
      const empty = document.createElement('span');
      empty.className = 'leaderboard-open';
      empty.textContent = rank > 1 ? '— — —' : loading ? 'LOADING RUNS…' : 'NO RUNS YET · FINISH THE TRAIL TO CLAIM IT';
      row.append(rankLabel, empty);
      return row;
    }
    const mine = Boolean(session.saveGame && (
      (run.saveId && run.saveId === session.saveGame.createdAt) ||
      (run.name && run.name === session.saveGame.name)
    ));
    row.classList.toggle('mine', mine);
    const avatar = riderAvatar(run.look);
    // The rider's gender before their name, as in the rider list.
    const gender = run.look?.gender === 'female' ? 'female' : 'male';
    const genderMark = document.createElement('span');
    genderMark.className = 'save-gender';
    genderMark.dataset.gender = gender;
    genderMark.dataset.icon = gender;
    genderMark.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('span');
    copy.className = 'leaderboard-copy';
    const name = document.createElement('strong');
    name.textContent = runnerName(run.name) + (mine ? ' · YOU' : '');
    const spoken = document.createElement('span');
    spoken.className = 'sr-only';
    spoken.textContent = ', ' + gender;
    name.append(spoken);
    const detail = document.createElement('small');
    const date = run.date ? new Date(run.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase() : 'CAREER BEST';
    detail.textContent = (run.name && run.slot === null ? 'ONLINE' : run.slot === null ? 'NO SAVE' : 'SLOT ' + (run.slot + 1)) + ' · ' + date;
    const nameLine = document.createElement('span');
    nameLine.className = 'save-slot-name';
    nameLine.append(genderMark, name);
    copy.append(nameLine, detail);
    const time = document.createElement('span');
    time.className = 'leaderboard-time';
    time.textContent = runTimeText(run.time);
    row.append(rankLabel, avatar, copy, time);
    if (replay) {
      const watch = document.createElement('button');
      watch.type = 'button';
      watch.className = 'leaderboard-watch';
      watch.setAttribute('aria-label', 'Watch the run by ' + runnerName(run.name));
      watch.title = 'Watch replay';
      const icon = document.createElement('span');
      icon.dataset.icon = 'play';
      icon.setAttribute('aria-hidden', 'true');
      watch.append(icon);
      watch.addEventListener('click', () => onWatchReplay({ entry, data: replay, name: runnerName(run.name) }));
      row.classList.add('watchable');
      row.append(watch);
    }
    return row;
  }

  /** @param {boolean} [fresh] the player brought this board up, so fetch its latest runs */
  function buildLeaderboard(fresh = false) {
    const trails = leaderboardTrails();
    leaderboardTrail = (leaderboardTrail + trails.length) % trails.length;
    const entry = trails[leaderboardTrail];
    const key = trailKey(entry);
    if (fresh) refreshOnlineBoard(key, BOARD_VIEW_MAX_AGE);
    const runs = readLeaderboard(key);
    // Wait for the online board instead of showing local times that it then replaces.
    const loading = isOnlineBoardLoading(key);
    $('leaderboard-trail-number').textContent = trailMarker(leaderboardTrail);
    $('leaderboard-trail-name').textContent = entry.name.toUpperCase();
    const author = normalizeAuthor(entry.trail?.author);
    $('leaderboard-trail-meta').textContent = entry.source.toUpperCase() + ' TRAIL'
      + (author ? ' · BY ' + author.toUpperCase() : '')
      + ' · ' + (leaderboardTrail + 1) + ' / ' + trails.length;
    const watchable = canWatch(entry);
    const rows = Array.from({ length: LEADERBOARD_SIZE }, (_, index) => {
      const run = loading ? undefined : runs[index];
      return leaderboardRow(run, index + 1, loading, entry, run && watchable ? replayFor(run, key) : null);
    });
    $('leaderboard-list').replaceChildren(...rows);
    // The world best can be watched too, once its replay has arrived.
    if (watchable && isOnlineTrail(key) && settledWorldGhost(key) === undefined && !awaitingWorld.has(key)) {
      awaitingWorld.add(key);
      fetchWorldGhost(key).then(world => {
        awaitingWorld.delete(key);
        // Only a replay that arrived redraws, so a failed fetch can't loop.
        if (world && isBoardShown() && shownBoardKey() === key) buildLeaderboard();
      });
    }
  }

  function stepLeaderboard(direction) {
    closeTrailPicker();
    leaderboardTrail += direction;
    buildLeaderboard(true);
  }

  const isTrailPickerOpen = () => !$('leaderboard-picker').hidden;

  function setTrailPicker(open) {
    $('leaderboard-picker').hidden = !open;
    $('leaderboard-list').hidden = open;
    $('menu-leaderboard-view').querySelector('.leaderboard-help').hidden = open;
    $('leaderboard-trail-pick').setAttribute('aria-expanded', String(open));
  }

  function closeTrailPicker(focusTrail = false) {
    if (!isTrailPickerOpen()) return false;
    setTrailPicker(false);
    if (focusTrail) selectControl($('leaderboard-trail-pick'));
    return true;
  }

  function pickerSection(source) {
    return {
      official: ['OFFICIAL TRAILS', 'Career trails'],
      bonus: ['BONUS TRAILS', 'Extra shipped trails'],
      custom: ['CUSTOM TRAILS', 'Runs on this device']
    }[source] || [source.toUpperCase() + ' TRAILS', ''];
  }

  /** Lists every trail with a board, so one can be picked without stepping through the rest. */
  function openTrailPicker() {
    const items = [];
    let section = null;
    let current = null;
    leaderboardTrails().forEach((entry, index) => {
      if (entry.source !== section) {
        section = entry.source;
        items.push(trailSection(...pickerSection(section)));
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `leaderboard-pick ${entry.source}-pick`;
      const number = document.createElement('span');
      number.className = 'trail-number';
      number.textContent = trailMarker(index);
      const name = document.createElement('strong');
      name.textContent = entry.name.toUpperCase();
      const best = document.createElement('span');
      best.className = 'trail-best';
      const top = readLeaderboard(trailKey(entry))[0]?.time;
      best.textContent = top == null ? '—' : runTimeText(top);
      button.append(number, name, best);
      if (index === leaderboardTrail) {
        button.setAttribute('aria-current', 'true');
        current = button;
      }
      button.addEventListener('click', () => {
        leaderboardTrail = index;
        buildLeaderboard(true);
        closeTrailPicker(true);
      });
      items.push(button);
    });
    $('leaderboard-picker').replaceChildren(...items);
    setTrailPicker(true);
    requestAnimationFrame(() => selectControl(current));
  }

  function currentLeaderboardTrail() {
    if (session.trailSource === 'bonus' && session.bonusTrailIndex >= 0) return officialTrailEntries.length + session.bonusTrailIndex;
    if (session.trailSource === 'custom' && session.customTrailIndex >= 0) {
      return officialTrailEntries.length + bonusTrailEntries.length + session.customTrailIndex;
    }
    return session.gameLoopStarted ? session.trailIndex : session.savedTrail;
  }

  function showSaveCreator(slotIndex) {
    pendingSaveSlot = slotIndex;
    $('new-save-slot-label').textContent = 'SAVE SLOT ' + (slotIndex + 1);
    $('new-save-name').value = '';
    $('new-save-name').classList.remove('invalid');
    setStatus('save-status', '');
    setStatus('save-login-status', '');
    setSaveMode(saveMode);
    const identity = { gender: DEFAULT_LOOK.gender, skin: DEFAULT_LOOK.skin };
    identityPicker.setIdentity(identity);
    creatorTouched = false;
    creator.setLook(starterLook(identity.gender, identity.skin), { tab: 'hair' });
    showSaveStep(1);
    showView('save');
  }

  // --- Online riders ---------------------------------------------------------

  function setStatus(id, text, isError = false) {
    const status = $(id);
    status.textContent = text;
    status.hidden = !text;
    status.classList.toggle('error', isError);
  }

  function setAccountBusy(busy) {
    accountBusy = busy;
    for (const id of ['create-save', 'save-login-button', 'riders-login-button']) $(id).disabled = busy;
    document.querySelectorAll('.link-save').forEach(button => { button.disabled = busy; });
  }

  function setSaveMode(mode) {
    saveMode = onlineAvailable ? mode : 'offline';
    const online = saveMode === 'online';
    document.querySelectorAll('[data-save-mode]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.saveMode === saveMode));
    });
    $('save-mode').hidden = !onlineAvailable;
    $('save-login').hidden = !onlineAvailable;
    $('save-mode-help').textContent = online
      ? 'Your name is yours alone on the world leaderboard. You sign in with a passkey (fingerprint, face or device PIN), and your progress is backed up.'
      : 'Stays in this browser only: no world leaderboard, and clearing site data deletes it. You can take it online later from Riders.';
    $('create-save').textContent = online ? 'Create Passkey & Ride' : 'Create Save & Ride';
  }

  function useNewSave(index, save) {
    session.saveSlots[index] = save;
    selectSaveSlot(index);
    queueSaveSync(save);
  }

  async function createOnlineSave(name) {
    setAccountBusy(true);
    setStatus('save-status', 'Confirm with your passkey…');
    try {
      const look = creator.look();
      const { token, player } = await registerRider(name, look);
      const save = createSave(pendingSaveSlot, look, trails.length, player.name, { playerId: player.id, token });
      if (!save) { showView('riders'); return; }
      session.unlockedTrail = 0; session.savedTrail = 0;
      useNewSave(pendingSaveSlot, save);
      startTrail(0);
    } catch (error) {
      setStatus('save-status', accountErrorText(error), true);
      if (error.message === 'name taken' || error.message === 'name not allowed' || error.message === 'invalid name') {
        showSaveStep(1);
        $('new-save-name').classList.add('invalid');
      }
    } finally {
      setAccountBusy(false);
    }
  }

  /** Signs in with a passkey and puts that rider into a slot, with their cloud save and ghosts. */
  async function logIn(statusId) {
    if (accountBusy) return;
    setAccountBusy(true);
    setStatus(statusId, 'Choose your passkey…');
    try {
      const account = await loginRider();
      const index = restoreOnlineSave(trails.length, account);
      if (index < 0) {
        setStatus(statusId, 'All rider slots are full. Delete a rider, then log in again.', true);
        return;
      }
      session.saveSlots = loadSaveSlots(trails.length);
      useNewSave(index, session.saveSlots[index]);
      showView('home');
    } catch (error) {
      setStatus(statusId, accountErrorText(error), true);
    } finally {
      setAccountBusy(false);
    }
  }

  /** Claims an offline save's name online, then sends its best runs to the world board. */
  async function goOnline(index) {
    const save = session.saveSlots[index];
    if (!save || save.token || accountBusy) return;
    setAccountBusy(true);
    setStatus('riders-status', 'Confirm with your passkey…');
    try {
      const { token, player } = await registerRider(save.name, save.look);
      const linked = linkSave(index, trails.length, { playerId: player.id, token, name: player.name });
      session.saveSlots[index] = linked;
      if (index === session.activeSaveSlot) session.saveGame = linked;
      queueSaveSync(linked);
      buildSaveSlots();
      setStatus('riders-status', `${linked.name} is online. Sending best runs…`);
      let sent = 0;
      for (const entry of [...officialTrailEntries, ...bonusTrailEntries]) {
        const key = trailKey(entry);
        const ghost = readGhost(key);
        // Ghosts are shared by every save on this device, so only send the
        // one that set this save's best time.
        if (!ghost || ghost.physics !== RIDE_VERSION || ghost.time !== linked.bestTimes[key]) continue;
        const result = await submitOnlineRun(key, { look: linked.look, token, run: { inputs: ghost.inputs, seed: ghost.seed, physics: ghost.physics } });
        if (result && 'rank' in result) sent++;
      }
      setStatus('riders-status', `${linked.name} is online.` + (sent ? ` ${sent} best ${sent === 1 ? 'run is' : 'runs are'} on the world leaderboard.` : ''));
    } catch (error) {
      setStatus('riders-status', error.message === 'name taken'
        ? `“${save.name}” is already taken online. If it’s yours, log in below; otherwise create a new online rider.`
        : accountErrorText(error), true);
    } finally {
      setAccountBusy(false);
    }
  }

  function setImportStatus(text, isError = false) {
    $('import-trail-status').textContent = text;
    $('import-trail-status').classList.toggle('error', isError);
  }

  /** Opens the trail list with a message by Import trail, such as why a share link failed. */
  function showTrailsStatus(text, isError = false) {
    buildTrailCards();
    showView('trails');
    setImportStatus(text, isError);
  }

  function persistPreferences() {
    savePreferences(session.preferences);
    onPreferences();
    syncSettings();
  }

  function buildKeyBindings() {
    const { bindings } = session.preferences;
    const buttons = Object.entries(ACTION_LABELS).map(([action, label]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'key-binding';
      const name = document.createElement('span');
      name.textContent = label;
      const keys = document.createElement('kbd');
      keys.textContent = bindings[action].map(keyLabel).join(' / ') || '—';
      button.append(name, keys);
      button.setAttribute('aria-label', label + ': ' + keys.textContent + '. Select to change.');
      button.addEventListener('click', () => {
        button.classList.add('listening');
        keys.textContent = 'PRESS A KEY';
        input.captureNextKey(code => {
          if (code) {
            const next = {};
            for (const [other, codes] of Object.entries(bindings)) next[other] = codes.filter(existing => existing !== code);
            next[action] = [code];
            session.preferences.bindings = next;
            persistPreferences();
          } else buildKeyBindings();
          requestAnimationFrame(() => selectControl($('key-bindings').children[Object.keys(ACTION_LABELS).indexOf(action)]));
        });
      });
      return button;
    });
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'menu-back key-reset';
    reset.textContent = 'RESET KEYS';
    reset.dataset.iconBefore = 'undo';
    reset.addEventListener('click', () => {
      session.preferences.bindings = structuredClone(DEFAULT_BINDINGS);
      persistPreferences();
    });
    $('key-bindings').replaceChildren(...buttons, reset);
  }

  // Gamepad buttons aren't remappable, so the diagram is drawn once.
  $('gamepad-diagram').append(...createGamepadDiagram());

  function syncSettings() {
    document.querySelectorAll('[data-setting]').forEach(button => {
      button.setAttribute('aria-pressed', String(session.preferences[button.dataset.setting] === button.dataset.value));
    });
    $('setting-volume').value = String(session.preferences.volume);
    $('setting-volume-value').textContent = String(session.preferences.volume);
    buildKeyBindings();
  }

  /** Gamepad navigation while the menu is open. */
  function handlePad(action) {
    if (scrollsWithArrows() && (action === 'nav-up' || action === 'nav-down')) {
      $('menu-scroll').scrollBy({ top: action === 'nav-up' ? -160 : 160, behavior: 'smooth' });
      return;
    }
    if (action === 'nav-up' || action === 'nav-left') {
      if (action === 'nav-left' && !$('menu-leaderboard-view').hidden && !isTrailPickerOpen()) { stepLeaderboard(-1); sounds.menuMove(); return; }
      moveSelection(-1);
    } else if (action === 'nav-down' || action === 'nav-right') {
      if (action === 'nav-right' && !$('menu-leaderboard-view').hidden && !isTrailPickerOpen()) { stepLeaderboard(1); sounds.menuMove(); return; }
      moveSelection(1);
    } else if (action === 'confirm') {
      const selected = $('menu-screen').querySelector('.menu-selected');
      if (selected instanceof HTMLButtonElement) selected.click();
    } else if (action === 'tab-prev' || action === 'tab-next') {
      stepTab(action === 'tab-prev' ? -1 : 1);
    } else if (action === 'cancel') {
      if (closeTrailPicker(true)) sounds.menuBack();
      else if ($('menu-home').hidden) { sounds.menuBack(); goBack(); } else onClose();
    }
  }

  // Wiring.
  $('menu-how-to').addEventListener('click', () => showView('how'));
  $('menu-whats-new').addEventListener('click', showChangelog);
  $('menu-editor').addEventListener('click', () => { window.location.href = './editor.html'; });
  $('menu-settings').addEventListener('click', () => { syncSettings(); showView('settings'); });
  document.querySelectorAll('#menu-settings-view [role="tab"]').forEach(tab => {
    tab.addEventListener('click', () => showSettingsTab(tab));
  });
  $('menu-screen').addEventListener('keydown', event => {
    if (input.capturing) return;
    // Left and right adjust a focused slider instead of moving the selection.
    if (event.target.type === 'range' && (event.code === 'ArrowLeft' || event.code === 'ArrowRight')) return;
    const trailStep = { ArrowLeft: -1, KeyA: -1, ArrowRight: 1, KeyD: 1 }[event.code];
    if (trailStep && !$('menu-leaderboard-view').hidden && !isTrailPickerOpen()) {
      event.preventDefault();
      stepLeaderboard(trailStep);
      sounds.menuMove();
      return;
    }
    const direction = { ArrowUp: -1, ArrowLeft: -1, KeyW: -1, KeyA: -1, ArrowDown: 1, ArrowRight: 1, KeyS: 1, KeyD: 1 }[event.code];
    if (!direction) return;
    if (scrollsWithArrows() && event.code.startsWith('Arrow')) return;
    if (moveSelection(direction)) event.preventDefault();
  });
  $('menu-screen').addEventListener('focusin', event => {
    const control = event.target.closest('button, input');
    if (!control?.closest('.menu-view, .menu-confirm')) return;
    document.querySelectorAll('.menu-selected').forEach(item => item.classList.remove('menu-selected'));
    control.classList.add('menu-selected');
  });
  $('menu-screen').addEventListener('pointerover', event => {
    const button = event.target.closest('button');
    if (event.pointerType === 'mouse' && button && !button.contains(event.relatedTarget)) {
      if (button.closest('.menu-view, .menu-confirm')) selectControl(button);
      sounds.menuMove();
    }
  });
  $('menu-screen').addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.matches('[data-menu-back], #look-confirm-discard, #look-confirm-cancel')) sounds.menuBack();
    else if (button.id === 'create-save' || button.id === 'save-look' || button.id === 'look-confirm-save' || button.id === 'new-save-next' || button.id === 'menu-continue' || button.id === 'menu-first-ride' || button.id === 'menu-resume' || button.id === 'menu-retry') sounds.menuConfirm();
    else sounds.menuSelect();
  });
  $('menu-continue').addEventListener('click', () => startTrail(session.savedTrail));
  $('menu-resume').addEventListener('click', () => onClose());
  $('menu-retry').addEventListener('click', () => onRetry());
  $('menu-first-ride').addEventListener('click', () => {
    creatorFromRiders = false;
    showSaveCreator(Math.max(0, session.saveSlots.findIndex(save => !save)));
  });
  $('menu-riders').addEventListener('click', () => { buildSaveSlots(); setStatus('riders-status', ''); showView('riders'); });
  $('save-login-button').addEventListener('click', () => logIn('save-login-status'));
  $('riders-login-button').addEventListener('click', () => logIn('riders-status'));
  $('menu-garage').addEventListener('click', openGarage);
  $('menu-achievements').addEventListener('click', () => { buildAchievements(); showView('achievements'); });
  $('save-look').addEventListener('click', saveGarageLook);
  $('look-confirm-save').addEventListener('click', saveGarageLook);
  $('look-confirm-discard').addEventListener('click', discardGarageLook);
  $('look-confirm-cancel').addEventListener('click', closeLookConfirm);
  // Escape is handled by the game; other close requests (such as a phone's
  // back gesture) mean Keep Editing too.
  lookConfirm.addEventListener('cancel', event => { event.preventDefault(); closeLookConfirm(); });
  $('riders-login').hidden = !onlineAvailable;
  if (onlineAvailable) {
    $('menu-first-ride').querySelector('small').textContent = 'New rider, or log in with your passkey';
    $('menu-riders').querySelector('small').textContent = 'Switch, add or log in';
  }
  document.querySelectorAll('[data-save-mode]').forEach(button => button.addEventListener('click', () => {
    setSaveMode(button.dataset.saveMode);
    setStatus('save-status', '');
  }));
  $('menu-trails').addEventListener('click', () => { buildTrailCards(); showView('trails'); });
  $('import-trail').addEventListener('click', () => $('import-trail-file').click());
  $('import-trail-file').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const trail = normalizeTrail(JSON.parse(await file.text()), customTrailEntries.length);
      const errors = validateTrail(trail).filter(message => message.type === 'error');
      if (errors.length) throw new Error(errors[0].text);
      saveBrowserTrail(trail);
      updateDashboard();
      showView('trails');
      setImportStatus(`Imported “${trail.name}”. It is saved in this browser under Custom Trails.`);
    } catch (error) {
      setImportStatus(`Could not import ${file.name}: ${error.message}`, true);
    }
  });
  $('menu-leaderboard').addEventListener('click', () => {
    leaderboardTrail = currentLeaderboardTrail();
    buildLeaderboard(true);
    showView('leaderboard');
  });
  $('leaderboard-prev').addEventListener('click', () => stepLeaderboard(-1));
  $('leaderboard-next').addEventListener('click', () => stepLeaderboard(1));
  $('leaderboard-trail-pick').addEventListener('click', () => {
    if (isTrailPickerOpen()) closeTrailPicker(true);
    else openTrailPicker();
  });
  document.querySelectorAll('[data-menu-back]').forEach(button => button.addEventListener('click', goBack));
  $('new-save-next').addEventListener('click', () => {
    if (!checkNewSaveName()) return;
    setStatus('save-status', '');
    showSaveStep(2);
    $('menu-save-view').scrollIntoView?.({ block: 'start' });
  });
  $('create-save').addEventListener('click', () => {
    if (accountBusy) return;
    const name = checkNewSaveName();
    if (!name) return;
    if (saveMode === 'online') { createOnlineSave(name); return; }
    const save = createSave(pendingSaveSlot, creator.look(), trails.length, name);
    if (!save) { showView('riders'); return; }
    session.saveGame = save;
    session.activeSaveSlot = pendingSaveSlot;
    saveActiveSlot(session.activeSaveSlot);
    session.saveSlots[session.activeSaveSlot] = save;
    session.look = save.look;
    session.unlockedTrail = 0; session.savedTrail = 0;
    startTrail(0);
  });
  document.querySelectorAll('[data-setting]').forEach(button => {
    button.addEventListener('click', () => {
      session.preferences[button.dataset.setting] = button.dataset.value;
      persistPreferences();
      drawBackground();
    });
  });
  $('setting-volume').addEventListener('input', event => {
    session.preferences.volume = Number(event.target.value);
    $('setting-volume-value').textContent = event.target.value;
    onPreferences();
  });
  $('setting-volume').addEventListener('change', () => { savePreferences(session.preferences); sounds.menuMove(); });
  $('setting-haptics-group').hidden = !('vibrate' in navigator);

  let resetArmed = false, resetTimer = 0;
  $('reset-settings').addEventListener('click', event => {
    const button = event.currentTarget;
    if (!resetArmed) {
      resetArmed = true;
      button.textContent = 'CLICK AGAIN TO RESET';
      resetTimer = setTimeout(() => { resetArmed = false; button.textContent = 'RESET ALL SETTINGS'; }, 2500);
      return;
    }
    clearTimeout(resetTimer);
    resetArmed = false;
    button.textContent = 'RESET ALL SETTINGS';
    session.preferences = sanitizePreferences({});
    persistPreferences();
    drawBackground();
  });

  const back = () => {
    if (closeTrailPicker(true)) return true;
    if ($('menu-home').hidden) { goBack(); return true; }
    return false;
  };
  return { open, close, isOpen, showTrailsStatus, updateDashboard, drawBackground, syncSettings, handlePad, showView, canResume, back, refreshCloudSave };
}
