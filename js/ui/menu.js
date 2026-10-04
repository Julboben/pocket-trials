// Main menu: savegames, trail select, leaderboard, settings and how-to-play.
import { clamp } from '../config.js';
import { trails, officialTrailEntries, customTrailEntries, saveBrowserTrail } from '../trails.js';
import { createDrawingTools, createGameArt } from '../drawing.js';
import { createRiderHair, hairRoot, hairRestDirection, hairBackSupport } from '../rider-hair.js';
import {
  loadSaveSlots, loadActiveSlot, saveActiveSlot, createSave, deleteSave, readBest,
  readLeaderboard, LEADERBOARD_SIZE, loadPreferences, savePreferences, cleanRiderName,
  restoreOnlineSave, linkSave, readGhost
} from '../storage.js';
import { ONLINE_LEADERBOARD_EVENT, isOnlineBoardLoading, submitOnlineRun } from '../online-leaderboard.js';
import { registerRider, loginRider, accountErrorText, passkeysSupported, queueSaveSync } from '../account.js';
import { isSandbox } from '../local-store.js';
import { RIDE_VERSION } from '../ride.js';
import { normalizeTrail, validateTrail, medalFor } from '../trail-schema.js';
import { ACTION_LABELS, keyLabel } from '../input.js';
import { VERSION } from '../version.js';
import {
  $, session, DEFAULT_BINDINGS, DEFAULT_PREFERENCES, sanitizePreferences,
  leaderboardTrails, trailKey, trailMarker, runTimeText
} from '../state.js';

// Runs made without a savegame have no name.
const runnerName = name => name || 'RIDER';

export function riderSymbolMarkup(selectedRider) {
  return '<span data-icon="' + (selectedRider === 'female' ? 'female' : 'male') + '" aria-hidden="true"></span>';
}

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
  session.rider = session.saveGame?.rider || 'male';
}

/**
 * @param {{
 *   sounds: any, input: any,
 *   onStartTrail: (index: number) => void,
 *   onStartCustom: (index: number) => void,
 *   onClose: () => void,
 *   onRetry: () => void,
 *   onPreferences: () => void
 * }} hooks
 */
