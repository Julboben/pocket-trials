// Rider looks: the catalog, legacy riders, how looks are cleaned, gender and
// skin staying fixed after creation, saves migrating from 'male'/'female', and
// riding without a helmet.
import assert from 'node:assert/strict';
import {
  LOOK_SLOTS, IDENTITY_SLOTS, LOOK_PARTS, SLOT_LABELS, LOOK_ITEMS, DEFAULT_LOOK, STARTER_LOOKS, lookItem, itemsForSlot,
  isDefaultItem, starterLook, legacyLook, legacyRider, normalizeLook, keepIdentity, lookOf, isCompleteLook, lookKey,
  sameLook, isColorless, partName, randomLook, lookParts
} from '../js/cosmetics.js';
import { BIKE_MODELS } from '../js/drawing.js';
import { createRagdoll } from '../js/ragdoll.js';

let seed = 7;
const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

// --- Catalog ---------------------------------------------------------------------

{
  const ids = new Set();
  for (const item of LOOK_ITEMS) {
    assert.ok(LOOK_SLOTS.includes(item.slot), `${item.id} is in a known slot`);
    assert.match(item.id, /^[a-z0-9-]+$/, `${item.slot}:${item.id} is a plain id`);
    assert.ok(!ids.has(item.slot + ':' + item.id), `${item.slot}:${item.id} is listed once`);
    ids.add(item.slot + ':' + item.id);
    assert.ok(item.name, `${item.id} has a name`);
    assert.ok(Object.isFrozen(item), `${item.id} is frozen`);
    // Rewards will add more unlock types; for now every item is everyone's.
    assert.equal(item.unlock.type, 'default', `${item.id} is a default item`);
    assert.equal(lookItem(item.slot, item.id), item);
  }
  for (const slot of LOOK_SLOTS) {
    assert.ok(itemsForSlot(slot).length >= 2, `${slot} has a choice`);
    assert.ok(SLOT_LABELS[slot], `${slot} has a label`);
    for (const look of Object.values(STARTER_LOOKS)) assert.ok(isDefaultItem(slot, look[slot]), `the starter ${slot} is everyone's`);
  }
  // Every tab is a style plus its colour, and together with identity they cover every slot.
  const covered = new Set(IDENTITY_SLOTS);
  for (const part of LOOK_PARTS) {
    assert.ok(LOOK_SLOTS.includes(part.style) && LOOK_SLOTS.includes(part.color), `${part.id} is made of slots`);
    covered.add(part.style).add(part.color);
  }
  assert.deepEqual([...covered].sort(), [...LOOK_SLOTS].sort());
  for (const slot of [...LOOK_PARTS.map(part => part.color), 'skin']) {
    for (const item of itemsForSlot(slot)) assert.equal(item.chip?.length, 2, `${slot}:${item.id} has a colour chip`);
  }
  assert.ok(lookItem('helmet', 'none')?.colorless, 'riding without a helmet is an option, with no colour');
  assert.ok(lookItem('hair', 'bald')?.colorless);
  assert.equal(lookItem('gender', 'female').face.lash, true);
  for (const item of itemsForSlot('bike')) assert.ok(BIKE_MODELS.includes(item.model), `bike ${item.id} has a model`);
  assert.equal(lookItem('helmet', 'missing'), null);

  // Every colour key the rider and bike art read is set for every item.
  const base = lookParts(DEFAULT_LOOK);
  const keys = Object.keys(base.palette), bikeKeys = Object.keys(base.bikeColors);
  for (const slot of LOOK_SLOTS) {
    for (const item of itemsForSlot(slot)) {
      for (const gender of ['male', 'female']) {
        const parts = lookParts({ ...starterLook(gender), [slot]: item.id });
        for (const key of keys) assert.match(parts.palette[key], /^#[0-9a-f]{6}$/i, `${slot}:${item.id} sets ${key}`);
        for (const key of bikeKeys) assert.match(parts.bikeColors[key], /^#[0-9a-f]{6}$/i, `${slot}:${item.id} sets bike ${key}`);
        assert.equal(parts.hair.strands.length, 3);
        assert.equal(parts.art, 'pocket');
      }
    }
  }
}

// --- Legacy riders ---------------------------------------------------------------

{
  // The palettes from before looks existed: the legacy looks must draw the
  // same riders.
  const OLD = {
    male: {
      jacket: '#e8e5d9', jacketLight: '#fff8e7', jacketShade: '#b5bcae', panel: '#29464e', trousers: '#29464e',
      trousersLight: '#42616a', helmet: '#f4a442', helmetLight: '#ffd078', helmetShade: '#bd7034', stripe: '#fff8e7',
      skin: '#bd7954', skinLight: '#dfa078', gloves: '#304a42', boots: '#263b36', sole: '#657a70', visor: '#234844',
      visorLight: '#83bcb6', skinShade: '#9a5c40', hair: '#3d2a24', hairLight: '#5e4334', hairShade: '#2e1d19',
      eye: '#263b36', mouth: '#87483a',
    },
    female: {
      jacket: '#d86f82', jacketLight: '#ef9aa8', jacketShade: '#a94f69', panel: '#59415c', trousers: '#39435d',
      trousersLight: '#596681', helmet: '#63aa98', helmetLight: '#a8dfcf', helmetShade: '#3c786e', stripe: '#fff8e7',
      skin: '#bd7954', skinLight: '#dfa078', gloves: '#59415c', boots: '#2b3347', sole: '#7c8897', visor: '#234844',
      visorLight: '#b0dfd4', skinShade: '#9a5c40', hair: '#684438', hairLight: '#8c5d48', hairShade: '#54362d',
      eye: '#263b36', mouth: '#b0505e',
    },
  };
  for (const rider of ['male', 'female']) {
    const parts = lookParts(legacyLook(rider));
    for (const [key, color] of Object.entries(OLD[rider])) assert.equal(parts.palette[key], color, `${rider} ${key}`);
    assert.equal(legacyLook(rider).gender, rider);
    assert.equal(legacyRider(legacyLook(rider)), rider);
    assert.equal(parts.helmet, true);
    assert.equal(parts.bike, 'elasto');
  }
  assert.deepEqual(lookParts(legacyLook('female')).hair.strands, ['#54362d', '#54362d', '#684438'], 'the old ponytail');
  assert.equal(lookParts(legacyLook('male')).hair.ponytail, false);
  assert.deepEqual(legacyLook('robot'), legacyLook('male'));
  // Gender is who the rider is, not what they wear.
  assert.equal(legacyRider({ ...STARTER_LOOKS.male, hair: 'ponytail' }), 'male');
  assert.equal(legacyRider({ ...STARTER_LOOKS.female, hair: 'buzz' }), 'female');
}

// --- Starter looks and identity --------------------------------------------------

{
  assert.equal(DEFAULT_LOOK.skin, 'light', 'riders start light skinned');
  assert.deepEqual(DEFAULT_LOOK, STARTER_LOOKS.male);
  assert.deepEqual(starterLook('female', 'deep'), { ...STARTER_LOOKS.female, skin: 'deep' });
  assert.deepEqual(starterLook('robot', 'green'), DEFAULT_LOOK);
  assert.notDeepEqual(STARTER_LOOKS.female.hair, STARTER_LOOKS.male.hair, 'starter looks follow gender');
  assert.equal(lookParts(STARTER_LOOKS.female).face.lips, true);
  assert.equal(lookParts(STARTER_LOOKS.male).face.lips, false);
  assert.equal(lookParts(starterLook('female', 'brown')).palette.mouth, lookItem('skin', 'brown').colors.lips);

  const current = starterLook('female', 'deep');
  const next = keepIdentity({ ...STARTER_LOOKS.male, skin: 'fair', hair: 'bob' }, current);
  assert.equal(next.gender, 'female');
  assert.equal(next.skin, 'deep');
  assert.equal(next.hair, 'bob', 'everything else can change');

  // Random riders keep gender and skin, may pick anything else, and lean
  // towards the rider's gender without being limited to it.
  const female = starterLook('female', 'tan');
  const counts = { ponytail: 0, short: 0 };
  for (let index = 0; index < 400; index++) {
    const look = randomLook(female, { random });
    assert.ok(isCompleteLook(look));
    assert.equal(look.gender, 'female');
    assert.equal(look.skin, 'tan');
    if (look.hair in counts) counts[look.hair]++;
  }
  assert.ok(counts.ponytail > counts.short && counts.short > 0, `random hair leans female: ${JSON.stringify(counts)}`);
  const owns = (slot, id) => !(slot === 'outfitColor' && id === 'yellow');
  for (let index = 0; index < 50; index++) assert.notEqual(randomLook(female, { random, owns }).outfitColor, 'yellow');
}

// --- Cleaning looks --------------------------------------------------------------

{
  const look = {
    gender: 'female', skin: 'deep', hair: 'bob', hairColor: 'blonde', helmet: 'none', helmetColor: 'teal',
    outfit: 'denim', outfitColor: 'yellow', bike: 'classic', bikeColor: 'blue'
  };
  assert.deepEqual(normalizeLook(look), look);
  assert.ok(isCompleteLook(look));
  assert.ok(!isCompleteLook({ ...look, bike: 'rocket' }));
  assert.deepEqual(normalizeLook(null), DEFAULT_LOOK);
  assert.deepEqual(normalizeLook('tan'), DEFAULT_LOOK);
  assert.deepEqual(normalizeLook({ ...look, helmet: 'crown', bike: 5 }), { ...look, helmet: DEFAULT_LOOK.helmet, bike: DEFAULT_LOOK.bike }, 'bad items fall back per slot');
  assert.deepEqual(normalizeLook({ skin: 'fair' }, { fallback: legacyLook('female') }), { ...legacyLook('female'), skin: 'fair' });
  // Slots never borrow ids from each other.
  assert.equal(normalizeLook({ ...look, hairColor: 'teal' }).hairColor, DEFAULT_LOOK.hairColor);
  // Items the rider doesn't own are refused, which is how won items will be guarded.
  const owns = (slot, id) => !(slot === 'outfit' && id === 'denim');
  assert.equal(normalizeLook(look, { owns }).outfit, DEFAULT_LOOK.outfit);
  assert.ok(!Object.hasOwn(normalizeLook({ ...look, extra: 1 }), 'extra'));

  assert.deepEqual(lookOf({ rider: 'female' }), legacyLook('female'), 'old records keep their rider');
  assert.deepEqual(lookOf({ rider: 'female', look }), look, 'a look wins over the old rider');
  assert.deepEqual(lookOf({}), legacyLook('male'));

  assert.equal(lookKey(look), 'female.deep.bob.blonde.none.teal.denim.yellow.classic.blue');
  assert.ok(sameLook(look, { ...look }));
  assert.ok(!sameLook(look, DEFAULT_LOOK));
  assert.equal(lookParts(look), lookParts({ ...look }), 'equal looks share their parts');
  assert.equal(lookParts(look).helmet, false);
  assert.equal(lookParts(look).bike, lookItem('bike', 'classic').model);
  assert.deepEqual(lookParts(look).bikeColors, lookItem('bikeColor', 'blue').colors);

  const helmetPart = LOOK_PARTS.find(part => part.style === 'helmet');
  const hairPart = LOOK_PARTS.find(part => part.style === 'hair');
  assert.ok(isColorless(look, helmetPart));
  assert.ok(!isColorless(look, hairPart));
  assert.equal(partName(look, helmetPart), lookItem('helmet', 'none').name);
  assert.equal(partName(STARTER_LOOKS.female, hairPart), 'Auburn ponytail');
}

// --- Saves -----------------------------------------------------------------------

{
  const items = new Map();
  globalThis.localStorage = /** @type {any} */ ({
    getItem: key => items.get(key) ?? null,
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: key => items.delete(key),
  });
  const playerId = '0a1b2c3d-1111-4222-8333-444455556666';
  items.set('hjulben-saves-v2', JSON.stringify([
    { rider: 'female', createdAt: 1, trail: 0, unlocked: 0, bestTimes: {}, name: 'OLDIE', playerId },
    { rider: 'robot', createdAt: 2, trail: 0, unlocked: 0, bestTimes: {}, name: 'BROKEN', playerId },
    { look: { skin: 'deep', helmet: 'none' }, createdAt: 3, trail: 0, unlocked: 0, bestTimes: {}, name: 'NEWER', playerId },
  ]));
  const storage = await import('../js/storage.js');
  const [old, broken, newer] = storage.loadSaveSlots(9);
  assert.deepEqual(old.look, legacyLook('female'), 'old saves get their rider as a look');
  assert.equal(old.rider, 'female');
  assert.equal(broken, null, 'saves with neither a look nor a rider are dropped');
  assert.deepEqual(newer.look, { ...DEFAULT_LOOK, skin: 'deep', helmet: 'none' });

  const look = { ...starterLook('male', 'fair'), hair: 'buzz', hairColor: 'red', helmet: 'none', outfit: 'denim', bike: 'classic', bikeColor: 'black' };
  const created = storage.createSave(1, look, 9, 'NEWBIE');
  assert.deepEqual(created.look, look);
  assert.equal(created.rider, 'male');

  const restyled = { ...look, hair: 'ponytail', outfitColor: 'pink' };
  const saved = storage.saveLook(1, 9, restyled);
  assert.deepEqual(saved.look, restyled);
  assert.equal(saved.rider, 'male', 'a ponytail does not change who the rider is');
  assert.deepEqual(storage.saveLook(1, 9, { ...restyled, gender: 'female', skin: 'deep' }).look, restyled, 'gender and skin are fixed');
  assert.deepEqual(storage.saveLook(1, 9, { ...restyled, helmet: 'crown' }).look, restyled, 'a bad item keeps the current one');
  assert.deepEqual(JSON.parse(items.get('hjulben-saves-v2'))[1].look, restyled, 'looks are written to storage');
  saved.look.hair = 'bald';
  assert.equal(storage.loadSaveSlots(9)[1].look.hair, 'ponytail', 'loaded saves are copies');

  const oldRestyled = storage.saveLook(0, 9, { ...STARTER_LOOKS.male, hair: 'bob' });
  assert.equal(oldRestyled.look.gender, 'female', 'old riders keep their gender');
  assert.equal(oldRestyled.look.skin, 'tan', 'and their skin');
  assert.equal(oldRestyled.look.hair, 'bob');
}

// --- No helmet -------------------------------------------------------------------

{
  const wheel = (x, y) => ({ x, y, ox: x - 2, oy: y, compression: 0 });
  const counted = () => {
    let calls = 0, seed = 3;
    const random = () => { calls++; return ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646; };
    return { random, calls: () => calls };
  };
  const helmeted = counted(), bare = counted();
  const withHelmet = createRagdoll(wheel(0, 0), wheel(50, 0), 1, helmeted.random);
  const without = createRagdoll(wheel(0, 0), wheel(50, 0), 1, bare.random, { helmet: false });
  assert.equal(bare.calls(), helmeted.calls(), 'the same random numbers are drawn either way');
  assert.equal(without.helmetStrap, Infinity, 'there is no helmet to knock off');
  assert.ok(Number.isFinite(withHelmet.helmetStrap));
  assert.ok(without.points.head.radius < withHelmet.points.head.radius, 'a bare head is smaller');
  for (const name of Object.keys(withHelmet.points)) {
    if (name === 'head') continue;
    assert.deepEqual(without.points[name], withHelmet.points[name], `${name} is thrown the same`);
  }
}

console.log('Cosmetics tests passed.');
