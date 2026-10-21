// The local dev server (scripts/dev.mjs) marks every file it serves with
// this header, so the game can tell it from static hosting without asking
// for anything that only exists locally. The value says whether the page may
// save trail files through the server's API.
export const DEV_SERVER_HEADER = 'X-Hjulben-Dev-Server';
/** The page is on localhost, where the trail API accepts writes. */
export const DEV_SERVER_WRITABLE = 'writable';
/** The page is on another device on the network, which the trail API refuses. */
export const DEV_SERVER_READ_ONLY = 'read-only';
