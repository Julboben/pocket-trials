// Rider looks: who the rider is and what they wear and ride. Shared by the
// game, the editor and the server, so it stays free of the DOM.
//
// A look is one item id per slot. Gender and skin are the rider's identity:
// they are picked once, when the rider is created. Every other part is a style
// plus a colour, each its own slot, so a colour can be won on its own later.
// Item ids are stored in saves, runs and ghosts, so they are never renamed or
// reused: retire an item with `hidden: true` instead. Every item has an
// `unlock` rule: 'default' items are everyone's from the start, 'golds' asks
// for gold medals on that many official trails, and 'trail' for a finished
// trail. Rules are data, so new rewards don't change what a look is.

export const LOOK_SLOTS = /** @type {const} */ ([
  'gender', 'skin',
  'hair', 'hairColor', 'helmet', 'helmetColor', 'outfit', 'outfitColor', 'bike', 'bikeColor'
]);

/** Slots chosen once, when a rider is created, and kept for good. */
export const IDENTITY_SLOTS = /** @type {const} */ (['gender', 'skin']);

/**
 * The parts a rider can change in the Garage, in tab order: a style slot, its
 * colour slot, and the pixel icon (icons/pixel-icons.mjs) for its tab.
 */
export const LOOK_PARTS = Object.freeze([
  { id: 'hair', style: 'hair', color: 'hairColor', icon: 'hair', blurb: 'Cut' },
  { id: 'helmet', style: 'helmet', color: 'helmetColor', icon: 'helmet', blurb: 'Protection' },
  { id: 'outfit', style: 'outfit', color: 'outfitColor', icon: 'jacket', blurb: 'Gear' },
  { id: 'bike', style: 'bike', color: 'bikeColor', icon: 'bike', blurb: 'Machine' },
].map(part => Object.freeze(part)));

export const SLOT_LABELS = Object.freeze({
  gender: 'Gender', skin: 'Skin tone',
  hair: 'Hair', hairColor: 'Hair colour',
  helmet: 'Helmet', helmetColor: 'Helmet colour',
  outfit: 'Outfit', outfitColor: 'Outfit colour',
  bike: 'Bike', bikeColor: 'Bike colour',
});

/**
 * The art set the look is drawn with. Looks only describe roles and shapes, so
 * a new rider and bike art set can map them its own way without changing the
 * catalog or any save.
 */
export const LOOK_ART = 'pocket';

const DEFAULT_UNLOCK = Object.freeze({ type: 'default' });

/** The bonus trail that wins the motocross helmet. */
export const MX_HELMET_TRAIL = 'bonus:01-the-bonny-tyler';

/**
 * @typedef {{
 *   gender: string, skin: string,
 *   hair: string, hairColor: string, helmet: string, helmetColor: string,
 *   outfit: string, outfitColor: string, bike: string, bikeColor: string
 * }} Look
 * @typedef {{
 *   id: string, slot: string, name: string, unlock: Unlock,
 *   hidden?: boolean, colorless?: boolean, lean?: string, blurb?: string, chip?: string[],
 *   [key: string]: any
 * }} LookItem
 * @typedef {{ type: 'default' } | { type: 'golds', count: number } | { type: 'trail', trail: string }} Unlock
 * @typedef {{ golds: number, finished: (trailId: string) => boolean }} LookProgress
 *   what a career has done: gold medals won on official trails, and whether
 *   a trail (by catalog id) has been finished
 */

// Skin: the face, its highlight and shadow, a plain mouth and a rosier one.
const skin = (id, name, [skin, skinLight, skinShade], mouth, lips, blurb) =>
  ({ id, slot: 'skin', name, blurb, chip: [skinLight, skin], colors: { skin, skinLight, skinShade, mouth, lips } });

// Hair colour: the cap, its highlight and shadow, and the ponytail's outline.
const hairColor = (id, name, [hair, hairLight, hairShade, hairDark], lean) =>
  ({ id, slot: 'hairColor', name, lean, chip: [hair, hairShade], colors: { hair, hairLight, hairShade, hairDark } });