export function createMenu({ sounds, input, onStartTrail, onStartCustom, onClose, onRetry, onPreferences }) {
  let pendingSaveSlot = 0, selectedNewRider = 'male';
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

  // Typing a name must not reach the game's key handlers (W/A/S/D, R, Esc).
  // Escape is left alone so it still closes the menu.
  const nameInput = $('new-save-name');
  for (const type of ['keydown', 'keyup', 'keypress']) {
    nameInput.addEventListener(type, event => { if (event.key !== 'Escape') event.stopPropagation(); });
  }
  nameInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); $('create-save').click(); }
  });
  nameInput.addEventListener('input', () => nameInput.classList.remove('invalid'));

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

  function startCustom(index) {
    session.rideSaveId = session.saveGame?.createdAt ?? null;
    onStartCustom(index);
  }

  function drawPreviewRider(artCtx, rearPoint, frontPoint, leanVisual = 0) {
    const pose = {
      rear: { x: rearPoint[0], y: rearPoint[1], spin: 0, compression: 0 },
      front: { x: frontPoint[0], y: frontPoint[1], spin: 0, compression: 0 },
      facing: 1, flipVisual: 1, leanVisual
    };
    if (session.rider === 'female') {
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
      rider: session.rider
    });
  }

  function drawActiveSaveIllustration() {
    const artCtx = $('active-save-bike').getContext('2d');
    artCtx.setTransform(2, 0, 0, 2, 0, 0);
    artCtx.clearRect(0, 0, 120, 84);
    if (!session.saveGame) return;
    artCtx.fillStyle = '#eae9d9'; artCtx.fillRect(0, 0, 120, 84);
    artCtx.fillStyle = '#c5b496';
    artCtx.beginPath(); artCtx.moveTo(0,72); artCtx.quadraticCurveTo(30,58,60,69); artCtx.quadraticCurveTo(90,78,120,58); artCtx.lineTo(120,84); artCtx.lineTo(0,84); artCtx.fill();
    artCtx.strokeStyle = '#375d4d'; artCtx.lineWidth = 5; artCtx.beginPath(); artCtx.moveTo(0,72); artCtx.quadraticCurveTo(30,58,60,69); artCtx.quadraticCurveTo(90,78,120,58); artCtx.stroke();
    drawPreviewRider(artCtx, [35, 61], [85, 65]);
  }

  function selectSaveSlot(index) {
    session.activeSaveSlot = clamp(index, 0, session.saveSlots.length - 1);
    saveActiveSlot(session.activeSaveSlot);
    session.saveGame = session.saveSlots[session.activeSaveSlot];
    session.unlockedTrail = session.saveGame?.unlocked || 0;
    session.savedTrail = session.saveGame?.trail || 0;
    session.rider = session.saveGame?.rider || 'male';
    updateDashboard();
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
      const mode = save ? (save.token ? ' · ONLINE' : ' · OFFLINE') : '';
      button.innerHTML = save
        ? '<span class="save-avatar ' + save.rider + '">' + riderSymbolMarkup(save.rider) + '</span>'
          + '<span class="save-slot-copy"><span class="save-label">SLOT ' + (index + 1) + active + mode + '</span><strong>' + save.name + '</strong><small>'
          + (save.unlocked + 1) + ' / ' + trails.length + ' trails · ' + trails[save.trail].name + '</small></span>'
        : '<span class="save-avatar empty"><span data-icon="plus" aria-hidden="true"></span></span>'
          + '<span class="save-slot-copy"><span class="save-label">SLOT ' + (index + 1) + '</span><strong>NEW RIDER</strong><small>Start a fresh career in this slot</small></span>';
      button.addEventListener('click', () => {
        if (save) { selectSaveSlot(index); showView('home'); return; }
        creatorFromRiders = true;
        showSaveCreator(index);
      });
      row.append(button);
      if (save && !save.token && onlineAvailable) {
        const link = document.createElement('button');
        link.className = 'link-save';
        link.type = 'button';
        link.textContent = 'GO ONLINE';
        link.disabled = accountBusy;
        link.setAttribute('aria-label', 'Take ' + save.name + ' online with a passkey');
        link.addEventListener('click', () => goOnline(index));
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
    if (!$('menu-save-view').hidden && creatorFromRiders) { showView('riders'); return; }
    updateDashboard();
    showView('home');
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
    $('menu-trails').disabled = !hasSave && customTrailEntries.length === 0;
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
    $('menu-login').hidden = !onlineAvailable || Boolean(session.saveGame?.token);
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
    const visibleView = document.querySelector('.menu-view:not([hidden])');
    return visibleView ? [...visibleView.querySelectorAll('button:not([disabled]):not([hidden]), input:not([disabled])')] : [];
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

  function showView(view) {
    disarmDelete();
    $('menu-home').hidden = view !== 'home';
    $('menu-riders-view').hidden = view !== 'riders';
    $('menu-trail-view').hidden = view !== 'trails';
    $('menu-leaderboard-view').hidden = view !== 'leaderboard';
    $('menu-save-view').hidden = view !== 'save';
    $('menu-how-view').hidden = view !== 'how';
    $('menu-settings-view').hidden = view !== 'settings';
    $('menu-scroll').scrollTop = 0;
    requestAnimationFrame(() => {
      const list = controls();
      selectControl(list.find(button => !button.matches('[data-menu-back]')) || list[0]);
    });
  }

  function open() {
    $('menu-screen').hidden = false;
    updateDashboard();
    showView('home');
    requestAnimationFrame(() => selectControl($(canResume() ? 'menu-resume' : session.saveGame ? 'menu-continue' : 'menu-first-ride')));
  }

  function close() { $('menu-screen').hidden = true; }

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

  function trailCard({ trail, number, status, best = null, locked = false, custom = false, onSelect }) {
    const button = document.createElement('button');
    button.className = `trail-card${custom ? ' custom-trail-card' : ''}`;
    button.disabled = locked;
    const numberLabel = document.createElement('span');
    numberLabel.className = 'trail-number';
    numberLabel.textContent = number;
    const copy = document.createElement('span');
    copy.className = 'trail-copy';
    const name = document.createElement('strong');
    name.textContent = trail.name.toUpperCase();
    const detail = document.createElement('small');
    detail.textContent = status;
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
    button.append(numberLabel, copy, bestLabel);
    if (!locked) button.addEventListener('click', onSelect);
    return button;
  }

  function buildTrailCards() {
    const cards = [trailSection('OFFICIAL TRAILS', 'Career progression and official best times')];
    trails.forEach((trail, index) => {
      const locked = !session.saveGame || index > session.unlockedTrail;
      cards.push(trailCard({
        trail,
        number: String(index + 1).padStart(2, '0'),
        status: locked ? 'LOCKED' : (index === session.savedTrail ? 'CURRENT TRAIL' : 'UNLOCKED'),
        best: readBest(session.activeSaveSlot, trailKey(officialTrailEntries[index]), trails.length),
        locked,
        onSelect: () => startTrail(index)
      }));
    });
    if (customTrailEntries.length) {
      cards.push(trailSection('CUSTOM TRAILS', 'Local trails outside career progression'));
      customTrailEntries.forEach((entry, index) => cards.push(trailCard({
        trail: entry.trail,
        number: `C${String(index + 1).padStart(2, '0')}`,
        status: entry.storage === 'browser' ? 'CUSTOM · SAVED IN BROWSER' : 'CUSTOM TRAIL',
        best: readLeaderboard(trailKey(entry))[0]?.time ?? null,
        custom: true,
        onSelect: () => startCustom(index)
      })));
    }
    $('menu-trail-grid').replaceChildren(...cards);
  }

  function leaderboardRow(run, rank, loading = false) {
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
    const avatar = document.createElement('span');
    avatar.className = 'save-avatar ' + run.rider;
    avatar.innerHTML = riderSymbolMarkup(run.rider);
    const copy = document.createElement('span');
    copy.className = 'leaderboard-copy';
    const name = document.createElement('strong');
    name.textContent = runnerName(run.name) + (mine ? ' · YOU' : '');
    const detail = document.createElement('small');
    const date = run.date ? new Date(run.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }).toUpperCase() : 'CAREER BEST';
    detail.textContent = (run.name && run.slot === null ? 'ONLINE' : run.slot === null ? 'NO SAVE' : 'SLOT ' + (run.slot + 1)) + ' · ' + date;
    copy.append(name, detail);
    const time = document.createElement('span');
    time.className = 'leaderboard-time';
    time.textContent = runTimeText(run.time);
    row.append(rankLabel, avatar, copy, time);
    return row;
  }

  function buildLeaderboard() {
    const trails = leaderboardTrails();
    leaderboardTrail = (leaderboardTrail + trails.length) % trails.length;
    const entry = trails[leaderboardTrail];
    const key = trailKey(entry);
    const runs = readLeaderboard(key);
    // Wait for the online board instead of showing local times that it then replaces.
    const loading = isOnlineBoardLoading(key);
    $('leaderboard-trail-number').textContent = trailMarker(leaderboardTrail);
    $('leaderboard-trail-name').textContent = entry.name.toUpperCase();
    $('leaderboard-trail-meta').textContent = (entry.source === 'custom' ? 'CUSTOM TRAIL' : 'OFFICIAL TRAIL')
      + ' · ' + (leaderboardTrail + 1) + ' / ' + trails.length;
    const rows = Array.from({ length: LEADERBOARD_SIZE }, (_, index) => leaderboardRow(loading ? undefined : runs[index], index + 1, loading));
    $('leaderboard-list').replaceChildren(...rows);
  }

  function stepLeaderboard(direction) {
    leaderboardTrail += direction;
    buildLeaderboard();
  }

  function currentLeaderboardTrail() {
    if (session.trailSource === 'custom' && session.customTrailIndex >= 0) return officialTrailEntries.length + session.customTrailIndex;
    return session.gameLoopStarted ? session.trailIndex : session.savedTrail;
  }

  function showSaveCreator(slotIndex) {
    pendingSaveSlot = slotIndex;
    $('new-save-slot-label').textContent = 'SAVE SLOT ' + (slotIndex + 1);
    $('new-save-name').value = '';
    $('new-save-name').classList.remove('invalid');
    setStatus('save-status', '');
    setSaveMode(saveMode);
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
      const { token, player } = await registerRider(name, selectedNewRider);
      const save = createSave(pendingSaveSlot, player.rider, trails.length, player.name, { playerId: player.id, token });
      if (!save) { showView('riders'); return; }
      session.unlockedTrail = 0; session.savedTrail = 0;
      useNewSave(pendingSaveSlot, save);
      startTrail(0);
    } catch (error) {
      setStatus('save-status', accountErrorText(error), true);
      if (error.message === 'name taken' || error.message === 'name not allowed' || error.message === 'invalid name') {
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
      const { token, player } = await registerRider(save.name, save.rider);
      const linked = linkSave(index, trails.length, { playerId: player.id, token, name: player.name });
      session.saveSlots[index] = linked;
      if (index === session.activeSaveSlot) session.saveGame = linked;
      queueSaveSync(linked);
      buildSaveSlots();
      setStatus('riders-status', `${linked.name} is online. Sending best runs…`);
      let sent = 0;
      for (const entry of officialTrailEntries) {
        const key = trailKey(entry);
        const ghost = readGhost(key);
        // Ghosts are shared by every save on this device, so only send the
        // one that set this save's best time.
        if (!ghost || ghost.physics !== RIDE_VERSION || ghost.time !== linked.bestTimes[key]) continue;
        const result = await submitOnlineRun(key, { rider: linked.rider, token, run: { inputs: ghost.inputs, seed: ghost.seed, physics: ghost.physics } });
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
    reset.addEventListener('click', () => {
      session.preferences.bindings = structuredClone(DEFAULT_BINDINGS);
      persistPreferences();
    });
    $('key-bindings').replaceChildren(...buttons, reset);
  }

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
    if (action === 'nav-up' || action === 'nav-left') {
      if (action === 'nav-left' && !$('menu-leaderboard-view').hidden) { stepLeaderboard(-1); sounds.menuMove(); return; }
      moveSelection(-1);
    } else if (action === 'nav-down' || action === 'nav-right') {
      if (action === 'nav-right' && !$('menu-leaderboard-view').hidden) { stepLeaderboard(1); sounds.menuMove(); return; }
      moveSelection(1);
    } else if (action === 'confirm') {
      const selected = $('menu-screen').querySelector('.menu-selected');
      if (selected instanceof HTMLButtonElement) selected.click();
    } else if (action === 'cancel') {
      if ($('menu-home').hidden) { sounds.menuBack(); goBack(); } else onClose();
    }
  }

  // Wiring.
  $('menu-how-to').addEventListener('click', () => showView('how'));
  $('menu-editor').addEventListener('click', () => { window.location.href = './editor.html'; });
  $('menu-settings').addEventListener('click', () => { syncSettings(); showView('settings'); });
  $('menu-screen').addEventListener('keydown', event => {
    if (input.capturing) return;
    // Left and right adjust a focused slider instead of moving the selection.
    if (event.target.type === 'range' && (event.code === 'ArrowLeft' || event.code === 'ArrowRight')) return;
    const trailStep = { ArrowLeft: -1, KeyA: -1, ArrowRight: 1, KeyD: 1 }[event.code];
    if (trailStep && !$('menu-leaderboard-view').hidden) {
      event.preventDefault();
      stepLeaderboard(trailStep);
      sounds.menuMove();
      return;
    }
    const direction = { ArrowUp: -1, ArrowLeft: -1, KeyW: -1, KeyA: -1, ArrowDown: 1, ArrowRight: 1, KeyS: 1, KeyD: 1 }[event.code];
    if (!direction) return;
    if (moveSelection(direction)) event.preventDefault();
  });
  $('menu-screen').addEventListener('focusin', event => {
    const control = event.target.closest('button, input');
    if (!control?.closest('.menu-view')) return;
    document.querySelectorAll('.menu-selected').forEach(item => item.classList.remove('menu-selected'));
    control.classList.add('menu-selected');
  });
  $('menu-screen').addEventListener('pointerover', event => {
    const button = event.target.closest('button');
    if (event.pointerType === 'mouse' && button && !button.contains(event.relatedTarget)) {
      if (button.closest('.menu-view')) selectControl(button);
      sounds.menuMove();
    }
  });
  $('menu-screen').addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.matches('[data-menu-back]')) sounds.menuBack();
    else if (button.id === 'create-save' || button.id === 'menu-continue' || button.id === 'menu-first-ride' || button.id === 'menu-resume' || button.id === 'menu-retry') sounds.menuConfirm();
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
  $('menu-login').addEventListener('click', () => {
    buildSaveSlots();
    showView('riders');
    logIn('riders-status');
  });
  $('save-login-button').addEventListener('click', () => logIn('save-status'));
  $('riders-login-button').addEventListener('click', () => logIn('riders-status'));
  $('riders-login').hidden = !onlineAvailable;
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
    buildLeaderboard();
    showView('leaderboard');
  });
  $('leaderboard-prev').addEventListener('click', () => stepLeaderboard(-1));
  $('leaderboard-next').addEventListener('click', () => stepLeaderboard(1));
  document.querySelectorAll('[data-menu-back]').forEach(button => button.addEventListener('click', goBack));
  document.querySelectorAll('[data-rider]').forEach(button => button.addEventListener('click', () => {
    selectedNewRider = button.dataset.rider;
    document.querySelectorAll('[data-rider]').forEach(choice => choice.setAttribute('aria-pressed', String(choice === button)));
  }));
  $('create-save').addEventListener('click', () => {
    if (accountBusy) return;
    const name = cleanRiderName($('new-save-name').value);
    if (!name) {
      $('new-save-name').classList.add('invalid');
      $('new-save-name').focus();
      return;
    }
    if (saveMode === 'online') { createOnlineSave(name); return; }
    const save = createSave(pendingSaveSlot, selectedNewRider, trails.length, name);
    if (!save) { showView('riders'); return; }
    session.saveGame = save;
    session.activeSaveSlot = pendingSaveSlot;
    saveActiveSlot(session.activeSaveSlot);
    session.saveSlots[session.activeSaveSlot] = save;
    session.rider = save.rider;
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

  const back = () => { if ($('menu-home').hidden) { goBack(); return true; } return false; };
  return { open, close, isOpen, updateDashboard, drawBackground, syncSettings, handlePad, showView, canResume, back };
}
