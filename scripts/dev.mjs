import http from 'node:http';
import { readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateLevelCatalog } from './generate-level-catalog.mjs';
import './watch-levels.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const levelsRoot = path.join(projectRoot, 'levels');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT) || 8080;
const LEVEL_FILE = /^(official|custom)\/([a-z0-9][a-z0-9_-]*)\.json$/i;
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
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
    if (size > 2_000_000) throw new Error('Level file is too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function handleLevelRequest(request, response, file) {
  const match = LEVEL_FILE.exec(file);
  if (!match) return sendJson(response, 400, { error: 'Level files must be official/<name>.json or custom/<name>.json using letters, numbers, - and _.' });
  const [, source, name] = match;
  const target = path.join(levelsRoot, source, `${name}.json`);
  const entry = { id: `${source}:${name}`, source, file: `${source}/${name}.json` };

  if (request.method === 'PUT') {
    let level;
    try { level = JSON.parse(await readBody(request)); } catch (error) { return sendJson(response, 400, { error: `Invalid level JSON: ${error.message}` }); }
    if (!level || typeof level.name !== 'string' || !level.name.trim()) return sendJson(response, 400, { error: 'The level needs a name.' });
    await writeFile(target, `${JSON.stringify(level, null, 2)}\n`);
    await generateLevelCatalog();
    console.log(`Saved levels/${entry.file}`);
    return sendJson(response, 200, { entry: { ...entry, name: level.name } });
  }
  if (request.method === 'DELETE') {
    if (source !== 'custom') return sendJson(response, 403, { error: 'Official trails cannot be deleted from the editor.' });
    await unlink(target).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await generateLevelCatalog();
    console.log(`Deleted levels/${entry.file}`);
    return sendJson(response, 200, { entry });
  }
  return sendJson(response, 405, { error: 'Use PUT to save or DELETE to remove a level.' });
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
    if (pathname.startsWith('/api/') && !['localhost', '127.0.0.1', '[::1]'].includes(hostname)) return sendJson(response, 403, { error: 'The level API only accepts local requests.' });
    if (pathname === '/api/dev') return sendJson(response, 200, { writable: true });
    if (pathname.startsWith('/api/levels/')) return await handleLevelRequest(request, response, pathname.slice('/api/levels/'.length));
    if (request.method !== 'GET' && request.method !== 'HEAD') return sendJson(response, 405, { error: 'Method not allowed.' });
    await serveStatic(request, response, pathname);
  } catch (error) {
    console.error(error);
    if (!response.headersSent) sendJson(response, 500, { error: error.message });
    else response.end();
  }
});

server.listen(port, host, () => {
  console.log(`Pocket Trials dev server running at http://${host}:${port}`);
  console.log('Editor saves write directly to levels/official and levels/custom. Refresh the browser manually after code changes.');
});