// Hair cuts, as drawn by drawBareHead: `cap` covers the crown ('short' stops
// above the ear, 'long' falls to the nape, 'buzz' is the top row only, 'bald'
// has none), `brow` draws an eyebrow and `ponytail` adds the swinging tail.
const hairStyle = (id, name, style, blurb, extra = {}) =>
  ({ id, slot: 'hair', name, blurb, style, shape: id, ...extra });

const helmetColor = (id, name, [helmet, helmetLight, helmetShade], stripe, visorLight, lean) =>
  ({ id, slot: 'helmetColor', name, lean, chip: [helmet, helmetShade], colors: { helmet, helmetLight, helmetShade, stripe, visor: '#234844', visorLight } });

// Outfit colour: the jacket, and the panel that trims it.
const outfitColor = (id, name, [jacket, jacketLight, jacketShade], panel, lean) =>
  ({ id, slot: 'outfitColor', name, lean, chip: [jacket, panel], colors: { jacket, jacketLight, jacketShade, panel } });

// Bike colour: the plastics, their highlight and shadow, and the frame.
const bikeColor = (id, name, [base, light, dark], shade, lean) =>
  ({ id, slot: 'bikeColor', name, lean, chip: [base, dark], colors: { base, light, dark, shade } });

/** Every item, in the order the customizer lists them. */
export const LOOK_ITEMS = /** @type {LookItem[]} */ ([
  { id: 'female', slot: 'gender', name: 'Female', face: { lash: true, lips: true } },
  { id: 'male', slot: 'gender', name: 'Male', face: { lash: false, lips: false } },

  skin('fair', 'Fair', ['#e8b48f', '#f7d1b0', '#c48f6c'], '#b0505e', '#c94f68', 'Burns before the first checkpoint.'),
  skin('light', 'Light', ['#d99a72', '#f0bb93', '#b47454'], '#a24c4c', '#bf4e62', 'Fresh out of the garage.'),
  skin('tan', 'Tan', ['#bd7954', '#dfa078', '#9a5c40'], '#87483a', '#b0505e', 'A summer of dusty trails.'),
  skin('brown', 'Brown', ['#8f5638', '#b0714c', '#6d3f28'], '#4f2519', '#7a3040', 'Just right for the big rides.'),
  skin('deep', 'Deep', ['#5e3726', '#7e4c35', '#45271b'], '#2c140c', '#5a2232', 'Rides from dawn to dusk.'),

  hairStyle('short', 'Short', { cap: 'short', brow: true, ponytail: false }, 'Neat under any helmet.', { lean: 'male' }),
  hairStyle('ponytail', 'Ponytail', { cap: 'long', brow: false, ponytail: true }, 'Long hair. More wind.', { lean: 'female' }),
  hairStyle('bob', 'Bob', { cap: 'long', brow: false, ponytail: false }, 'Swings on every landing.', { lean: 'female' }),
  hairStyle('buzz', 'Buzz cut', { cap: 'buzz', brow: true, ponytail: false }, 'Low drag, no fuss.', { lean: 'male' }),
  hairStyle('bald', 'Bald', { cap: 'bald', brow: false, ponytail: false }, 'Nothing to mess up.', { colorless: true }),

  hairColor('brown', 'Brown', ['#3d2a24', '#5e4334', '#2e1d19', '#1f1411'], 'male'),
  hairColor('auburn', 'Auburn', ['#684438', '#8c5d48', '#54362d', '#2e1d19'], 'female'),
  hairColor('black', 'Black', ['#2a2321', '#463c39', '#1b1615', '#0e0b0b']),
  hairColor('blonde', 'Blonde', ['#d3a347', '#f0cd7c', '#a67a30', '#5e4319'], 'female'),
  hairColor('red', 'Red', ['#b04a26', '#d8713f', '#83341a', '#4d1d0e'], 'female'),
  hairColor('grey', 'Grey', ['#9b9a95', '#c9c8c1', '#727169', '#45443f']),
  hairColor('pink', 'Pink', ['#d97a9c', '#f2a6c0', '#ab5576', '#5e2a3d'], 'female'),

  { id: 'classic', slot: 'helmet', name: 'Full face', shape: 'classic', blurb: 'Tinted visor, stripe on top.' },
  {
    id: 'mx', slot: 'helmet', name: 'Motocross', shape: 'mx', blurb: 'Long peak, goggles, chin bar out front.',
    unlock: { type: 'trail', trail: MX_HELMET_TRAIL }
  },
  // No helmet: the bare head shows while riding, and a crash has none to knock off.
  { id: 'none', slot: 'helmet', name: 'No helmet', bare: true, colorless: true, blurb: 'Wind in your hair. Mind the rocks.' },

  helmetColor('orange', 'Orange', ['#f4a442', '#ffd078', '#bd7034'], '#fff8e7', '#83bcb6', 'male'),
  helmetColor('teal', 'Teal', ['#63aa98', '#a8dfcf', '#3c786e'], '#fff8e7', '#b0dfd4', 'female'),
  helmetColor('red', 'Red', ['#d64a3a', '#f2836a', '#9c2f26'], '#fff8e7', '#83bcb6'),
  helmetColor('blue', 'Blue', ['#3f6fc0', '#7ea6e6', '#2a4c88'], '#f4a442', '#b0dfd4', 'male'),
  helmetColor('yellow', 'Yellow', ['#f2cf3c', '#fff08a', '#b8942a'], '#263b36', '#83bcb6'),
  helmetColor('white', 'White', ['#e8e5d9', '#fff8e7', '#b5bcae'], '#3f6fc0', '#83bcb6'),
  helmetColor('black', 'Black', ['#3a4144', '#646d70', '#252a2c'], '#d64a3a', '#83bcb6', 'male'),
  helmetColor('pink', 'Pink', ['#e07a9a', '#f7b0c6', '#a8506e'], '#fff8e7', '#b0dfd4', 'female'),
  helmetColor('purple', 'Purple', ['#7b5cc0', '#a98be6', '#53398a'], '#fff8e7', '#b0dfd4', 'female'),

  // The one outfit for now: what goes with the jacket, from the gloves down.
  {
    id: 'street', slot: 'outfit', name: 'Street jacket', shape: 'jacket', blurb: 'Dark jeans, sturdy boots.',
    colors: { trousers: '#29464e', trousersLight: '#42616a', gloves: '#304a42', boots: '#263b36', sole: '#657a70' }
  },

  outfitColor('white', 'White', ['#e8e5d9', '#fff8e7', '#b5bcae'], '#29464e', 'male'),
  outfitColor('pink', 'Pink', ['#d86f82', '#ef9aa8', '#a94f69'], '#59415c', 'female'),
  outfitColor('green', 'Green', ['#4f9a48', '#8fd16e', '#33692f'], '#263b36'),
  outfitColor('red', 'Red', ['#c9433a', '#ec7b62', '#8f2c26'], '#f4e9d0'),
  outfitColor('blue', 'Blue', ['#4b6fa5', '#7d9fd0', '#334e78'], '#f2b24a', 'male'),
  outfitColor('black', 'Black', ['#35393c', '#5d6468', '#202325'], '#c9433a', 'male'),
  outfitColor('yellow', 'Hi-vis', ['#f2cf3c', '#fff08a', '#b8942a'], '#3d4a4f'),
  outfitColor('orange', 'Orange', ['#e8823a', '#f7ae6a', '#b45a24'], '#263b36'),
  outfitColor('purple', 'Purple', ['#7b5cc0', '#a98be6', '#53398a'], '#f4e9d0', 'female'),
  outfitColor('teal', 'Teal', ['#4f9a8c', '#86cfc0', '#336b61'], '#f4e9d0', 'female'),

  // Bikes only change the art: every model shares the seat, pegs and bars.
  { id: 'elasto', slot: 'bike', name: 'Elasto', model: 'elasto', shape: 'elasto', blurb: 'Long-travel trials bike.' },
  {
    id: 'classic', slot: 'bike', name: 'Pocket Classic', model: 'classic', shape: 'classic', blurb: 'The original. Still rides.',
    unlock: { type: 'golds', count: 8 }
  },

  bikeColor('green', 'Green', ['#3aa63c', '#8fdc6e', '#1f6b2c'], '#2e8a34'),
  bikeColor('orange', 'Orange', ['#ee6f3f', '#f39a63', '#a8461f'], '#d95832'),
  bikeColor('red', 'Red', ['#d63b2c', '#f0705c', '#8f2219'], '#b52f22', 'male'),
  bikeColor('blue', 'Blue', ['#3f6fc0', '#7ea6e6', '#2a4c88'], '#335da6', 'male'),
  bikeColor('yellow', 'Yellow', ['#f2cf3c', '#fff08a', '#b8942a'], '#d9b030'),
  bikeColor('white', 'White', ['#e8e5d9', '#fff8e7', '#9aa39a'], '#c8c9bd'),
  bikeColor('black', 'Black', ['#3a4144', '#646d70', '#1b2124'], '#2c3234', 'male'),
  bikeColor('pink', 'Pink', ['#e07a9a', '#f7b0c6', '#a8506e'], '#c8607f', 'female'),
  bikeColor('purple', 'Purple', ['#7b5cc0', '#a98be6', '#53398a'], '#674aa6', 'female'),
].map(item => Object.freeze({ unlock: DEFAULT_UNLOCK, ...item })));

