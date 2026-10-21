// Opens the game and the editor in headless Chrome, served the way static
// hosting serves them, and fails on anything that reaches the console that
// nobody put there on purpose: a failed request (a file that only exists on
// the dev server, say), an uncaught exception, or a warning or error logged
// by the page or its service worker. In production the console should hold
// only the easter-egg hints.
//
//   node scripts/test-console.mjs
//
// Needs Chrome, at CHROME_PATH or where macOS or Linux installs it. Without
// it the test is skipped; CI has it.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { contentType } from './lib/mime-types.mjs';
import { repoRoot } from './lib/trails.mjs';

const PAGES = ['index.html', 'editor.html'];
// The API routes production has (netlify/functions); any other /api/ request
// would be a 404 there too.
const PRODUCTION_API = [/^\/api\/account\/[a-z-]+$/, /^\/api\/leaderboard$/];
const BOOT_TIMEOUT_MS = 20_000;
const TOTAL_TIMEOUT_MS = 120_000;

const chromePath = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].find(candidate => candidate && existsSync(candidate));

/** Static hosting: the repo's files as they are, and nothing else. */
function startStaticServer() {
  const server = http.createServer(async (request, response) => {
    const { pathname } = new URL(request.url, 'http://localhost');
    if (pathname.startsWith('/api/')) {
      // Production answers these from functions; an empty reply stands in.
      const status = PRODUCTION_API.some(route => route.test(pathname)) ? 204 : 404;
      response.writeHead(status, { 'Cache-Control': 'no-store' });
      return response.end();
    }
    let filePath = path.normalize(path.join(repoRoot, decodeURIComponent(pathname)));
    if (!filePath.startsWith(repoRoot)) { response.writeHead(403); return response.end(); }
    try {
      if ((await stat(filePath)).isDirectory()) filePath = path.join(filePath, 'index.html');
      const content = await readFile(filePath);
      response.writeHead(200, { 'Content-Type': contentType(filePath), 'Cache-Control': 'no-store' });
      response.end(content);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      response.writeHead(404, { 'Cache-Control': 'no-store' });
      response.end();
    }
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * A connection to Chrome's DevTools protocol, attached to every page and
 * worker it opens. `onAttached` names the domains to enable on each.
 */
async function launchChrome(chromePath, onAttached) {
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'hjulben-console-'));
  const flags = [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${userDataDir}`,
    '--no-first-run', '--no-default-browser-check', '--mute-audio', '--window-size=1200,800',
  ];
  if (process.getuid?.() === 0) flags.push('--no-sandbox');
  const chrome = spawn(chromePath, [...flags, 'about:blank'], { stdio: 'ignore' });
  // Chrome writes the port it picked here once it listens.
  const portFile = path.join(userDataDir, 'DevToolsActivePort');
  let endpoint = null;
  for (let i = 0; i < 100 && !endpoint; i++) {
    await sleep(100);
    try {
      const [port, wsPath] = (await readFile(portFile, 'utf8')).trim().split('\n');
      endpoint = `ws://127.0.0.1:${port}${wsPath}`;
    } catch (_) { /* not up yet */ }
  }
  if (!endpoint) throw new Error('Chrome did not start');
  const ws = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('Could not connect to Chrome')); });
  let nextId = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    } else if (message.method) {
      for (const listener of listeners) listener(message);
    }
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, message => (message.error ? reject(new Error(`${method}: ${message.error.message}`)) : resolve(message.result)));
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
  listeners.push(message => {
    if (message.method !== 'Target.attachedToTarget') return;
    const { sessionId, targetInfo } = message.params;
    for (const method of onAttached(sessionId, targetInfo)) send(method, {}, sessionId).catch(() => {});
  });
  // Pages and workers are attached as they appear. They are not held until
  // the listeners are on (waitForDebuggerOnStart): Chrome then stalls a
  // navigation served by the service worker. So a worker's first requests
  // may go unseen; its warnings and everything after are caught, and the
  // page's listeners are confirmed on before it is navigated (see open).
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  return {
    send,
    on: listener => listeners.push(listener),
    close() {
      ws.close();
      chrome.kill();
      rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}

if (!chromePath) {
  console.log('Console test skipped: Chrome not found (set CHROME_PATH).');
  process.exit(0);
}

const problems = [];
const server = await startStaticServer();
const base = `http://127.0.0.1:${server.address().port}/`;
const requests = new Map(); // requestId -> url, for failures reported without one
const sessions = new Map(); // sessionId -> 'page' | 'service worker', for the report
const sessionOf = new Map(); // targetId -> sessionId

const chrome = await launchChrome(chromePath, (sessionId, { type, targetId }) => {
  if (type !== 'page' && type !== 'service_worker') return [];
  sessions.set(sessionId, type === 'page' ? 'page' : 'service worker');
  sessionOf.set(targetId, sessionId);
  return ['Network.enable', 'Runtime.enable', 'Log.enable'];
});
const where = sessionId => sessions.get(sessionId) ?? 'page';
const describe = args => args.map(arg => arg.value ?? arg.description ?? arg.type).join(' ');
chrome.on(({ method, params, sessionId }) => {
  if (method === 'Network.requestWillBeSent') requests.set(params.requestId, params.request.url);
  else if (method === 'Network.responseReceived' && params.response.status >= 400) {
    problems.push(`${where(sessionId)}: ${params.response.status} ${new URL(params.response.url).pathname}`);
  } else if (method === 'Network.loadingFailed' && !params.canceled) {
    problems.push(`${where(sessionId)}: request failed (${params.errorText}) ${requests.get(params.requestId) ?? ''}`);
  } else if (method === 'Runtime.exceptionThrown') {
    const { exception, text } = params.exceptionDetails;
    problems.push(`${where(sessionId)}: uncaught ${exception?.description ?? text}`);
  } else if (method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'assert'].includes(params.type)) {
    problems.push(`${where(sessionId)}: console.${params.type} ${describe(params.args)}`);
  } else if (method === 'Log.entryAdded' && ['error', 'warning'].includes(params.entry.level) && params.entry.source !== 'network') {
    problems.push(`${where(sessionId)}: ${params.entry.level} ${params.entry.text}`);
  }
});

