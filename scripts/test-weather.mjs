// Weather: the settings and their defaults, the presets, and the wind that
// props, rain, snow and the wind's sound all share. Every trail file spells
// out all of its weather.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeTrail, validateTrail } from '../js/trail-schema.js';
import {
  WEATHER_DEFAULTS, WEATHER_KEYS, WEATHER_LEVELS, WEATHER_PRESETS, WIND_DIRECTIONS,
  rainSlant, resolveWeather, snowDrift, windSign,
} from '../js/weather.js';

// Left out, unreadable or out of range, a setting falls back or is clamped;
// unknown settings are dropped.
{
  assert.deepEqual(resolveWeather(), { ...WEATHER_DEFAULTS });
  assert.deepEqual(resolveWeather(null), { ...WEATHER_DEFAULTS });
  const weather = resolveWeather({ rain: 2, snow: -1, fog: 'thick', wind: 0.7, windDirection: 'up', thunder: 1 });
  assert.equal(weather.rain, 1);
  assert.equal(weather.snow, 0);
  assert.equal(weather.fog, WEATHER_DEFAULTS.fog);
  assert.equal(weather.wind, 0.7);
  assert.equal(weather.windDirection, 'left');
  assert.ok(!('thunder' in weather));
  assert.deepEqual(Object.keys(weather).sort(), [...WEATHER_KEYS].sort());
  assert.equal(resolveWeather({ windDirection: 'right' }).windDirection, 'right');
  assert.equal(windSign(resolveWeather({ windDirection: 'right' })), 1);
  assert.equal(windSign(resolveWeather()), -1);
}

// A loaded trail has every setting, and a bad direction is an error.
{
  const trail = normalizeTrail({ name: 'test', weather: { rain: 0.4, thunder: 0.8 } });
  assert.deepEqual(Object.keys(trail.weather).sort(), [...WEATHER_KEYS].sort());
  assert.equal(trail.weather.rain, 0.4);
  trail.weather.windDirection = 'up';
  assert.ok(validateTrail(trail).some((m) => m.type === 'error' && /windDirection/.test(m.text)));
}

// Rain falls straight down in a calm, slants more as the wind gets up, and
// is driven nearly flat in a gale; snow, being lighter, flatter still.
{
  const degrees = (drift) => (Math.atan(drift) * 180) / Math.PI;
  assert.equal(rainSlant(0), 0);
  assert.equal(snowDrift(0), 0);
  for (let wind = 0.1; wind <= 1; wind += 0.1) {
    assert.ok(rainSlant(wind) > rainSlant(wind - 0.1), `rain slants more at ${wind}`);
    assert.ok(snowDrift(wind) > rainSlant(wind), `snow drifts more than rain at ${wind}`);
  }
  assert.ok(degrees(rainSlant(0.25)) < 15, 'a breeze barely tilts the rain');
  assert.ok(degrees(rainSlant(1)) > 70 && degrees(snowDrift(1)) > 75, 'a gale lays them nearly flat');
}

// Each preset sets every level, within 0…1, and leaves the direction alone.
{
  const ids = new Set();
  for (const preset of WEATHER_PRESETS) {
    assert.ok(!ids.has(preset.id), `${preset.id} is unique`);
    ids.add(preset.id);
    assert.deepEqual(Object.keys(preset.weather).sort(), [...WEATHER_LEVELS].sort(), preset.id);
    for (const value of Object.values(preset.weather)) assert.ok(value >= 0 && value <= 1, preset.id);
  }
}

// Every trail file spells out all of its weather, and nothing else.
{
  const root = join(import.meta.dirname, '..', 'trails');
  let count = 0;
  for (const folder of ['official', 'bonus', 'custom']) {
    for (const file of readdirSync(join(root, folder)).filter((name) => name.endsWith('.json'))) {
      const { weather } = JSON.parse(readFileSync(join(root, folder, file), 'utf8'));
      assert.deepEqual(Object.keys(weather || {}).sort(), [...WEATHER_KEYS].sort(), `${folder}/${file}`);
      assert.deepEqual(resolveWeather(weather), weather, `${folder}/${file} is in range`);
      count++;
    }
  }
  assert.ok(count > 30);
}

console.log('Weather tests passed.');