const ITEMS_BY_ID = new Map(LOOK_ITEMS.map(item => [`${item.slot}:${item.id}`, item]));

/** @returns {LookItem | null} */
export const lookItem = (slot, id) => ITEMS_BY_ID.get(`${slot}:${id}`) ?? null;

/** The items the customizer offers for `slot`, in order. */
export const itemsForSlot = slot => LOOK_ITEMS.filter(item => item.slot === slot && !item.hidden);

/** Whether every rider has this item from the start. */
export const isDefaultItem = (slot, id) => lookItem(slot, id)?.unlock.type === 'default';

/**
 * Whether a career with `progress` has met an unlock rule. Without a career
 * (null), only default items are open.
 * @param {Unlock} unlock
 * @param {LookProgress | null} progress
 */
export function isUnlocked(unlock, progress) {
  if (unlock.type === 'default') return true;
  if (!progress) return false;
  if (unlock.type === 'golds') return progress.golds >= unlock.count;
  if (unlock.type === 'trail') return progress.finished(unlock.trail);
  return false;
}

/** The `owns` check for a career with `progress`: the items it has unlocked. */
export const ownsWith = progress => (slot, id) => {
  const item = lookItem(slot, id);
  return Boolean(item && isUnlocked(item.unlock, progress));
};

/** Any item in the catalog: for looks already worn in a save, run or ghost. */
const anyItem = (slot, id) => Boolean(lookItem(slot, id));