const timer = setTimeout(() => { console.error('Console test timed out.'); chrome.close(); process.exit(1); }, TOTAL_TIMEOUT_MS);

// The pages are driven in a tab of their own, kept active: only the active
// tab gets animation frames, and the game finishes booting on one.
const { targetId } = await chrome.send('Target.createTarget', { url: 'about:blank' });
await chrome.send('Target.activateTarget', { targetId });
let page = null;
for (let i = 0; i < 50 && !page; i++) {
  await sleep(100);
  page = sessionOf.get(targetId);
}
if (!page) throw new Error('Chrome did not open the page');
// Enabling twice is harmless; awaiting it means nothing the page does is missed.
await Promise.all(['Network.enable', 'Runtime.enable', 'Log.enable'].map(method => chrome.send(method, {}, page)));

const evaluate = async expression => (await chrome.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, page)).result.value;

/** Resolves once the page has drawn its first screen (both pages clear `data-booting` then). */
async function booted(label) {
  const started = Date.now();
  while (Date.now() - started < BOOT_TIMEOUT_MS) {
    if (await evaluate(`document.readyState === 'complete' && !document.querySelector('[data-booting]')`).catch(() => false)) return;
    await sleep(100);
  }
  problems.push(`${label}: did not finish booting within ${BOOT_TIMEOUT_MS / 1000} s`);
}

async function open(file, label) {
  await chrome.send('Page.navigate', { url: base + file }, page);
  await booted(label);
}

await open(PAGES[0], PAGES[0]);
// The service worker installs on the first visit: wait for it, then load
// again so the page is served from its cache like a return visit.
await evaluate(`navigator.serviceWorker.ready.then(() => new Promise(resolve => setTimeout(resolve, 2000)))`).catch(() => {});
await open(PAGES[0], `${PAGES[0]} (cached)`);
for (const file of PAGES.slice(1)) await open(file, file);
// A moment for anything still in flight to land.
await sleep(1000);

clearTimeout(timer);
chrome.close();
server.close();

if (problems.length) {
  console.error('Console test failed. The game or editor logged what production should never show:');
  for (const problem of [...new Set(problems)]) console.error('  ' + problem);
  process.exit(1);
}
console.log(`Console test passed: ${PAGES.join(' and ')} load from static hosting without a failed request, exception or warning.`);
