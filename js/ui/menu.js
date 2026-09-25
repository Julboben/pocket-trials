// Main menu: savegames, trail select, leaderboard, settings and how-to-play.
import { clamp } from '../config.js';
import { levels, officialLevelEntries, customLevelEntries, saveBrowserLevel } from '../levels.js';
import { createDrawingTools, createGameArt } from '../drawing.js';
import { createRiderHair, hairRoot, hairRestDirection, hairBackSupport } from '../rider-hair.js';
import {
  loadSaveSlots, loadActiveSlot, saveActiveSlot, createSave, deleteSave, readBest,
  readLeaderboard, LEADERBOARD_SIZE, loadPreferences, savePreferences
} from '../storage.js';
import { normalizeLevel, validateLevel, medalFor } from '../level-schema.js';
import { ACTION_LABELS, keyLabel } from '../input.js';
import {
  $, session, DEFAULT_BINDINGS, DEFAULT_PREFERENCES, sanitizePreferences,
  leaderboardTrails, trailKey, trailMarker, timeText
} from '../state.js';

const riderName = rider => rider === 'Maxine' ? 'MAXINE' : 'MAX';

export function riderSymbolMarkup(selectedRider) {
  return selectedRider === 'Maxine'
    ? '<svg class="rider-symbol" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="5"></circle><path d="M12 13v8M8.5 18h7"></path></svg>'
    : '<svg class="rider-symbol" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="15" r="5"></circle><path d="M13 11 20 4M15 4h5v5"></path></svg>';
}

/** Loads saves and preferences into the session. */
export function loadStoredState() {
  session.preferences = sanitizePreferences(loadPreferences(DEFAULT_PREFERENCES));
  session.saveSlots = loadSaveSlots(levels.length);
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
  session.unlockedLevel = session.saveGame?.unlocked || 0;
  session.savedLevel = session.saveGame?.level || 0;
  session.rider = session.saveGame?.rider || 'max';
}

/**
 * @param {{
 *   sounds: any, input: any,
 *   onStartLevel: (index: number) => void,
 *   onStartCustom: (index: number) => void,
 *   onClose: () => void,
 *   onPreferences: () => void
 * }} hooks
 */