/** Each gender's first look: what a new rider starts from, before any change. */
export const STARTER_LOOKS = Object.freeze({
  female: Object.freeze({
    gender: 'female', skin: 'light',
    hair: 'ponytail', hairColor: 'auburn', helmet: 'classic', helmetColor: 'teal',
    outfit: 'street', outfitColor: 'pink', bike: 'elasto', bikeColor: 'green'
  }),
  male: Object.freeze({
    gender: 'male', skin: 'light',
    hair: 'short', hairColor: 'brown', helmet: 'classic', helmetColor: 'orange',
    outfit: 'street', outfitColor: 'white', bike: 'elasto', bikeColor: 'green'
  }),
});

/** The look a rider gets when nothing else is known. */
export const DEFAULT_LOOK = /** @type {Look} */ (STARTER_LOOKS.male);

/** A new rider's look: their gender's starter look in their skin tone. */
export const starterLook = (gender, skin = DEFAULT_LOOK.skin) =>
  /** @type {Look} */ ({ ...(STARTER_LOOKS[gender] ?? DEFAULT_LOOK), skin: lookItem('skin', skin) ? skin : DEFAULT_LOOK.skin });

// The two riders from before looks existed, item for item.
const LEGACY_LOOKS = {
  male: Object.freeze({ ...STARTER_LOOKS.male, skin: 'tan' }),
  female: Object.freeze({ ...STARTER_LOOKS.female, skin: 'tan' }),
};

