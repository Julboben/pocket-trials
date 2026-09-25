import { startGame } from './game.js';

startGame();

// Offline play once installed. The worker is network-first, so a deploy or a
// dev-server edit shows up on the next load while online.
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
