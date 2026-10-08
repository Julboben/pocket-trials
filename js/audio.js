import { STEP, MAX_POINT_SPEED, RADIUS, TAU, clamp } from './config.js';

/** Overall gearing per gear: engine revs (0 idle … 1 redline) per unit of speed. */
const GEAR_RATIOS = [3.2, 2.3, 1.75, 1.35, 1];
const UPSHIFT_REVS = .9, DOWNSHIFT_REVS = .42;
/** Highest revs (0 … 1) the engine reaches with the driven wheel off the ground. */
const FREE_REV_CEILING = .86;

/**
 * One cycle of exhaust pressure: a sharp spike as the port opens, the
 * suction dip behind it, and a small reflection back from the pipe.
 */
function exhaustPulseWave(context) {
  const harmonics = 40, samples = 2048;
  const real = new Float32Array(harmonics), imag = new Float32Array(harmonics);
  const bump = (t, at, width) => Math.exp(-(((t - at) / width) ** 2));
  for (let index = 0; index < samples; index++) {
    const t = index / samples;
    const pressure = bump(t, .05, .045) - .55 * bump(t, .22, .1) + .1 * bump(t, .48, .08);
    for (let n = 1; n < harmonics; n++) {
      real[n] += pressure * Math.cos(TAU * n * t) * 2 / samples;
      imag[n] += pressure * Math.sin(TAU * n * t) * 2 / samples;
    }
  }
  return context.createPeriodicWave(real, imag);
}

function shaperCurve(shape, points = 1024) {
  const curve = new Float32Array(points);
  for (let index = 0; index < points; index++) curve[index] = shape(index / (points - 1) * 2 - 1);
  return curve;
}

