// The time of day: a trail's hour round a full day, the keyframes the hours
// between blend, and the looks of the sky and the light they give. Exactly on
// the classic times (morning, noon, evening and night) a trail looks as it
// always has.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DAY_KEYFRAMES, DEFAULT_HOUR, HOURS, TIME_MARKS, clockTime, dayBlend, hourName, isNight, normalizeHour,
} from '../js/time-of-day.js';
import { hourPalette, timeOfDayPalette } from '../js/drawing.js';
import { ambientFor } from '../js/lighting.js';
import { normalizeTrail, validateTrail } from '../js/trail-schema.js';

// An hour is a whole hour round the clock; anything unreadable is noon.
{
  assert.equal(normalizeHour(7), 7);
  assert.equal(normalizeHour(18.6), 19);
  assert.equal(normalizeHour(24), 0);
  assert.equal(normalizeHour(-1), 23);
  for (const bad of [undefined, null, '', 'evening', NaN, {}]) assert.equal(normalizeHour(bad), DEFAULT_HOUR);
  assert.equal(clockTime(7), '07:00');
  assert.equal(normalizeTrail({ name: 'test' }).timeOfDay, 12);
  assert.equal(normalizeTrail({ name: 'test', timeOfDay: 'night' }).timeOfDay, 12);
  const trail = normalizeTrail({ name: 'test', timeOfDay: 19 });
  assert.equal(trail.timeOfDay, 19);
  trail.timeOfDay = 7.5;
  assert.ok(validateTrail(trail).some((m) => m.type === 'error' && /time of day/.test(m.text)));
}

// The help points are the classic times, and night runs from 21:00 to 5:00.
{
  assert.deepEqual(TIME_MARKS.map(({ id, hour }) => [id, hour]), [['morning', 7], ['noon', 12], ['evening', 19], ['night', 0]]);
  for (let hour = 0; hour < HOURS; hour++) assert.equal(isNight(hour), hour >= 21 || hour < 5, `night at ${hour}`);
  assert.equal(hourName(0), 'Night');
  assert.equal(hourName(6), 'Dawn');
  assert.equal(hourName(7), 'Morning');
  assert.equal(hourName(12), 'Noon');
  assert.equal(hourName(19), 'Evening');
  assert.equal(hourName(20), 'Dusk');
}

// On a keyframe an hour is that look; between two it blends; night wraps
// round midnight.
{
  for (const [hour, look] of DAY_KEYFRAMES) {
    const blend = dayBlend(hour);
    assert.ok(blend.from === look && blend.t === 0, `${look} at ${hour}`);
  }
  assert.deepEqual(dayBlend(0), { from: 'night', to: 'night', t: 0 });
  assert.deepEqual(dayBlend(23), { from: 'night', to: 'night', t: 0 });
  assert.deepEqual(dayBlend(5), { from: 'night', to: 'dawn', t: 0.5 });
  assert.deepEqual(dayBlend(21), { from: 'dusk', to: 'night', t: 0.5 });
  assert.equal(dayBlend(14).from, 'noon');
  assert.equal(dayBlend(14).t, 0, 'noon holds through the afternoon');
  const { from, to, t } = dayBlend(8);
  assert.ok(from === 'morning' && to === 'noon' && t > 0 && t < 1);
}

// The classic times look exactly as their old presets: what they were before
// the day cycle, so trails keep their look.
{
  const at = (timeOfDay) => timeOfDayPalette({ timeOfDay });
  assert.equal(at(12).skyTop, '#dde5e0');
  assert.equal(at(12).tint, null);
  assert.equal(at(7).sky, '#f3e2cf');
  assert.equal(at(7).sunDrop, 55);
  assert.equal(at(19).sun, '#ee8a52');
  assert.equal(at(19).glow, true);
  assert.equal(at(0).sky, '#2b3a5c');
  assert.equal(at(0).moon, 1);
  assert.equal(at(0), at(23), 'night holds until 4');
  assert.deepEqual(ambientFor({ timeOfDay: 7, weather: {} }).sky, [255, 243, 230]);
  assert.deepEqual(ambientFor({ timeOfDay: 12, weather: {} }).sky, [255, 255, 255]);
  assert.deepEqual(ambientFor({ timeOfDay: 19, weather: {} }).sky, [244, 210, 188]);
  assert.deepEqual(ambientFor({ timeOfDay: 0, weather: {} }).sky, [122, 136, 192]);
}

// Every hour is a whole look: real colours, and light that falls into night
// and rises again through the day.
{
  const hex = /^#[0-9a-f]{6}$/;
  for (let hour = 0; hour < HOURS; hour++) {
    const palette = hourPalette(hour);
    for (const key of ['sky', 'skyTop', 'sun', 'far', 'near', 'tree', 'trunk', 'cloud', 'stormCloud'])
      assert.match(palette[key], hex, `${key} at ${hour}`);
    assert.ok(palette.tint === null || hex.test(palette.tint), `tint at ${hour}`);
    for (const key of ['light', 'moon', 'stars', 'shadeAmount'])
      assert.ok(palette[key] >= 0 && palette[key] <= 1.5, `${key} at ${hour}`);
    const ambient = ambientFor({ timeOfDay: hour, weather: {} });
    assert.ok(ambient.sky.every((value) => Number.isInteger(value) && value >= 0 && value <= 255), `ambient at ${hour}`);
  }
  const light = (hour) => hourPalette(hour).light;
  assert.ok(light(0) < light(5) && light(5) < light(6) && light(6) < light(7) && light(7) < light(12), 'it gets lighter through the morning');
  assert.ok(light(12) > light(19) && light(19) > light(20) && light(20) > light(21) && light(21) > light(22), 'and darker through the evening');
  assert.ok(hourPalette(21).moon > 0 && hourPalette(21).moon < 1, 'the moon rises after dusk');
  assert.ok(hourPalette(6).stars > 0 && hourPalette(7).stars === 0, 'the last stars go out at dawn');
  assert.ok(!hourPalette(8).glow && hourPalette(18).glow && hourPalette(6).glow, 'lights are on from dusk until after dawn');
}

// Every trail file has its hour.
{
  const root = join(import.meta.dirname, '..', 'trails');
  for (const folder of ['official', 'bonus', 'custom']) {
    for (const file of readdirSync(join(root, folder)).filter((name) => name.endsWith('.json'))) {
      const { timeOfDay } = JSON.parse(readFileSync(join(root, folder, file), 'utf8'));
      assert.ok(Number.isInteger(timeOfDay) && timeOfDay >= 0 && timeOfDay < HOURS, `${folder}/${file}: ${timeOfDay}`);
    }
  }
}

console.log('Time of day tests passed.');
