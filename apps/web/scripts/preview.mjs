import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { serveOnSitePorts } from './site-ports.mjs';

/** Serves the production build the way the nginx container does (infra/nginx), with no Docker:
 * `/config.json` points at API_PUBLIC_URL and any path that is not a file falls back to
 * index.html. */

const root = resolve(import.meta.dirname, '../dist/web/browser');
const config = JSON.stringify({
  apiBaseUrl: process.env.API_PUBLIC_URL ?? 'http://localhost:3000',
});
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

if (!existsSync(join(root, 'index.html'))) {
  console.error(`No build at ${root}: run "npm run build" in apps/web first.`);
  process.exit(1);
}

const handler = (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  if (pathname === '/config.json') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(config);
    return;
  }
  const path = resolve(root, `.${pathname}`);
  const inside = path === root || path.startsWith(root + sep);
  const file = inside && existsSync(path) && statSync(path).isFile() ? path : null;
  // A missing asset is a 404; any other path is an app route.
  if (!file && extname(pathname) !== '') {
    res.writeHead(404).end();
    return;
  }
  const served = file ?? join(root, 'index.html');
  res.writeHead(200, {
    'Content-Type': TYPES[extname(served)] ?? 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  createReadStream(served).pipe(res);
};

await serveOnSitePorts(handler);
