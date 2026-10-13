// Easter eggs for riders who open their dev tools: a cheat menu in the
// browser console that cheats nothing, and Wolfenstein 3D's LIM code. Each one only
// reports itself, so game.js can hand out its achievement (see
// achievements.js); none of them touch the simulation.

const LIM = ['KeyL', 'KeyI', 'KeyM'];

/**
 * Follows the keys held down and says when L, I and M are all held at once,
 * Wolfenstein 3D's cheat for full health, ammo and keys.
 */
export function createLimWatcher() {
  const held = new Set();
  return {
    /** A key went down; true when it completes the code. */
    down(code) {
      if (held.has(code)) return false;
      held.add(code);
      return LIM.includes(code) && LIM.every(key => held.has(key));
    },
    up(code) { held.delete(code); },
    /** Forgets every key, as when the window loses focus. */
    clear() { held.clear(); },
  };
}

const CHEATS = Object.freeze(['godMode', 'moonGravity', 'infiniteApples', 'noClip', 'goldMedals']);

/**
 * Puts `hjulben` in the browser console with a list of cheats, none of which
 * work, and says hello there.
 * @param {(name: string) => void} onCheat called with each cheat asked for
 */
export function installConsoleCheats(onCheat) {
  globalThis.hjulben = Object.freeze({
    cheats: CHEATS,
    cheat(name = '') {
      onCheat(String(name));
      console.info('[Hjulben] Nice try. The server rides every world time again from its inputs, so cheats don’t travel. But we did write that down.');
      return '🏍️  ¯\\_(ツ)_/¯';
    }
  });
  console.info('%cHjulben%c\nLooking for cheats? Try hjulben.cheat(\'godMode\').',
    'font: bold 16px monospace; color: #e8b04a', 'font: 12px monospace');
}