/** The look of a rider saved as 'male' or 'female' before looks existed. */
export const legacyLook = rider => LEGACY_LOOKS[rider] ?? LEGACY_LOOKS.male;

/** 'male' or 'female', for clients and rows from before looks existed. */
export const legacyRider = look => (look?.gender === 'female' ? 'female' : 'male');

/**
 * A complete, valid look. Each slot keeps its item if it exists and the rider
 * `owns` it (any catalog item, unless given), and otherwise falls back to
 * `fallback`'s item for that slot, so a bad or retired id never breaks the
 * rest of the look.
 * @param {any} raw
 * @param {{ fallback?: Look, owns?: (slot: string, id: string) => boolean }} [options]
 * @returns {Look}
 */
export function normalizeLook(raw, { fallback = DEFAULT_LOOK, owns = anyItem } = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const look = /** @type {Look} */ ({});
  for (const slot of LOOK_SLOTS) {
    const id = source[slot];
    look[slot] = typeof id === 'string' && lookItem(slot, id) && owns(slot, id) ? id : fallback[slot];
  }
  return look;
}

/**
 * `look` with only items the rider `owns`: any other slot goes back to their
 * starter item, which every rider has.
 * @returns {Look}
 */
export function ownedLook(look, owns) {
  const valid = normalizeLook(look);
  return normalizeLook(valid, { fallback: starterLook(valid.gender, valid.skin), owns });
}

/** `next`, keeping `current`'s gender and skin: identity is never changed after creation. */
export const keepIdentity = (next, current) => {
  const look = { ...next };
  for (const slot of IDENTITY_SLOTS) look[slot] = current[slot];
  return look;
};

/**
 * The look stored with a save, run or ghost: its `look`, filling any gaps from
 * its old `rider` field, so records from before looks existed keep theirs.
 */
export const lookOf = record => normalizeLook(record?.look, { fallback: legacyLook(record?.rider) });

/** Whether `raw` names a real item in every slot, before any fallback. */
export const isCompleteLook = raw => Boolean(raw && typeof raw === 'object'
  && LOOK_SLOTS.every(slot => typeof raw[slot] === 'string' && lookItem(slot, raw[slot])));

/** A short string that is the same for equal looks, for cache keys. */
export const lookKey = look => LOOK_SLOTS.map(slot => look?.[slot] ?? '').join('.');

export const sameLook = (a, b) => lookKey(a) === lookKey(b);

/** Whether a part's style has no colour to pick (bald, no helmet). */
export const isColorless = (look, part) => Boolean(lookItem(part.style, look?.[part.style])?.colorless);

/** How a part reads in a list: "Auburn ponytail", "Bald", "Teal full face". */
export function partName(look, part) {
  const style = lookItem(part.style, look?.[part.style]);
  const color = lookItem(part.color, look?.[part.color]);
  if (!style) return '';
  if (style.colorless || !color) return style.name;
  return `${color.name} ${style.name.toLowerCase()}`;
}

/**
 * A random look from the items the rider owns, keeping `identity`'s gender and
 * skin. Items that lean towards the rider's gender come up more often, but
 * any item can be picked.
 */
export function randomLook(identity = DEFAULT_LOOK, { random = Math.random, owns = isDefaultItem } = {}) {
  const look = /** @type {Look} */ ({ ...normalizeLook(identity, { owns: () => true }) });
  for (const part of LOOK_PARTS) {
    for (const slot of [part.style, part.color]) {
      const items = itemsForSlot(slot).filter(item => owns(slot, item.id));
      const weights = items.map(item => (item.lean === look.gender ? 3 : 1));
      let pick = random() * weights.reduce((sum, weight) => sum + weight, 0);
      const index = weights.findIndex(weight => (pick -= weight) < 0);
      if (items.length) look[slot] = items[index < 0 ? items.length - 1 : index].id;
    }
  }
  return look;
}

