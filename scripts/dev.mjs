import { spawn } from 'node:child_process';
import './watch-levels.mjs';

const server = spawn('npx', ['live-server'], { stdio: 'inherit', shell: process.platform === 'win32' });
server.on('exit', code => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.kill(signal));
}
