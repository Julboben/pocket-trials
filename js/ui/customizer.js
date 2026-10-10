// The rider customizer, used when creating a rider and in the Garage: a tab
// per part (hair, helmet, outfit, bike) with an icon, a live preview of the
// rider on their bike, the part's styles, and its colours in their own panel.
// Every style swatch is the real rider, drawn by
// the game's renderer with that one item swapped in, so it matches the ride.
// Gender and skin are the rider's identity: picked once, on the first step
// of creating a rider (createIdentityPicker), and never changed here.
import { trails } from '../trails.js';
import { RADIUS } from '../config.js';
import { drawFigure, posedRide } from '../scene-preview.js';
import { drawGarage } from '../garage-backdrop.js';
import {
  DEFAULT_LOOK, LOOK_PARTS, SLOT_LABELS, isColorless, isDefaultItem, itemsForSlot, lookItem, lookKey,
  normalizeLook, partName, sameLook, starterLook
} from '../cosmetics.js';

// What each view frames, in world units around the bike's axles.
const SWATCH_VIEWS = {
  head: { dx: 6, dy: -45, width: 30, height: 30 },
  outfit: { dx: -8, dy: -30, width: 44, height: 44 },
  bike: { dx: 0, dy: -22, width: 88, height: 70 },
  // The big preview: the whole rider and bike, wheels and floor included.
  full: { dx: 0, dy: -20, width: 176, height: 88 }
};

// Which view each part's style swatches use. Hair hides under a helmet, so
// its swatches show the head bare.
const PART_VIEWS = { hair: 'head', helmet: 'head', outfit: 'outfit', bike: 'bike' };
const BARE_PARTS = new Set(['hair']);

let pose = null;
/** The rider at the first trail's start, which every preview and swatch shows. */
function posed() {
  if (!pose) {
    const trail = trails[0];
    const ride = posedRide(trail);
    // The garage floor is flat, so level the bike the start's slope tipped.
    const axle = Math.max(ride.rear.y, ride.front.y);
    ride.rear.y = ride.front.y = axle;
    const x = (ride.rear.x + ride.front.x) / 2;
    const floor = axle + RADIUS;
    pose = { trail, ride, x, y: axle, backdrop: (ctx, view) => drawGarage(ctx, view, { x, floor }) };
  }
  return pose;
}

/**
 * Paints `look`'s rider in the garage into `target`, framed by `view`:
 * 'head', 'outfit', 'bike' or 'full' (the big preview).
 * @param {HTMLCanvasElement} target
 * @param {any} look
 * @param {string} [view]
 */
export function drawLook(target, look, view = 'full') {
  const { ride, x, y, backdrop } = posed();
  const frame = SWATCH_VIEWS[view] ?? SWATCH_VIEWS.full;
  return drawFigure(target, {
    ride, look, backdrop,
    width: frame.width, height: frame.height,
    focus: { x: x + frame.dx * ride.facing, y: y + frame.dy }, anchor: [0.5, 0.5]
  });
}