/**
 * @typedef {{
 *   key: string,
 *   art: string,
 *   look: Look,
 *   palette: Record<string, string>,
 *   roles: Record<string, Record<string, string> | null>,
 *   shapes: { hair: string, helmet: string, outfit: string, bike: string },
 *   face: { lash: boolean, lips: boolean },
 *   hair: { cap: string, brow: boolean, ponytail: boolean, strands: string[], outline: string, shine: string },
 *   helmet: boolean,
 *   bike: string,
 *   bikeColors: Record<string, string>
 * }} LookParts
 */

const FIXED_COLORS = { eye: '#263b36' };
// The bare head under a missing helmet: there is no shell, but the goggle
// strap and visor keys are still read by shared drawing code.
const NO_HELMET_COLORS = lookItem('helmetColor', 'orange').colors;

const PARTS_CACHE_SIZE = 32;
const partsCache = new Map();

/**
 * Everything the renderer needs for a look. `roles` and `shapes` describe it
 * in art-independent terms (skin, hair, helmet shell, jersey, bike plastics),
 * for any art set. `palette` is those roles mapped onto the colour keys the
 * current rider art reads. Cached, and the same object for equal looks, so
 * sprite caches can key on it.
 * @param {any} look
 * @returns {LookParts}
 */
export function lookParts(look) {
  const key = lookKey(look);
  let parts = partsCache.get(key);
  if (parts) {
    partsCache.delete(key);
    partsCache.set(key, parts);
    return parts;
  }
  const valid = normalizeLook(look, { owns: () => true });
  const item = slot => lookItem(slot, valid[slot]);
  const face = item('gender').face;
  const skinColors = item('skin').colors;
  const hairStyleItem = item('hair'), hairColors = item('hairColor').colors;
  const helmetItem = item('helmet'), helmetColors = item('helmetColor').colors;
  const outfitColors = { ...item('outfitColor').colors, ...item('outfit').colors };
  const bikeColors = item('bikeColor').colors;
  const bare = Boolean(helmetItem.bare);
  const { hair, hairLight, hairShade, hairDark } = hairColors;
  parts = Object.freeze({
    key: lookKey(valid),
    art: LOOK_ART,
    look: Object.freeze(valid),
    palette: Object.freeze({
      ...FIXED_COLORS,
      ...skinColors,
      mouth: face.lips ? skinColors.lips : skinColors.mouth,
      ...hairColors,
      ...(bare ? NO_HELMET_COLORS : helmetColors),
      ...outfitColors,
    }),
    roles: Object.freeze({
      skin: { base: skinColors.skin, light: skinColors.skinLight, shade: skinColors.skinShade, mouth: face.lips ? skinColors.lips : skinColors.mouth },
      hair: { base: hair, light: hairLight, shade: hairShade, dark: hairDark },
      helmet: bare ? null : {
        shell: helmetColors.helmet, light: helmetColors.helmetLight, shade: helmetColors.helmetShade,
        stripe: helmetColors.stripe, visor: helmetColors.visor, visorLight: helmetColors.visorLight
      },
      outfit: {
        jersey: outfitColors.jacket, jerseyLight: outfitColors.jacketLight, jerseyShade: outfitColors.jacketShade,
        panel: outfitColors.panel, pants: outfitColors.trousers, pantsLight: outfitColors.trousersLight,
        gloves: outfitColors.gloves, boots: outfitColors.boots, sole: outfitColors.sole
      },
      bike: { ...bikeColors },
    }),
    shapes: Object.freeze({
      hair: hairStyleItem.shape, helmet: bare ? 'none' : helmetItem.shape, outfit: item('outfit').shape, bike: item('bike').shape
    }),
    face: Object.freeze({ ...face }),
    hair: Object.freeze({ ...hairStyleItem.style, strands: [hairShade, hairShade, hair], outline: hairDark, shine: hairLight }),
    helmet: !bare,
    bike: item('bike').model,
    bikeColors: Object.freeze({ ...bikeColors }),
  });
  partsCache.set(key, parts);
  if (partsCache.size > PARTS_CACHE_SIZE) partsCache.delete(partsCache.keys().next().value);
  return parts;
}
