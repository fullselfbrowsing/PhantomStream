// examples/serve.js -- dependency-free static server for the loopback demo.
//
// Design source: 02-RESEARCH.md Pattern 7, plus the plan 02-05 security
// deltas. Serves the REPO ROOT (not just examples/) so the demo page's
// native ESM imports (../src/renderer/index.js, ../src/capture/index.js)
// resolve over http. Module scripts are subject to strict MIME checking,
// so .js/.mjs MUST be served as text/javascript (Pitfall 6).
//
// Security posture (dev demo; threat register T-02-16 / T-02-17):
//   - binds 127.0.0.1 only -- never reachable from the network
//   - the raw request path is decoded (decodeURIComponent) BEFORE resolving,
//     so percent-encoded dot-dot cannot bypass the ROOT-prefix guard;
//     malformed encodings get 400
//   - the raw path is used as-is, deliberately NOT parsed through WHATWG
//     `new URL(...)`: URL parsing normalizes "/../x" to "/x", which would
//     silently rewrite above-root traversal probes into in-root 200s
//     instead of rejecting them
//   - the resolved path must stay under ROOT (403 otherwise); directory
//     requests resolve only to an explicit index.html (404 otherwise --
//     no directory listings)

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Repo root: one level up from examples/. fileURLToPath (not URL.pathname)
// so percent-encoded filesystem paths decode correctly on every platform.
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const HOST = '127.0.0.1'; // localhost only (T-02-17)
const PORT = 8642;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', // required for ESM module scripts
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json'
};

const server = createServer(async (req, res) => {
  // Strip the query string, then decode BEFORE resolving (T-02-16): a
  // malformed encoding is a client error, and decoding after the prefix
  // check would let %2e%2e sneak past it.
  let pathname;
  try {
    pathname = decodeURIComponent(req.url.split('?')[0]);
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('bad request');
    return;
  }

  let filePath = resolve(ROOT, '.' + pathname);
  if (filePath !== ROOT && !filePath.startsWith(ROOT + sep)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('forbidden');
    return;
  }

  try {
    let stats = await stat(filePath);
    if (stats.isDirectory()) {
      // Directories resolve only to an explicit index.html -- no listings.
      filePath = resolve(filePath, 'index.html');
      stats = await stat(filePath);
    }
    res.writeHead(200, {
      'content-type': MIME[extname(filePath)] || 'application/octet-stream'
    });
    createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`loopback demo: http://localhost:${PORT}/examples/loopback-mirror.html`);
});