function element(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function icon(name) {
  const node = element('span');
  node.dataset.icon = name;
  node.setAttribute('aria-hidden', 'true');
  return node;
}

/** A section heading: a title, and a note on the right. */
function sectionHead() {
  const head = element('div', 'look-section-head');
  const title = element('h4');
  const note = element('small');
  head.append(title, note);
  return { head, title, note };
}

/** A two-tone colour chip, as in the colour panel and the skin picker. */
function chip(item) {
  const swatch = element('span', 'look-chip-colors');
  swatch.setAttribute('aria-hidden', 'true');
  const [base, shade] = item.chip ?? ['#000', '#000'];
  swatch.style.setProperty('--chip-a', base);
  swatch.style.setProperty('--chip-b', shade);
  return swatch;
}

function radio(className, checked, label) {
  const option = element('button', className);
  option.type = 'button';
  option.setAttribute('role', 'radio');
  option.setAttribute('aria-checked', String(checked));
  option.setAttribute('aria-label', label);
  option.title = label;
  return option;
}

/**
 * @typedef {{
 *   paint: (target: HTMLCanvasElement, key: string, render: (image: HTMLCanvasElement) => void, options?: { now?: boolean }) => void,
 *   previewKey: (...parts: string[]) => string
 * }} PaintHooks  `paint` draws into a canvas through the menu's preview cache.
 */

/**
 * @param {HTMLElement} root  emptied and filled with the customizer
 * @param {PaintHooks & {
 *   onChange?: (look: any) => void,
 *   owns?: (slot: string, id: string) => boolean
 * }} hooks  `owns` says which items the rider may wear; every item is a
 *   default one for now, and locked items are shown but cannot be picked.
 */
export function createCustomizer(root, { paint, previewKey, onChange = () => {}, owns = isDefaultItem }) {
  let look = { ...DEFAULT_LOOK };
  // The look the customizer was opened with, which Revert goes back to.
  let original = look;
  let part = LOOK_PARTS[0];

  root.classList.add('look-editor');

  // Tabs, one per part, beside the big preview.
  const tabs = element('div', 'look-tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Rider look');
  const tabButtons = LOOK_PARTS.map(entry => {
    const tab = element('button', 'look-tab');
    tab.type = 'button';
    tab.setAttribute('role', 'tab');
    tab.dataset.lookPart = entry.id;
    const text = element('span', 'look-tab-text');
    text.append(element('b', '', SLOT_LABELS[entry.style].toUpperCase()), element('small'));
    tab.append(icon(entry.icon), text);
    tab.addEventListener('click', () => { part = entry; render(); });
    return tab;
  });
  tabs.append(...tabButtons);

  const stage = element('div', 'look-stage');
  const preview = element('canvas', 'look-preview');
  preview.setAttribute('role', 'img');
  const previous = stepButton('arrow-left', -1);
  const next = stepButton('arrow-right', 1);
  stage.append(preview, previous, next);

  const top = element('div', 'look-top');
  top.append(tabs, stage);

  // The part's styles, with the selected one described.
  const styles = element('section', 'look-section');
  const styleHead = sectionHead();
  const detail = element('div', 'look-detail');
  const detailName = element('b');
  const detailBlurb = element('small');
  detail.append(detailName, detailBlurb);
  const options = element('div', 'look-options');
  options.setAttribute('role', 'radiogroup');
  styles.append(styleHead.head, detail, options);

  // The part's colours, in their own panel.
  const colors = element('section', 'look-section look-colors');
  const colorHead = sectionHead();
  const chips = element('div', 'look-chips');
  chips.setAttribute('role', 'radiogroup');
  colors.append(colorHead.head, chips);

  const actions = element('div', 'look-actions');
  const revert = element('button', 'menu-back look-revert', 'REVERT');
  revert.type = 'button';
  revert.disabled = true;
  revert.dataset.iconBefore = 'undo';
  revert.title = 'Undo every change since this screen opened';
  revert.addEventListener('click', () => set(original));
  actions.append(revert);

  root.replaceChildren(top, styles, colors, actions);

  function stepButton(iconName, step) {
    const button = element('button', 'look-step');
    button.type = 'button';
    button.append(icon(iconName));
    button.setAttribute('aria-label', step < 0 ? 'Previous style' : 'Next style');
    button.addEventListener('click', () => {
      const items = itemsForSlot(part.style).filter(item => owns(part.style, item.id));
      if (!items.length) return;
      const index = items.findIndex(item => item.id === look[part.style]);
      set({ ...look, [part.style]: items[(index + step + items.length) % items.length].id });
    });
    return button;
  }

  function set(nextLook) {
    look = normalizeLook(nextLook, { fallback: look, owns });
    render();
    onChange({ ...look });
  }

  function paintLook(target, shown, view) {
    paint(target, previewKey('look', view, lookKey(shown)), image => drawLook(image, shown, view));
  }

  function renderStyles() {
    const slot = part.style;
    const items = itemsForSlot(slot);
    const selected = lookItem(slot, look[slot]);
    styleHead.title.textContent = SLOT_LABELS[slot].toUpperCase();
    styleHead.note.textContent = `${items.findIndex(item => item.id === look[slot]) + 1} / ${items.length}`;
    detailName.textContent = selected?.name.toUpperCase() ?? '';
    detailBlurb.textContent = selected?.blurb ?? '';
    options.setAttribute('aria-label', SLOT_LABELS[slot]);
    const view = PART_VIEWS[part.id];
    options.replaceChildren(...items.map(item => {
      const locked = !owns(slot, item.id);
      const option = radio('look-option', look[slot] === item.id, locked ? `${item.name} (locked)` : item.name);
      option.disabled = locked;
      option.classList.toggle('locked', locked);
      const swatch = element('canvas');
      swatch.setAttribute('aria-hidden', 'true');
      const shown = { ...look, ...(BARE_PARTS.has(part.id) ? { helmet: 'none' } : {}), [slot]: item.id };
      paintLook(swatch, shown, view);
      option.append(swatch, element('small', '', item.name));
      if (locked) option.append(icon('lock'));
      option.addEventListener('click', () => set({ ...look, [slot]: item.id }));
      return option;
    }));
  }

  function renderColors() {
    const slot = part.color;
    const colorless = isColorless(look, part);
    const selected = lookItem(slot, look[slot]);
    colorHead.title.textContent = SLOT_LABELS[slot].toUpperCase();
    colorHead.note.textContent = colorless ? `None for ${lookItem(part.style, look[part.style])?.name.toLowerCase()}` : selected?.name ?? '';
    colors.classList.toggle('disabled', colorless);
    chips.setAttribute('aria-label', SLOT_LABELS[slot]);
    chips.replaceChildren(...itemsForSlot(slot).map(item => {
      const locked = !owns(slot, item.id);
      const option = radio('look-chip', look[slot] === item.id, locked ? `${item.name} (locked)` : item.name);
      option.disabled = locked || colorless;
      option.classList.toggle('locked', locked);
      option.append(chip(item));
      if (locked) option.append(icon('lock'));
      option.addEventListener('click', () => set({ ...look, [slot]: item.id }));
      return option;
    }));
  }

  function render() {
    paintLook(preview, look, 'full');
    const names = [['gender', look.gender], ['skin', look.skin]].map(([slot, id]) => lookItem(slot, id)?.name)
      .concat(LOOK_PARTS.map(entry => partName(look, entry)));
    preview.setAttribute('aria-label', 'Your rider: ' + names.join(', '));
    for (const tab of tabButtons) {
      const entry = LOOK_PARTS.find(candidate => candidate.id === tab.dataset.lookPart);
      tab.setAttribute('aria-selected', String(entry === part));
      tab.querySelector('small').textContent = partName(look, entry);
    }
    renderStyles();
    renderColors();
    revert.disabled = sameLook(look, original);
  }

  return {
    /** Shows `nextLook` without reporting a change, e.g. when the view opens. */
    setLook(nextLook, { tab = null } = {}) {
      look = original = normalizeLook(nextLook, { owns });
      if (tab) part = LOOK_PARTS.find(entry => entry.id === tab) ?? part;
      render();
    },
    look: () => ({ ...look }),
    /** Where the host adds its own buttons, beside Revert. */
    actions,
    refresh: render
  };
}

/**
 * The first step of creating a rider: gender and skin tone, picked once.
 * Skin swatches are the rider's bare head in that tone, with their gender's
 * starter hair.
 * @param {HTMLElement} root  emptied and filled with the picker
 * @param {PaintHooks & { onChange?: (identity: { gender: string, skin: string }) => void }} hooks
 */
export function createIdentityPicker(root, { paint, previewKey, onChange = () => {} }) {
  let identity = { gender: DEFAULT_LOOK.gender, skin: DEFAULT_LOOK.skin };
  root.classList.add('look-identity');

  const genderSection = element('section', 'look-section');
  const genderHead = sectionHead();
  genderHead.title.textContent = 'GENDER';
  const genders = element('div', 'look-genders');
  genders.setAttribute('role', 'radiogroup');
  genders.setAttribute('aria-label', 'Gender');
  genderSection.append(genderHead.head, genders);

  const skinSection = element('section', 'look-section');
  const skinHead = sectionHead();
  skinHead.title.textContent = 'SKIN TONE';
  const skinDetail = element('div', 'look-detail');
  const skinName = element('b');
  const skinBlurb = element('small');
  skinDetail.append(skinName, skinBlurb);
  const skins = element('div', 'look-options look-skins');
  skins.setAttribute('role', 'radiogroup');
  skins.setAttribute('aria-label', 'Skin tone');
  skinSection.append(skinHead.head, skinDetail, skins);

  root.replaceChildren(genderSection, skinSection);

  function set(next) {
    identity = { ...identity, ...next };
    render();
    onChange({ ...identity });
  }

  function render() {
    genders.replaceChildren(...itemsForSlot('gender').map(item => {
      const option = radio('look-gender', identity.gender === item.id, item.name);
      option.append(icon(item.id), element('b', '', item.name.toUpperCase()));
      option.addEventListener('click', () => set({ gender: item.id }));
      return option;
    }));
    const skin = lookItem('skin', identity.skin);
    skinHead.note.textContent = '';
    skinName.textContent = skin?.name.toUpperCase() ?? '';
    skinBlurb.textContent = skin?.blurb ?? '';
    skins.replaceChildren(...itemsForSlot('skin').map(item => {
      const option = radio('look-option', identity.skin === item.id, item.name);
      const swatch = element('canvas');
      swatch.setAttribute('aria-hidden', 'true');
      const shown = { ...starterLook(identity.gender, item.id), helmet: 'none' };
      paint(swatch, previewKey('look', 'head', lookKey(shown)), image => drawLook(image, shown, 'head'));
      option.append(swatch, element('small', '', item.name));
      option.addEventListener('click', () => set({ skin: item.id }));
      return option;
    }));
  }

  return {
    /** Shows `next` without reporting a change, e.g. when the form opens. */
    setIdentity(next) {
      identity = { gender: next.gender, skin: next.skin };
      render();
    },
    identity: () => ({ ...identity }),
    refresh: render
  };
}
