import { STEP, MAX_POINT_SPEED, TAU, clamp } from './config.js';

export function createAudio(getSnapshot) {
  let audio = null;
  let enabled = true, volume = 1;

  function init() {
    if (audio) {
      if (audio.context.state === 'suspended') audio.context.resume();
      return;
    }
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const context = new AudioContext();
    const master = context.createGain();
    const compressor = context.createDynamicsCompressor();
    master.gain.value = masterLevel();
    master.connect(compressor); compressor.connect(context.destination);

    const engine = context.createOscillator();
    const engineFilter = context.createBiquadFilter();
    const engineGain = context.createGain();
    engine.type = 'sawtooth'; engine.frequency.value = 55;
    engineFilter.type = 'lowpass'; engineFilter.frequency.value = 260;
    engineGain.gain.value = 0;
    engine.connect(engineFilter); engineFilter.connect(engineGain); engineGain.connect(master); engine.start();

    const noiseBuffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);
    for (let i = 0; i < noiseData.length; i++) noiseData[i] = Math.random() * 2 - 1;
    const skid = context.createBufferSource();
    const skidFilter = context.createBiquadFilter();
    const skidGain = context.createGain();
    skid.buffer = noiseBuffer; skid.loop = true;
    skidFilter.type = 'bandpass'; skidFilter.frequency.value = 520; skidFilter.Q.value = .7;
    skidGain.gain.value = 0;
    skid.connect(skidFilter); skidFilter.connect(skidGain); skidGain.connect(master); skid.start();

    const rainBuffer = context.createBuffer(1, context.sampleRate * 4, context.sampleRate);
    const rainData = rainBuffer.getChannelData(0);
    let pink0 = 0, pink1 = 0, pink2 = 0, pink3 = 0, pink4 = 0, pink5 = 0, pink6 = 0;
    for (let index = 0; index < rainData.length; index++) {
      const white = Math.random() * 2 - 1;
      pink0 = .99886 * pink0 + white * .0555179;
      pink1 = .99332 * pink1 + white * .0750759;
      pink2 = .969 * pink2 + white * .153852;
      pink3 = .8665 * pink3 + white * .3104856;
      pink4 = .55 * pink4 + white * .5329522;
      pink5 = -.7616 * pink5 - white * .016898;
      rainData[index] = (pink0 + pink1 + pink2 + pink3 + pink4 + pink5 + pink6 + white * .5362) * .11;
      pink6 = white * .115926;
    }
    const rain = context.createBufferSource();
    const rainHighpass = context.createBiquadFilter();
    const rainLowpass = context.createBiquadFilter();
    const rainGain = context.createGain();
    rain.buffer = rainBuffer; rain.loop = true;
    rainHighpass.type = 'highpass'; rainHighpass.frequency.value = 320;
    rainLowpass.type = 'lowpass'; rainLowpass.frequency.value = 2400; rainLowpass.Q.value = .35;
    rainGain.gain.value = 0;
    rain.connect(rainHighpass); rainHighpass.connect(rainLowpass); rainLowpass.connect(rainGain); rainGain.connect(master); rain.start();
    // Wind: brown noise through a band that sweeps with the gusts.
    const windBuffer = context.createBuffer(1, context.sampleRate * 6, context.sampleRate);
    const windData = windBuffer.getChannelData(0);
    let brown = 0;
    for (let index = 0; index < windData.length; index++) {
      brown = (brown + (Math.random() * 2 - 1) * .02) / 1.02;
      windData[index] = brown * 3.2;
    }
    const wind = context.createBufferSource();
    const windFilter = context.createBiquadFilter();
    const windGain = context.createGain();
    wind.buffer = windBuffer; wind.loop = true;
    windFilter.type = 'bandpass'; windFilter.frequency.value = 400; windFilter.Q.value = .8;
    windGain.gain.value = 0;
    wind.connect(windFilter); windFilter.connect(windGain); windGain.connect(master); wind.start();
    // A long, dark echo for thunder rolling off the land.
    const echo = context.createConvolver();
    const echoLength = context.sampleRate * 3.5;
    const impulse = context.createBuffer(2, echoLength, context.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      let smooth = 0;
      for (let index = 0; index < echoLength; index++) {
        smooth = smooth * .85 + (Math.random() * 2 - 1) * .15;
        data[index] = smooth * (1 - index / echoLength) ** 3;
      }
    }
    echo.buffer = impulse;
    echo.connect(master);
    audio = {
      context, master, engine, engineFilter, engineGain, noiseBuffer, skidGain, rainGain,
      windFilter, windGain, brownBuffer: windBuffer, echo,
    };
  }

  function masterLevel() { return enabled ? .45 * volume * volume : 0; }

  function setEnabled(nextEnabled) {
    enabled = nextEnabled;
    if (audio) audio.master.gain.setTargetAtTime(masterLevel(), audio.context.currentTime, .015);
  }

  /** @param {number} level 0 … 1; squared so the slider feels even. */
  function setVolume(level) {
    volume = clamp(level, 0, 1);
    if (audio) audio.master.gain.setTargetAtTime(masterLevel(), audio.context.currentTime, .015);
  }

  function playTone(frequency, duration, type = 'square', volume = .08, delay = 0, endFrequency = frequency) {
    if (!audio || !enabled) return;
    const { context, master } = audio;
    const start = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), start + duration);
    gain.gain.setValueAtTime(.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + .012);
    gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
    oscillator.connect(gain); gain.connect(master);
    oscillator.start(start); oscillator.stop(start + duration + .02);
  }

  function playNoise(duration, volume = .1, cutoff = 900, delay = 0) {
    if (!audio || !enabled) return;
    const { context, master, noiseBuffer } = audio;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    const start = context.currentTime + delay;
    source.buffer = noiseBuffer;
    filter.type = 'lowpass'; filter.frequency.value = cutoff;
    gain.gain.setValueAtTime(.0001, context.currentTime);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
    source.connect(filter); filter.connect(gain); gain.connect(master);
    source.start(start); source.stop(start + duration);
  }

  function update() {
    if (!audio) return;
    const { state, rear, front, throttle, brakePressure, weather } = getSnapshot();
    const { context, engine, engineFilter, engineGain, skidGain, rainGain, windFilter, windGain } = audio;
    const speed = rear && front ? Math.abs(((rear.x - rear.ox) + (front.x - front.ox)) / (2 * STEP)) : 0;
    const running = state === 'running';
    const grounded = rear && front && (rear.grounded || front.grounded);
    // Revs climb with speed up to the bike's top speed. Holding the gas there
    // bounces the engine off its rev limiter, since it cannot go any faster.
    const revs = clamp(speed, 0, 340) * .32 + clamp(speed - 340, 0, MAX_POINT_SPEED - 340) * .2;
    const redline = running ? throttle * clamp((speed - MAX_POINT_SPEED * .95) / (MAX_POINT_SPEED * .05), 0, 1) : 0;
    const limiterCut = redline * (Math.sin(context.currentTime * TAU * 11) > 0 ? 1 : 0);
    const engineLevel = running ? (.018 + throttle * .065) * (1 - limiterCut * .45) : 0;
    const enginePitch = 48 + revs + throttle * 42 - limiterCut * 18;
    engine.frequency.setTargetAtTime(enginePitch, context.currentTime, .035);
    engineFilter.frequency.setTargetAtTime(180 + throttle * 360 + speed * .35, context.currentTime, .04);
    engineGain.gain.setTargetAtTime(engineLevel, context.currentTime, .045);
    const skidLevel = running && grounded && speed > 24 ? brakePressure * clamp(speed / 220, 0, 1) * .16 : 0;
    skidGain.gain.setTargetAtTime(skidLevel, context.currentTime, .025);
    const rainIntensity = clamp(Number(weather?.rain) || 0, 0, 1);
    const snow = clamp(Number(weather?.snow) || 0, 0, 1);
    const lightning = clamp(Number(weather?.lightning) || 0, 0, 1);
    const inPlay = state !== 'menu';
    const storm = (value) => clamp((value - .5) / .5, 0, 1) ** 1.3;
    const rainStorm = storm(rainIntensity);
    const rainLevel = inPlay && rainIntensity > 0
      ? (.012 + rainIntensity * .04 + rainStorm * .02) * (.94 + Math.sin(context.currentTime * .63) * .06)
      : 0;
    rainGain.gain.setTargetAtTime(rainLevel, context.currentTime, .35);
    // Wind comes with storms: a rainstorm, a blizzard (with a light breeze
    // in gentle snow), and some with lightning.
    const snowWind = Math.max(snow * .25, storm(snow));
    const windStrength = inPlay ? Math.min(1, Math.max(rainStorm, snowWind, lightning * .45)) : 0;
    const time = context.currentTime;
    // Slow, uneven gusts from sines that never line up.
    const gust = clamp(
      .55 + Math.sin(time * .23) * .25 + Math.sin(time * .61 + 1.3) * .15 + Math.sin(time * 1.7 + 2.1) * .07,
      0, 1,
    );
    // Snow wind whistles higher than the rainstorm's roar.
    const whistle = snowWind > rainStorm ? 1 : 0;
    windFilter.frequency.setTargetAtTime(
      (260 + whistle * 280) + gust * (300 + whistle * 500) * (.5 + windStrength * .5), time, .3,
    );
    windFilter.Q.setTargetAtTime(.7 + whistle * .9, time, .5);
    windGain.gain.setTargetAtTime(windStrength * (.03 + gust * .08), time, .4);
  }

  return {
    init,
    setEnabled,
    setVolume,
    update,
    splash(speed) {
      const volume = Math.min(.16, .05 + speed / 3000);
      playNoise(.28, volume, 1400);
      playNoise(.18, volume * .6, 3200, .04);
      playTone(240, .12, 'sine', volume * .25, 0, 90);
    },
    menuMove: () => playTone(420, .035, 'square', .018, 0, 470),
    menuSelect: () => playTone(520, .07, 'square', .035, 0, 680),
    menuBack: () => playTone(360, .08, 'triangle', .035, 0, 240),
    escape: () => playTone(300, .09, 'square', .04, 0, 190),
    menuConfirm() {
      playTone(440, .08, 'square', .045, 0, 660);
      playTone(660, .1, 'square', .035, .055, 880);
    },
    flip: () => playTone(180, .12, 'square', .035, 0, 260),
    headlight(on) {
      playNoise(.025, .05, 3200);
      if (on) playTone(520, .07, 'square', .03, .02, 1040);
      else playTone(700, .08, 'square', .025, .02, 300);
    },
    airTurn(fullRotation) {
      if (fullRotation) {
        playNoise(.16, .045, 1800);
        [440, 660, 880, 1320].forEach((note, index) => {
          playTone(note, .14, 'triangle', .065, index * .055, note * 1.18);
        });
        playTone(1760, .22, 'sine', .045, .2, 1320);
      } else {
        playNoise(.1, .035, 1150);
        playTone(230, .12, 'triangle', .035, 0, 340);
      }
    },
    land(impactSpeed) {
      const strength = clamp((impactSpeed - 45) / 180, 0, 1);
      playNoise(.07 + strength * .08, .025 + strength * .065, 420 + strength * 260);
      playTone(105 - strength * 22, .1 + strength * .08, 'triangle', .035 + strength * .055, 0, 62);
    },
    apple() {
      playTone(620, .1, 'square', .07, 0, 880);
      playTone(880, .13, 'square', .055, .07, 1240);
    },
    crash() {
      playNoise(.35, .18, 700);
      playTone(120, .32, 'sawtooth', .09, 0, 42);
    },
    /**
     * Thunder. The sound lags the flash by the strike's distance. A close
     * strike tears with a run of sharp snaps and a heavy bang; every strike
     * then rolls in uneven swells of deep noise that echo off the land, more
     * muffled and drawn-out the further away it is. No two sound the same.
     * @param {number} x where the flash was across the view, 0 … 1
     */
    thunder(intensity = .5, distance = .5, x = .5) {
      if (!audio || !enabled) return;
      const { context, master, noiseBuffer, brownBuffer, echo } = audio;
      const strength = clamp(intensity, 0, 1);
      const proximity = 1 - clamp(distance, 0, 1);
      const random = (low, high) => low + Math.random() * (high - low);
      const start = context.currentTime + .03 + distance ** 1.2 * 2.8;

      const out = context.createGain();
      const pan = context.createStereoPanner();
      const wet = context.createGain();
      pan.pan.value = clamp((x - .5) * 1.4, -.8, .8) * (.4 + proximity * .6);
      wet.gain.value = .35 + distance * .65;
      out.connect(pan); pan.connect(master); pan.connect(wet); wet.connect(echo);

      const burst = (buffer, at, duration, peak, filters, offset = 0) => {
        const source = context.createBufferSource();
        const gain = context.createGain();
        source.buffer = buffer;
        let node = source;
        for (const filter of filters) { node.connect(filter); node = filter; }
        node.connect(gain); gain.connect(out);
        gain.gain.setValueAtTime(.0001, at);
        gain.gain.exponentialRampToValueAtTime(peak, at + .003);
        gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
        source.start(at, offset); source.stop(at + duration + .02);
      };
      const filter = (type, frequency, q = .7) => {
        const node = context.createBiquadFilter();
        node.type = type; node.frequency.value = frequency; node.Q.value = q;
        return node;
      };

      if (proximity > .35) {
        // The tearing crack: a quick run of snaps, each a little lower.
        const snaps = 3 + Math.floor(Math.random() * (1 + proximity * 4));
        let at = start;
        for (let snap = 0; snap < snaps; snap++) {
          burst(
            noiseBuffer, at, random(.02, .06),
            (.08 + strength * .08) * proximity * (1 - snap / snaps * .5),
            [filter('highpass', random(900, 2600) * (1 - snap / snaps * .5))],
            Math.random() * .9,
          );
          at += random(.012, .05);
        }
        // Then the bang: broadband, closing down fast.
        const bang = context.createBufferSource();
        const bangFilter = filter('lowpass', 3200 * proximity + 400);
        const bangGain = context.createGain();
        bang.buffer = noiseBuffer;
        bangFilter.frequency.setValueAtTime(3200 * proximity + 400, at);
        bangFilter.frequency.exponentialRampToValueAtTime(160, at + .6);
        bangGain.gain.setValueAtTime(.0001, at);
        bangGain.gain.exponentialRampToValueAtTime((.12 + strength * .1) * proximity, at + .008);
        bangGain.gain.exponentialRampToValueAtTime(.0001, at + .7);
        bang.connect(bangFilter); bangFilter.connect(bangGain); bangGain.connect(out);
        bang.start(at, Math.random() * .3); bang.stop(at + .75);
        // A felt thump under it.
        const thump = context.createOscillator();
        const thumpGain = context.createGain();
        thump.frequency.setValueAtTime(52, at);
        thump.frequency.exponentialRampToValueAtTime(26, at + .8);
        thumpGain.gain.setValueAtTime(.0001, at);
        thumpGain.gain.exponentialRampToValueAtTime(.12 * proximity * (.6 + strength * .4), at + .02);
        thumpGain.gain.exponentialRampToValueAtTime(.0001, at + .9);
        thump.connect(thumpGain); thumpGain.connect(out);
        thump.start(at); thump.stop(at + 1);
      }

      // The roll: deep noise in uneven swells, fading and darkening.
      const duration = 3 + distance * 3.5 + strength * 1.5 + Math.random() * 1.5;
      const volume = (.09 + strength * .08) * (.45 + proximity * .55);
      const roll = context.createBufferSource();
      const rollHighpass = filter('highpass', 28);
      const rollLowpass = filter('lowpass', 900, .5);
      const rollGain = context.createGain();
      roll.buffer = brownBuffer; roll.loop = true;
      const bright = 160 + proximity * 900;
      rollLowpass.frequency.setValueAtTime(bright, start);
      rollLowpass.frequency.exponentialRampToValueAtTime(70 + proximity * 60, start + duration);
      rollGain.gain.setValueAtTime(.0001, start);
      let at = start + (proximity > .35 ? .05 : random(.15, .5) * (.5 + distance));
      rollGain.gain.exponentialRampToValueAtTime(.0001 + volume * .5, at);
      while (at < start + duration * .85) {
        const fade = 1 - (at - start) / duration;
        const rise = random(.12, .5);
        rollGain.gain.linearRampToValueAtTime(volume * random(.5, 1) * fade, at + rise);
        const fall = random(.2, .7);
        rollGain.gain.linearRampToValueAtTime(volume * random(.12, .4) * fade, at + rise + fall);
        at += rise + fall;
      }
      rollGain.gain.exponentialRampToValueAtTime(.0001, start + duration);
      roll.connect(rollHighpass); rollHighpass.connect(rollLowpass); rollLowpass.connect(rollGain); rollGain.connect(out);
      roll.start(start, Math.random() * 5); roll.stop(start + duration + .1);
    },
    win() {
      [523, 659, 784, 1047].forEach((note, index) => playTone(note, .18, 'square', .055, index * .1, note));
    }
  };
}
