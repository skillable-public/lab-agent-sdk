// serve.mjs: serves src/wwwroot for local development, with no dependencies.
//
//   node src/serve.mjs                                    http on ports 7080 and 7081
//   node src/serve.mjs --pfx certs/lab-agent-sdk.pfx      https, password "changeit"
//   node src/serve.mjs --pfx <file> --passphrase <pw>
//
// Port 7080 serves the lab simulator, and port 7081 the same files for the
// sample agent, so the simulator and the agent are cross-origin, as a real
// lab and a real agent are. The agent port only lets the simulator's origin
// frame its pages.

import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), 'wwwroot');
const SIMULATOR_PORT = 7080;
const AGENT_PORT = 7081;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

function option(name) {
  const at = process.argv.indexOf(name);
  return at === -1 ? null : process.argv[at + 1] ?? null;
}

const pfxPath = option('--pfx');
const tls = pfxPath ? { pfx: readFileSync(pfxPath), passphrase: option('--passphrase') ?? 'changeit' } : null;
const scheme = tls ? 'https' : 'http';
const simulatorOrigins = [`${scheme}://localhost:${SIMULATOR_PORT}`, `${scheme}://127.0.0.1:${SIMULATOR_PORT}`];

async function handle(port, request, response) {
  const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  let file = normalize(join(ROOT, path));
  if (file !== ROOT && !file.startsWith(ROOT + sep)) {
    response.writeHead(403).end();
    return;
  }
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    const headers = { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' };
    if (port === AGENT_PORT) headers['Content-Security-Policy'] = `frame-ancestors ${simulatorOrigins.join(' ')}`;
    response.writeHead(200, headers).end(body);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}

for (const port of [SIMULATOR_PORT, AGENT_PORT]) {
  const listener = (request, response) => handle(port, request, response);
  const server = tls ? createHttpsServer(tls, listener) : createHttpServer(listener);
  server.listen(port, () => console.log(`${port === SIMULATOR_PORT ? 'Lab simulator' : 'Sample agent'}: ${scheme}://localhost:${port}/${port === SIMULATOR_PORT ? 'lab-simulator/' : 'sample-agent/'}`));
}