export function createAudio(getSnapshot) {
  let audio = null;
  let enabled = true, volume = 1;
  const motor = { gear: 0, revs: 0, time: 0, shiftCutUntil: 0, liftedAt: -1, lastThrottle: 0, nextPop: 0, grip: 0, phase: 'off', startedAt: -10, stalledAt: 0 };

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

    const noiseBuffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);
    for (let i = 0; i < noiseData.length; i++) noiseData[i] = Math.random() * 2 - 1;

    // Engine: a single-cylinder two-stroke. Each firing is an exhaust pulse,
    // lightly saturated, shaped by a resonant expansion chamber and a muffler
    // and roughened by combustion noise that bursts with each pulse.
    const engine = context.createOscillator();
    engine.setPeriodicWave(exhaustPulseWave(context));
    engine.frequency.value = 30;
    const engineDrive = context.createGain();
    const engineShaper = context.createWaveShaper();
    engineShaper.curve = shaperCurve((x) => Math.tanh(x));
    engineShaper.oversample = '2x';
    const engineHighpass = context.createBiquadFilter();
    engineHighpass.type = 'highpass'; engineHighpass.frequency.value = 38;
    const engineFilter = context.createBiquadFilter();
    engineFilter.type = 'lowpass'; engineFilter.frequency.value = 400; engineFilter.Q.value = .7;
    const enginePipe = context.createBiquadFilter();
    enginePipe.type = 'peaking'; enginePipe.frequency.value = 360; enginePipe.Q.value = 1.2; enginePipe.gain.value = 1;
    const engineMuffler = context.createBiquadFilter();
    engineMuffler.type = 'lowpass'; engineMuffler.frequency.value = 1600; engineMuffler.Q.value = .5;
    const engineWobble = context.createGain();
    const engineGain = context.createGain();
    engineGain.gain.value = 0;
    engine.connect(engineDrive); engineDrive.connect(engineShaper); engineShaper.connect(engineHighpass);
    engineHighpass.connect(engineFilter); engineFilter.connect(enginePipe); enginePipe.connect(engineWobble);
    engineWobble.connect(engineMuffler); engineMuffler.connect(engineGain); engineGain.connect(master);

    const rasp = context.createBufferSource();
    const raspFilter = context.createBiquadFilter();
    const raspPulse = context.createGain();
    const raspLevel = context.createGain();
    const pulseEnvelope = context.createWaveShaper();
    pulseEnvelope.curve = shaperCurve((x) => (x > 0 ? x * x : 0));
    rasp.buffer = noiseBuffer; rasp.loop = true;
    raspFilter.type = 'lowpass'; raspFilter.frequency.value = 600; raspFilter.Q.value = .5;
    raspPulse.gain.value = 0;
    raspLevel.gain.value = 1;
    engine.connect(pulseEnvelope); pulseEnvelope.connect(raspPulse.gain);
    rasp.connect(raspFilter); raspFilter.connect(raspPulse); raspPulse.connect(raspLevel); raspLevel.connect(engineWobble);

    // No two firings are quite alike: slow random drift in timing and
    // strength, strongest at idle where the engine lopes.
    const driftBuffer = context.createBuffer(1, context.sampleRate * 5, context.sampleRate);
    const driftData = driftBuffer.getChannelData(0);
    for (let i = 0; i < driftData.length; i++) driftData[i] = Math.random() * 2 - 1;
    const drift = context.createBufferSource();
    drift.buffer = driftBuffer; drift.loop = true;
    const pitchDriftFilter = context.createBiquadFilter();
    pitchDriftFilter.type = 'lowpass'; pitchDriftFilter.frequency.value = 8;
    const pitchDrift = context.createGain();
    pitchDrift.gain.value = 900;
    const levelDriftFilter = context.createBiquadFilter();
    levelDriftFilter.type = 'lowpass'; levelDriftFilter.frequency.value = 6;
    const levelDrift = context.createGain();
    levelDrift.gain.value = 4;
    drift.connect(pitchDriftFilter); pitchDriftFilter.connect(pitchDrift); pitchDrift.connect(engine.detune);
    drift.connect(levelDriftFilter); levelDriftFilter.connect(levelDrift); levelDrift.connect(engineWobble.gain);
    engine.start(); rasp.start(); drift.start();
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
      context, master, engine, engineDrive, engineFilter, enginePipe, engineGain, raspFilter, raspLevel,
      pitchDrift, levelDrift, noiseBuffer, skidGain, rainGain,
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

  function backfire(strength) {
    playNoise(.04 + Math.random() * .03, (.025 + Math.random() * .025) * strength, 500 + Math.random() * 600);
    playTone(70 + Math.random() * 40, .06, 'triangle', .03 * strength, 0, 40);
  }

  function kickStart() {
    playTone(48, .12, 'triangle', .06, 0, 30);
    playNoise(.06, .03, 500);
  }

  /**
   * The engine runs while riding and after the finish. A new run kicks it
   * into life with a couple of blips; a crash stalls it.
   * @param {{ angularVelocity?: number, grounded?: boolean } | undefined} drivenWheel
   * @param {boolean} fresh the run has not begun moving yet
   */
  function updateEngine(state, drivenWheel, gas, fresh) {
    const { context, engine, engineDrive, engineFilter, enginePipe, engineGain, raspFilter, raspLevel, pitchDrift, levelDrift } = audio;
    const time = context.currentTime;
    const dt = clamp(time - motor.time, 0, .1);
    motor.time = time;
    const on = (state === 'running' || state === 'won') && drivenWheel;
    if (on && motor.phase !== 'on') {
      if (fresh) kickStart();
      Object.assign(motor, { phase: 'on', startedAt: fresh ? time : -10, gear: 0, revs: 0, grip: 0, lastThrottle: 0, liftedAt: -1 });
    } else if (state === 'ragdoll' && motor.phase === 'on') {
      Object.assign(motor, { phase: 'stalling', stalledAt: time });
    } else if (state === 'menu') motor.phase = 'off';
    const stall = motor.phase === 'stalling' ? clamp((time - motor.stalledAt) / .8, 0, 1) : 0;
    if (stall >= 1) motor.phase = 'off';
    if (!(on || motor.phase === 'stalling') || !drivenWheel || state === 'paused') {
      engineGain.gain.setTargetAtTime(0, time, .045);
      return;
    }
    // After the kick it catches with a sharp blip, settles and blips again.
    const sinceStart = time - motor.startedAt;
    const bump = (at, width) => Math.exp(-(((sinceStart - at) / width) ** 2));
    const startRevs = sinceStart < 1.4 ? .5 * bump(.33, .09) + .22 * bump(.95, .07) : 0;
    const caught = clamp((sinceStart - .2) / .05, 0, 1);
    // The engine answers the twist of the grip at once; the physics' throttle
    // eases in to keep traction soft, which would make the engine sluggish.
    motor.grip += ((gas && !stall ? 1 : 0) - motor.grip) * (1 - Math.exp(-dt * (gas ? 22 : 14)));
    const throttle = motor.grip;
    // The engine is geared to the driven wheel, so it follows that wheel's
    // spin: wheelspin, a wheel spun up in the air and a wheel hanging free
    // all rev it, whatever the other wheel is doing.
    const wheelSpeed = Math.abs((drivenWheel.angularVelocity || 0) * RADIUS);
    const free = !drivenWheel.grounded;
    const wheelRevs = () => wheelSpeed / MAX_POINT_SPEED * GEAR_RATIOS[motor.gear];
    // The gearbox shifts up near the top of each gear on the gas, and back
    // down as the bike slows; the rider only shifts with the wheel on the ground.
    if (!free && time - motor.shiftCutUntil > .2) {
      if (motor.gear < GEAR_RATIOS.length - 1 && throttle > .3 && wheelRevs() > UPSHIFT_REVS) {
        motor.gear++;
        motor.shiftCutUntil = time + .07;
      } else if (motor.gear > 0 && wheelRevs() < DOWNSHIFT_REVS) {
        motor.gear--;
        motor.shiftCutUntil = time;
      }
    }
    // With the wheel loaded the clutch only lets the revs flare a little above
    // the wheel. With nothing to push against the engine spins up on its own,
    // slowed by the wheel's weight, and a rider eases off short of the top
    // rather than holding it flat out. Off the gas the rider coasts on the
    // clutch and the engine settles to idle.
    const engaged = clamp(throttle * 4, 0, 1);
    const flare = free ? FREE_REV_CEILING : motor.gear === 0 ? .55 : .25;
    const wheel = free ? Math.min(wheelRevs(), FREE_REV_CEILING) : wheelRevs();
    const target = clamp(Math.max(wheel * engaged, throttle * flare, startRevs), 0, 1) * (1 - stall);
    const rise = free ? 3.5 + throttle * 2 : 5 + throttle * 8;
    motor.revs += (target - motor.revs) * (1 - Math.exp(-dt * (target > motor.revs ? rise : 9)));
    const revs = motor.revs;

    // Holding top speed on the ground taps the rev limiter now and then. In
    // the air the engine is unloaded: it screams thinner instead of barking.
    const redline = free ? 0 : throttle * clamp((revs - .95) / .05, 0, 1);
    const limiterCut = redline * (Math.sin(time * TAU * 9) > .7 ? .35 : 0);
    const cut = Math.max(time < motor.shiftCutUntil ? 1 : 0, limiterCut);
    const load = Math.max(throttle * (free ? .6 : 1), clamp(startRevs * 1.6, 0, 1)) * (1 - cut);

    // Snapping the gas shut from high revs crackles and pops in the pipe.
    const easing = throttle < motor.lastThrottle;
    if (easing && throttle < .7 && motor.lastThrottle >= .7 && revs > .45) {
      motor.liftedAt = time;
      motor.nextPop = time + .04 + Math.random() * .08;
    }
    if (easing && time - motor.liftedAt < .9 && time >= motor.nextPop) {
      if (Math.random() < .7) backfire(clamp(revs * 1.3, .4, 1));
      motor.nextPop = time + .05 + Math.random() * .17;
    }
    motor.lastThrottle = throttle;

    // The expansion chamber is tuned to the top of the rev range: there the
    // engine comes on the pipe and screams.
    const powerband = clamp(1 - Math.abs(revs - .8) / .32, 0, 1);
    // A stalling engine sputters down below idle before it dies.
    engine.frequency.setTargetAtTime((30 + revs * 153) * (1 - stall * .55), time, .03);
    pitchDrift.gain.setTargetAtTime(900 * (1.2 - revs) * (1 - load * .4) * (1 + stall * 2), time, .1);
    levelDrift.gain.setTargetAtTime(4 * (1.1 - revs * .8), time, .1);
    engineDrive.gain.setTargetAtTime(.8 + load * .9, time, .03);
    // At idle the filter stays open enough that small speakers, which cannot
    // play the deep firing note, still carry its upper harmonics.
    engineFilter.frequency.setTargetAtTime(650 + load * (300 + revs * 650) + revs * 100, time, .04);
    enginePipe.frequency.setTargetAtTime(280 + revs * 420, time, .05);
    enginePipe.gain.setTargetAtTime(1 + powerband * load * 5, time, .05);
    raspFilter.frequency.setTargetAtTime(450 + load * revs * 650, time, .05);
    raspLevel.gain.setTargetAtTime(.5 + load * .9, time, .05);
    const level = .06 + load * (.02 + revs * .025 + powerband * .01) + revs * .006;
    engineGain.gain.setTargetAtTime(level * (1 - cut * .6) * caught * (1 - stall) ** 1.5, time, cut ? .012 : .03);
  }

  function update() {
    if (!audio) return;
    const { state, rear, front, facing, gas, started, brakePressure, weather } = getSnapshot();
    const { context, skidGain, rainGain, windFilter, windGain } = audio;
    const speed = rear && front ? Math.abs(((rear.x - rear.ox) + (front.x - front.ox)) / (2 * STEP)) : 0;
    const running = state === 'running';
    const grounded = rear && front && (rear.grounded || front.grounded);
    updateEngine(state, facing < 0 ? front : rear, Boolean(gas), !started);
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
    shatter(speed) {
      const volume = Math.min(.16, .07 + speed / 4000);
      playNoise(.2, volume, 6500);
      playNoise(.4, volume * .45, 4200, .05);
      [2637, 3520, 2349, 3136, 2794].forEach((note, index) => {
        playTone(note, .08, 'triangle', volume * .3, .03 + index * .04, note * .94);
      });
    },
    crack(speed) {
      const volume = Math.min(.1, .04 + speed / 6000);
      playNoise(.05, volume, 5200);
      playTone(1975, .05, 'square', volume * .35, 0, 1480);
      playTone(2960, .04, 'triangle', volume * .25, .03, 2490);
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
