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
    audio = { context, master, engine, engineFilter, engineGain, noiseBuffer, skidGain };
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

  function playNoise(duration, volume = .1, cutoff = 900) {
    if (!audio || !enabled) return;
    const { context, master, noiseBuffer } = audio;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = noiseBuffer;
    filter.type = 'lowpass'; filter.frequency.value = cutoff;
    gain.gain.setValueAtTime(volume, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + duration);
    source.connect(filter); filter.connect(gain); gain.connect(master);
    source.start(); source.stop(context.currentTime + duration);
  }

  function update() {
    if (!audio) return;
    const { state, rear, front, throttle, brakePressure } = getSnapshot();
    const { context, engine, engineFilter, engineGain, skidGain } = audio;
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
  }

  return {
    init,
    setEnabled,
    update,
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
    win() {
      [523, 659, 784, 1047].forEach((note, index) => playTone(note, .18, 'square', .055, index * .1, note));
    }
  };
}
