// @ts-check
// Keyboard (remappable), on-screen buttons and gamepads, mapped to game actions.
import { clamp } from './config.js';
import { DEFAULT_BINDINGS } from './state.js';

/** Actions that matter while held. */
export const HOLD_ACTIONS = ['up', 'down', 'back', 'forward'];
/** Actions that fire once per press. */
export const PRESS_ACTIONS = ['flip', 'lights', 'restart', 'pause', 'fullscreen', 'interact'];

export const ACTION_LABELS = {
  up: 'Gas', down: 'Brake', back: 'Lean left', forward: 'Lean right',
  flip: 'Turn around', lights: 'Headlight', restart: 'Restart', pause: 'Pause', fullscreen: 'Fullscreen',
  interact: 'Interact'
};

// Codes a player cannot bind: Escape always opens the menu, Tab moves focus.
const RESERVED = new Set(['Escape', 'Tab']);

const KEY_SYMBOLS = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: 'SPACE', Enter: 'ENTER', ShiftLeft: 'L-SHIFT', ShiftRight: 'R-SHIFT', ControlLeft: 'L-CTRL', ControlRight: 'R-CTRL', AltLeft: 'L-ALT', AltRight: 'R-ALT', Backspace: 'BKSP' };

export function keyLabel(code) {
  if (KEY_SYMBOLS[code]) return KEY_SYMBOLS[code];
  return code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'NUM ').toUpperCase();
}

// Standard gamepad layout (https://w3c.github.io/gamepad/#remapping).
const PAD = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, select: 8, start: 9, up: 12, down: 13, left: 14, right: 15 };
const STICK_DEADZONE = .25;

/**
 * `buttons` press their `data-action`. `indicators` handle their own clicks
 * but still look pressed while their `data-shows` action is held.
 * @param {{
 *   element: HTMLElement,
 *   buttons: HTMLElement[],
 *   indicators?: HTMLElement[],
 *   isActive: () => boolean,
 *   onPress: (action: string, source: 'key' | 'pointer' | 'pad') => void,
 * }} options
 */
