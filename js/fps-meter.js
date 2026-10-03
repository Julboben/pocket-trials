// A small frame-rate readout for `?fps=1`: frames per second, the average
// time each frame's work took, and the slowest gap between frames, refreshed
// twice a second.
const REFRESH_MS = 500;

/** @param {Element} parent */
export function createFpsMeter(parent) {
  const label = document.createElement('div');
  label.className = 'fps-meter';
  label.setAttribute('aria-hidden', 'true');
  label.textContent = '-- FPS';
  parent.append(label);
  let since = 0, frames = 0, work = 0, worst = 0, last = 0, started = 0;
  return {
    frame(now) {
      started = performance.now();
      if (last) worst = Math.max(worst, now - last);
      last = now;
      if (!since) since = now;
    },
    drawn(now) {
      frames++;
      work += performance.now() - started;
      const elapsed = now - since;
      if (elapsed < REFRESH_MS) return;
      label.textContent = `${Math.round(frames * 1000 / elapsed)} FPS · ${(work / frames).toFixed(1)} ms · max ${Math.round(worst)} ms`;
      since = now; frames = 0; work = 0; worst = 0;
    }
  };
}