export function createMenu({ sounds, input, onStartLevel, onStartCustom, onClose, onPreferences }) {
  let pendingSaveSlot = 0, selectedNewRider = 'max';
  let deleteArmedSlot = -1, deleteArmTimer = 0, leaderboardTrail = 0;

  const isOpen = () => !$('menu-screen').hidden;

  function drawPreviewRider(artCtx, rearPoint, frontPoint, leanVisual = 0) {
    const pose = {
      rear: { x: rearPoint[0], y: rearPoint[1], spin: 0, compression: 0 },
      front: { x: frontPoint[0], y: frontPoint[1], spin: 0, compression: 0 },
      facing: 1, flipVisual: 1, leanVisual
    };
    if (session.rider === 'Maxine') {
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
    if (!session.saveGame) {
      artCtx.fillStyle = '#17262b'; artCtx.fillRect(0, 0, 120, 84);
      createDrawingTools(artCtx).drawPixelText('+', 60, 32, '#91a7a8', { pixel: 4 });
      return;
    }
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
    session.unlockedLevel = session.saveGame?.unlocked || 0;
    session.savedLevel = session.saveGame?.level || 0;
    session.rider = session.saveGame?.rider || 'max';
    updateDashboard();
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
    session.saveSlots[index] = null;
    if (index === session.activeSaveSlot) {
      session.saveGame = null; session.unlockedLevel = 0; session.savedLevel = 0; session.rider = 'max';
    }
    updateDashboard();
  }

  function buildSaveSlots() {
    const rows = session.saveSlots.map((save, index) => {
      const occupied = Boolean(save);
      const row = document.createElement('div');
      row.className = 'save-slot-row';
      const button = document.createElement('button');
      button.className = 'save-slot';
      button.setAttribute('aria-pressed', String(index === session.activeSaveSlot && occupied));
      button.innerHTML = '<span class="save-avatar ' + (!occupied ? 'empty' : save.rider === 'Maxine' ? 'female' : 'male') + '">' + (!occupied ? '+' : riderSymbolMarkup(save.rider)) + '</span>'
        + '<span class="save-slot-copy"><span class="save-label">SLOT ' + (index + 1) + '</span><strong>' + (!occupied ? 'EMPTY SLOT' : riderName(save.rider)) + '</strong><small>'
        + (!occupied ? 'Start a new game' : (save.unlocked + 1) + ' / ' + levels.length + ' trails · ' + levels[save.level].name) + '</small></span>';
      button.addEventListener('click', () => {
        if (occupied) { selectSaveSlot(index); showView('home'); } else showSaveCreator(index);
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
      palette: levels[session.saveGame?.level || 0],
      cameraX: 260, cameraY: 0,
      full: session.preferences.scenery === 'full'
    });
  }

  function updateDashboard() {
    const hasSave = Boolean(session.saveGame);
    drawActiveSaveIllustration();
    $('active-save-slot').textContent = 'SLOT ' + (session.activeSaveSlot + 1);
    $('active-save-rider').textContent = hasSave ? riderName(session.rider) : '';
    $('active-save-progress').textContent = hasSave ? (session.unlockedLevel + 1) + ' / ' + levels.length + ' trails · ' + levels[session.savedLevel].name : '';
    $('menu-start').hidden = !hasSave;
    $('menu-new-game').classList.toggle('menu-action-primary', !hasSave);
    $('menu-levels').disabled = !hasSave && customLevelEntries.length === 0;
    buildSaveSlots();
    drawBackground();
    drawHowToPlayIllustrations();
    buildLevelCards();
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
    $('menu-home').hidden = view !== 'home';
    $('menu-load-view').hidden = view !== 'load';
    $('menu-level-view').hidden = view !== 'levels';
    $('menu-leaderboard-view').hidden = view !== 'leaderboard';
    $('menu-save-view').hidden = view !== 'save';
    $('menu-how-view').hidden = view !== 'how';
    $('menu-settings-view').hidden = view !== 'settings';
    $('menu-screen').scrollTop = 0;
    requestAnimationFrame(() => {
      const list = controls();
      selectControl(list.find(button => !button.matches('[data-menu-back]')) || list[0]);
    });
  }

  function open() {
    $('menu-screen').hidden = false;
    updateDashboard();
    showView('home');
    requestAnimationFrame(() => selectControl($(session.saveGame ? 'menu-start' : 'menu-new-game')));
  }

  function close() { $('menu-screen').hidden = true; }

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

  function levelCard({ trail, number, status, best = null, locked = false, custom = false, onSelect }) {
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
    bestLabel.textContent = best === null ? '—' : timeText(best);
    const medal = best === null ? null : medalFor(trail.medals, best);
    if (medal) {
      bestLabel.dataset.medal = medal;
      bestLabel.title = medal + ' medal';
    }
    button.append(numberLabel, copy, bestLabel);
    if (!locked) button.addEventListener('click', onSelect);
    return button;
  }

  function buildLevelCards() {
    const cards = [levelSection('OFFICIAL TRAILS', 'Career progression and official best times')];
    levels.forEach((trail, index) => {
      const locked = !session.saveGame || index > session.unlockedLevel;
      cards.push(levelCard({
        trail,
        number: String(index + 1).padStart(2, '0'),
        status: locked ? 'LOCKED' : (index === session.savedLevel ? 'CURRENT TRAIL' : 'UNLOCKED'),
        best: readBest(session.activeSaveSlot, index, levels.length),
        locked,
        onSelect: () => onStartLevel(index)
      }));
    });
    if (customLevelEntries.length) {
      cards.push(levelSection('CUSTOM TRAILS', 'Local trails outside career progression'));
      customLevelEntries.forEach((entry, index) => cards.push(levelCard({
        trail: entry.level,
        number: `C${String(index + 1).padStart(2, '0')}`,
        status: entry.storage === 'browser' ? 'CUSTOM · SAVED IN BROWSER' : 'CUSTOM TRAIL',
        best: readLeaderboard(trailKey(entry))[0]?.time ?? null,
        custom: true,
        onSelect: () => onStartCustom(index)
      })));
    }
    $('menu-level-grid').replaceChildren(...cards);
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
    const mine = Boolean(session.saveGame && run.saveId && run.saveId === session.saveGame.createdAt);
    row.classList.toggle('mine', mine);
    const avatar = document.createElement('span');
    avatar.className = 'save-avatar ' + (run.rider === 'Maxine' ? 'female' : 'male');
    avatar.innerHTML = riderSymbolMarkup(run.rider);
    const copy = document.createElement('span');
    copy.className = 'leaderboard-copy';
    const name = document.createElement('strong');
    name.textContent = riderName(run.rider) + (mine ? ' · YOU' : '');
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
    const trails = leaderboardTrails();
    leaderboardTrail = (leaderboardTrail + trails.length) % trails.length;
    const entry = trails[leaderboardTrail];
    const runs = readLeaderboard(trailKey(entry));
    $('leaderboard-trail-number').textContent = trailMarker(leaderboardTrail);
    $('leaderboard-trail-name').textContent = entry.name.toUpperCase();
    $('leaderboard-trail-meta').textContent = (entry.source === 'custom' ? 'CUSTOM TRAIL' : 'OFFICIAL TRAIL')
      + ' · ' + (leaderboardTrail + 1) + ' / ' + trails.length;
    const rows = Array.from({ length: LEADERBOARD_SIZE }, (_, index) => leaderboardRow(runs[index], index + 1));
    $('leaderboard-list').replaceChildren(...rows);
  }

  function stepLeaderboard(direction) {
    leaderboardTrail += direction;
    buildLeaderboard();
  }

  function currentLeaderboardTrail() {
    if (session.levelSource === 'custom' && session.customLevelIndex >= 0) return officialLevelEntries.length + session.customLevelIndex;
    return session.gameLoopStarted ? session.levelIndex : session.savedLevel;
  }

  function showSaveCreator(slotIndex = session.activeSaveSlot) {
    pendingSaveSlot = slotIndex;
    $('new-save-slot-label').textContent = 'SAVE SLOT ' + (pendingSaveSlot + 1);
    $('create-save').textContent = 'Create Save & Ride →';
    showView('save');
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
      if ($('menu-home').hidden) { sounds.menuBack(); updateDashboard(); showView('home'); } else onClose();
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
    else if (button.id === 'create-save' || button.id === 'menu-start') sounds.menuConfirm();
    else sounds.menuSelect();
  });
  $('menu-start').addEventListener('click', () => onStartLevel(session.savedLevel));
  $('menu-new-game').addEventListener('click', () => {
    const emptySlot = session.saveSlots.findIndex(save => !save);
    if (emptySlot < 0) {
      $('load-game-help').textContent = 'All three slots are occupied. Delete a savegame before starting a new one.';
      showView('load');
      return;
    }
    showSaveCreator(emptySlot);
  });
  $('menu-load-game').addEventListener('click', () => {
    $('load-game-help').textContent = 'Select a savegame to make it active. Empty slots can be used for a new game.';
    buildSaveSlots();
    showView('load');
  });
  $('menu-levels').addEventListener('click', () => { buildLevelCards(); showView('levels'); });
  $('import-trail').addEventListener('click', () => $('import-trail-file').click());
  $('import-trail-file').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const trail = normalizeLevel(JSON.parse(await file.text()), customLevelEntries.length);
      const errors = validateLevel(trail).filter(message => message.type === 'error');
      if (errors.length) throw new Error(errors[0].text);
      saveBrowserLevel(trail);
      updateDashboard();
      showView('levels');
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
  document.querySelectorAll('[data-menu-back]').forEach(button => button.addEventListener('click', () => {
    updateDashboard();
    showView('home');
  }));
  document.querySelectorAll('[data-rider]').forEach(button => button.addEventListener('click', () => {
    selectedNewRider = button.dataset.rider;
    document.querySelectorAll('[data-rider]').forEach(choice => choice.setAttribute('aria-pressed', String(choice === button)));
  }));
  $('create-save').addEventListener('click', () => {
    const save = createSave(pendingSaveSlot, selectedNewRider, levels.length);
    if (!save) { showView('load'); return; }
    session.saveGame = save;
    session.activeSaveSlot = pendingSaveSlot;
    saveActiveSlot(session.activeSaveSlot);
    session.saveSlots[session.activeSaveSlot] = save;
    session.rider = save.rider;
    session.unlockedLevel = 0; session.savedLevel = 0;
    onStartLevel(0);
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

  return { open, close, isOpen, updateDashboard, drawBackground, syncSettings, handlePad, showView };
}
