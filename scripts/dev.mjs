import http from 'node:http';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RIDE_VERSION, simulateRun } from '../js/ride.js';
import { decodeInputs } from '../js/replay-codec.js';
import { validRows } from '../netlify/lib/verify-run.mjs';
import { generateTrailCatalog } from './generate-trail-catalog.mjs';
import { loadCatalogTrails } from './lib/trails.mjs';
import './watch-trails.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const trailsRoot = path.join(projectRoot, 'trails');
const humanRunsRoot = path.join(projectRoot, 'tests', 'replays', 'human');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT) || 8080;
const TRAIL_FILE = /^(official|bonus|custom)\/([a-z0-9][a-z0-9_-]*)\.json$/i;
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg'
};

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 2_000_000) throw new Error('Trail file is too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function handleTrailRequest(request, response, file) {
  const match = TRAIL_FILE.exec(file);
  if (!match) return sendJson(response, 400, { error: 'Trail files must be official/<name>.json, bonus/<name>.json or custom/<name>.json using letters, numbers, - and _.' });
  const [, source, name] = match;
  const target = path.join(trailsRoot, source, `${name}.json`);
  const entry = { id: `${source}:${name}`, source, file: `${source}/${name}.json` };

  if (request.method === 'PUT') {
    let trail;
    try { trail = JSON.parse(await readBody(request)); } catch (error) { return sendJson(response, 400, { error: `Invalid trail JSON: ${error.message}` }); }
    if (!trail || typeof trail.name !== 'string' || !trail.name.trim()) return sendJson(response, 400, { error: 'The trail needs a name.' });
    await writeFile(target, `${JSON.stringify(trail, null, 2)}\n`);
    await generateTrailCatalog();
    console.log(`Saved trails/${entry.file}`);
    return sendJson(response, 200, { entry: { ...entry, name: trail.name } });
  }
  if (request.method === 'DELETE') {
    if (source !== 'custom') return sendJson(response, 403, { error: 'Official and bonus trails cannot be deleted from the editor.' });
    await unlink(target).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await generateTrailCatalog();
    console.log(`Deleted trails/${entry.file}`);
    return sendJson(response, 200, { entry });
  }
  return sendJson(response, 405, { error: 'Use PUT to save or DELETE to remove a trail.' });
}

// Saves a finished run as the replay bot's reference for the official trail
// it finishes (see scripts/record-replays.mjs). The run says nothing about
// which trail it was, as a play test doesn't know its file, so it's replayed
// against every saved official trail. A play test of unsaved edits finishes
// none of them.
async function handleReferenceRun(request, response) {
  if (request.method !== 'POST') return sendJson(response, 405, { error: 'Use POST to save a reference run.' });
  let run;
  try { run = JSON.parse(await readBody(request)); } catch (error) { return sendJson(response, 400, { error: `Invalid run JSON: ${error.message}` }); }
  // Checked before decoding: a run's counts can ask for far more steps than its size suggests.
  if (!validRows(run?.inputs)) return sendJson(response, 400, { error: 'The run\'s inputs are malformed or longer than ten minutes.' });
  if (run.physics !== RIDE_VERSION) return sendJson(response, 409, { error: 'The run was ridden with older physics. Reload the game and ride it again.' });
  const inputs = decodeInputs(run.inputs);
  const seed = Number.isFinite(run.seed) ? run.seed : 1;
  const entry = loadCatalogTrails('official').find(candidate => simulateRun(candidate.trail, inputs, { seed }).ride.status === 'won');
  if (!entry) return sendJson(response, 422, { error: 'The run doesn\'t finish any saved official trail. Save the trail first.' });
  const file = entry.file.split('/').pop();
  const target = path.join(humanRunsRoot, file);
  const previous = await readFile(target, 'utf8').then(text => JSON.parse(text).time ?? null, () => undefined);
  const { ride } = simulateRun(entry.trail, inputs, { seed });
  const saved = { trail: entry.id, time: ride.elapsed, seed, startStep: run.startStep ?? 0, physics: RIDE_VERSION, savedAt: new Date().toISOString(), inputs: run.inputs };
  await mkdir(humanRunsRoot, { recursive: true });
  await writeFile(target, `${JSON.stringify(saved)}\n`);
  console.log(`Saved tests/replays/human/${file} (${entry.trail.name}, ${ride.elapsed.toFixed(2)}s)`);
  return sendJson(response, 200, { trail: entry.id, name: entry.trail.name, time: ride.elapsed, replaced: previous !== undefined, previousTime: previous ?? null });
}

async function serveStatic(request, response, pathname) {
  let filePath = path.normalize(path.join(projectRoot, decodeURIComponent(pathname)));
  const relative = path.relative(projectRoot, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative) || relative.split(path.sep).some(part => part.startsWith('.') && part.length > 1)) {
    response.writeHead(403); return response.end('Forbidden');
  }
  try {
    if ((await stat(filePath)).isDirectory()) filePath = path.join(filePath, 'index.html');
    const content = await readFile(filePath);
    response.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const { pathname } = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const hostname = (request.headers.host || '').replace(/:\d+$/, '');
    if (pathname.startsWith('/api/') && !['localhost', '127.0.0.1', '[::1]'].includes(hostname)) return sendJson(response, 403, { error: 'The trail API only accepts local requests.' });
    if (pathname === '/api/dev') return sendJson(response, 200, { writable: true });
    // No online board here. An empty answer, rather than a 404, keeps the console
    // clean; the client can't parse it, so it quietly uses the local board.
    if (pathname === '/api/leaderboard') { response.writeHead(204, { 'Cache-Control': 'no-store' }); return response.end(); }
    if (pathname.startsWith('/api/trails/')) return await handleTrailRequest(request, response, pathname.slice('/api/trails/'.length));
    if (pathname === '/api/reference-runs') return await handleReferenceRun(request, response);
    if (request.method !== 'GET' && request.method !== 'HEAD') return sendJson(response, 405, { error: 'Method not allowed.' });
    await serveStatic(request, response, pathname);
  } catch (error) {
    console.error(error);
    if (!response.headersSent) sendJson(response, 500, { error: error.message });
    else response.end();
  }
});

server.listen(port, host, () => {
  console.log(`Hjulben dev server running at http://${host}:${port}`);
  console.log('Editor saves write directly to trails/official, trails/bonus and trails/custom. Refresh the browser manually after code changes.');
});
