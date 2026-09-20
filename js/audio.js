import { STEP, clamp } from './config.js';

export function createAudio(getSnapshot) {
  let audio = null;
  let enabled = true;

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
    master.gain.value = enabled ? .45 : 0;
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
    audio = { context, master, engine, engineFilter, engineGain, noiseBuffer, skidGain, rainGain };
  }

  function setEnabled(nextEnabled) {
    enabled = nextEnabled;
    if (audio) audio.master.gain.setTargetAtTime(enabled ? .45 : 0, audio.context.currentTime, .015);
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
    const { context, engine, engineFilter, engineGain, skidGain, rainGain } = audio;
    const speed = rear && front ? Math.abs(((rear.x - rear.ox) + (front.x - front.ox)) / (2 * STEP)) : 0;
    const running = state === 'running';
    const grounded = rear && front && (rear.grounded || front.grounded);
    const engineLevel = running ? .018 + throttle * .065 : 0;
    const enginePitch = 48 + clamp(speed, 0, 340) * .32 + throttle * 42;
    engine.frequency.setTargetAtTime(enginePitch, context.currentTime, .035);
    engineFilter.frequency.setTargetAtTime(180 + throttle * 360 + speed * .35, context.currentTime, .04);
    engineGain.gain.setTargetAtTime(engineLevel, context.currentTime, .045);
    const skidLevel = running && grounded && speed > 24 ? brakePressure * clamp(speed / 220, 0, 1) * .16 : 0;
    skidGain.gain.setTargetAtTime(skidLevel, context.currentTime, .025);
    const rainIntensity = clamp(Number(weather?.rain) || 0, 0, 1);
    const weatherAudible = state !== 'menu' && rainIntensity > 0;
    const rainLevel = weatherAudible
      ? (.012 + rainIntensity * .04) * (.94 + Math.sin(context.currentTime * .63) * .06)
      : 0;
    rainGain.gain.setTargetAtTime(rainLevel, context.currentTime, .35);
  }

  return {
    init,
    setEnabled,
    update,
    menuMove: () => playTone(420, .035, 'square', .018, 0, 470),
    menuSelect: () => playTone(520, .07, 'square', .035, 0, 680),
    menuBack: () => playTone(360, .08, 'triangle', .035, 0, 240),
    escape: () => playTone(300, .09, 'square', .04, 0, 190),
    menuConfirm() {
      playTone(440, .08, 'square', .045, 0, 660);
      playTone(660, .1, 'square', .035, .055, 880);
    },
    flip: () => playTone(180, .12, 'square', .035, 0, 260),
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
    thunder(intensity = .5, distance = .5) {
      if (!audio || !enabled) return;
      const { context, master, noiseBuffer } = audio;
      const strength = clamp(intensity, 0, 1);
      const proximity = 1 - clamp(distance, 0, 1);
      const delay = .025 + distance * 1.65;
      const start = context.currentTime + delay;

      // The body is a long, low rolling noise with several uneven swells.
      const rumble = context.createBufferSource();
      const rumbleHighpass = context.createBiquadFilter();
      const rumbleLowpass = context.createBiquadFilter();
      const rumbleGain = context.createGain();
      const rumbleDuration = 1.65 + distance * 2.35 + strength * .35;
      const rumbleVolume = (.055 + strength * .075) * (.38 + proximity * .62);
      rumble.buffer = noiseBuffer; rumble.loop = true;
      rumbleHighpass.type = 'highpass'; rumbleHighpass.frequency.value = 24;
      rumbleLowpass.type = 'lowpass';
      rumbleLowpass.frequency.setValueAtTime(240 + proximity * 760, start);
      rumbleLowpass.frequency.exponentialRampToValueAtTime(110 + proximity * 180, start + rumbleDuration);
      rumbleGain.gain.setValueAtTime(.0001, start);
      rumbleGain.gain.exponentialRampToValueAtTime(rumbleVolume, start + .045 + distance * .08);
      rumbleGain.gain.exponentialRampToValueAtTime(Math.max(.0002, rumbleVolume * .32), start + rumbleDuration * .36);
      rumbleGain.gain.exponentialRampToValueAtTime(Math.max(.0002, rumbleVolume * .58), start + rumbleDuration * .53);
      rumbleGain.gain.exponentialRampToValueAtTime(Math.max(.0002, rumbleVolume * .2), start + rumbleDuration * .72);
      rumbleGain.gain.exponentialRampToValueAtTime(.0001, start + rumbleDuration);
      rumble.connect(rumbleHighpass); rumbleHighpass.connect(rumbleLowpass); rumbleLowpass.connect(rumbleGain); rumbleGain.connect(master);
      rumble.start(start); rumble.stop(start + rumbleDuration + .05);

      // A low pressure wave gives both near and distant thunder physical weight.
      const boom = context.createOscillator();
      const boomGain = context.createGain();
      boom.type = 'sine';
      boom.frequency.setValueAtTime(58 - proximity * 14, start);
      boom.frequency.exponentialRampToValueAtTime(24, start + .7 + distance * .55);
      boomGain.gain.setValueAtTime(.0001, start);
      boomGain.gain.exponentialRampToValueAtTime(rumbleVolume * (.55 + proximity * .3), start + .025);
      boomGain.gain.exponentialRampToValueAtTime(.0001, start + .75 + distance * .6);
      boom.connect(boomGain); boomGain.connect(master);
      boom.start(start); boom.stop(start + 1.4);

      // Close strikes add the missing instantaneous electrical crack and snap.
      if (proximity > .42) {
        const crack = context.createBufferSource();
        const crackHighpass = context.createBiquadFilter();
        const crackGain = context.createGain();
        const crackDuration = .055 + proximity * .075;
        crack.buffer = noiseBuffer;
        crackHighpass.type = 'highpass';
        crackHighpass.frequency.value = 850 + proximity * 1350;
        crackGain.gain.setValueAtTime(.0001, start);
        crackGain.gain.exponentialRampToValueAtTime((.07 + strength * .11) * proximity, start + .004);
        crackGain.gain.exponentialRampToValueAtTime(.0001, start + crackDuration);
        crack.connect(crackHighpass); crackHighpass.connect(crackGain); crackGain.connect(master);
        crack.start(start); crack.stop(start + crackDuration + .02);
        playTone(145 - proximity * 55, .16, 'sawtooth', .035 + proximity * .05, delay, 38);
      }
    },
    win() {
      [523, 659, 784, 1047].forEach((note, index) => playTone(note, .18, 'square', .055, index * .1, note));
    }
  };
}