export function createInput({ element, buttons, indicators = [], isActive, onPress }) {
  const keys = new Set();
  const pointers = new Map();
  const pad = {
    held: new Set(), lean: 0, previous: /** @type {boolean[]} */ ([]), connected: false, stickX: 0, stickY: 0,
    // Which pad was read, and whether it is what the player is using: a key or
    // a touch hands over to that, so a pad lying idle never rumbles.
    index: -1, inUse: false,
  };
  /** @type {Record<string, string[]>} */
  let bindings = DEFAULT_BINDINGS;
  /** @type {Map<string, string>} */
  let codeActions = new Map();
  /** @type {((code: string | null) => void) | null} */
  let capture = null;

  function setBindings(next) {
    bindings = next;
    codeActions = new Map();
    for (const [action, codes] of Object.entries(bindings)) for (const code of codes) codeActions.set(code, action);
  }
  setBindings(DEFAULT_BINDINGS);

  function held(action) {
    for (const code of keys) if (codeActions.get(code) === action) return true;
    for (const value of pointers.values()) if (value === action) return true;
    return pad.held.has(action);
  }

  /** Lean in screen direction: −1 left … 1 right. */
  function leanInput() {
    const digital = Number(held('forward')) - Number(held('back'));
    return digital || pad.lean;
  }

  function clear() {
    keys.clear();
    pointers.clear();
    paint();
  }

  function paint() {
    for (const button of buttons) button.classList.toggle('held', held(button.dataset.action || ''));
    for (const button of indicators) button.classList.toggle('held', held(button.dataset.shows || ''));
  }

  /** Routes the next key press to `callback` (used by key remapping). */
  function captureNextKey(callback) { capture = callback; }

  /** @returns {boolean} whether the event was a game action */
  function keyDown(event) {
    if (capture) {
      event.preventDefault();
      const done = capture;
      capture = null;
      done(event.code === 'Escape' || RESERVED.has(event.code) ? null : event.code);
      return true;
    }
    const action = codeActions.get(event.code);
    if (!action) return false;
    pad.inUse = false;
    event.preventDefault();
    if (PRESS_ACTIONS.includes(action)) {
      if (!event.repeat) onPress(action, 'key');
      keys.add(event.code);
      paint();
      return true;
    }
    if (!isActive()) return true;
    keys.add(event.code);
    paint();
    return true;
  }

  function keyUp(event) {
    if (keys.delete(event.code)) paint();
  }

  for (const button of buttons) {
    button.addEventListener('pointerdown', event => {
      if (!isActive()) return;
      event.preventDefault();
      pad.inUse = false;
      element.focus({ preventScroll: true });
      const action = button.dataset.action || '';
      if (PRESS_ACTIONS.includes(action)) { onPress(action, 'pointer'); return; }
      button.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, action);
      paint();
    });
    const release = event => { pointers.delete(event.pointerId); paint(); };
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
    button.addEventListener('contextmenu', event => event.preventDefault());
    // Safari's magnifier and double-tap zoom come with the touch, not the
    // pointer, so a quick double tap on a held control turns them off here.
    // The pointer events above still fire; these buttons need no click.
    button.addEventListener('touchstart', event => event.preventDefault(), { passive: false });
  }

  /** Reads the first gamepad; call once per animation frame. */
  function pollGamepad() {
    const gamepad = typeof navigator.getGamepads === 'function'
      ? [...navigator.getGamepads()].find(candidate => candidate?.connected) : null;
    pad.held.clear();
    pad.lean = 0;
    pad.connected = Boolean(gamepad);
    if (!gamepad) { pad.previous = []; pad.index = -1; pad.inUse = false; return; }
    pad.index = gamepad.index;
    const pressed = gamepad.buttons.map(button => button.pressed || button.value > .5);
    if (pressed.some(Boolean) || gamepad.axes.some(axis => Math.abs(axis) > STICK_DEADZONE)) pad.inUse = true;
    // Compared with the last frame's buttons, kept before they're replaced.
    const previous = pad.previous;
    const edge = index => pressed[index] && !previous[index];
    pad.previous = pressed;
    const active = isActive();
    if (active) {
      if (pressed[PAD.rt] || pressed[PAD.a]) pad.held.add('up');
      if (pressed[PAD.lt] || pressed[PAD.x]) pad.held.add('down');
      if (pressed[PAD.left]) pad.held.add('back');
      if (pressed[PAD.right]) pad.held.add('forward');
      const stick = gamepad.axes[0] || 0;
      if (Math.abs(stick) > STICK_DEADZONE) pad.lean = clamp((stick - Math.sign(stick) * STICK_DEADZONE) / (1 - STICK_DEADZONE), -1, 1);
    }
    if (pressed[PAD.y]) pad.held.add('restart');
    if (edge(PAD.b)) onPress(active ? 'flip' : 'cancel', 'pad');
    if (active && edge(PAD.up)) onPress('lights', 'pad');
    if (active && edge(PAD.down)) onPress('interact', 'pad');
    if (edge(PAD.y)) onPress('restart', 'pad');
    if (edge(PAD.start)) onPress('pause', 'pad');
    if (edge(PAD.select)) onPress('menu', 'pad');
    if (!active) {
      if (edge(PAD.a)) onPress('confirm', 'pad');
      // The bumpers do nothing on the bike; in menus they switch tabs.
      if (edge(PAD.lb)) onPress('tab-prev', 'pad');
      if (edge(PAD.rb)) onPress('tab-next', 'pad');
      const direction = value => Math.abs(value) > .6 ? Math.sign(value) : 0;
      const stickX = direction(gamepad.axes[0] || 0), stickY = direction(gamepad.axes[1] || 0);
      const movedX = stickX !== pad.stickX ? stickX : 0, movedY = stickY !== pad.stickY ? stickY : 0;
      if (edge(PAD.up) || movedY < 0) onPress('nav-up', 'pad');
      if (edge(PAD.down) || movedY > 0) onPress('nav-down', 'pad');
      if (edge(PAD.left) || movedX < 0) onPress('nav-left', 'pad');
      if (edge(PAD.right) || movedX > 0) onPress('nav-right', 'pad');
      pad.stickX = stickX; pad.stickY = stickY;
    } else {
      pad.stickX = 0; pad.stickY = 0;
    }
    paint();
  }

  return {
    held, leanInput, clear, paint, keyDown, keyUp, pollGamepad, setBindings, captureNextKey,
    get gamepadConnected() { return pad.connected; },
    /** The gamepad being played with, fresh from the browser, or null when keys or touch took over. */
    activeGamepad() {
      if (!pad.inUse || pad.index < 0 || typeof navigator.getGamepads !== 'function') return null;
      return navigator.getGamepads()[pad.index] ?? null;
    },
    get capturing() { return capture !== null; }
  };
}
