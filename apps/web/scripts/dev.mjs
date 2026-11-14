import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { createRequire } from 'node:module';
import { connect } from 'node:net';
import { SITE_PORTS, serveOnSitePorts } from './site-ports.mjs';

/** The Angular dev server, with live reload, on every site port. `ng serve` listens on a single
 * address and port, so it runs on an internal port and this proxies the company and
 * platform-admin ports to it (the live-reload socket too), keeping each request's Host. */

const HOST = '127.0.0.1';
const PORT = Number(process.env.NG_SERVE_PORT ?? SITE_PORTS[0] + 1);
const ng = createRequire(import.meta.url).resolve('@angular/cli/bin/ng.js');

const server = spawn(
  process.execPath,
  [ng, 'serve', '--host', HOST, '--port', String(PORT), ...process.argv.slice(2)],
  { cwd: new URL('..', import.meta.url), stdio: 'inherit' },
);
server.on('exit', (code) => process.exit(code ?? 1));

const forward = (req, res) => {
  const upstream = request(
    { host: HOST, port: PORT, method: req.method, path: req.url, headers: req.headers },
    (reply) => {
      res.writeHead(reply.statusCode ?? 502, reply.headers);
      reply.pipe(res);
    },
  );
  upstream.on('error', () => res.writeHead(502).end('The Angular dev server is still starting.'));
  req.pipe(upstream);
};

const forwardUpgrade = (req, socket, head) => {
  const upstream = connect(PORT, HOST, () => {
    const headers = Object.entries(req.headers).map(([k, v]) => `${k}: ${v}\r\n`);
    upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${headers.join('')}\r\n`);
    upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
};

await serveOnSitePorts(forward, {
  onUpgrade: forwardUpgrade,
  onClose: () => server.kill('SIGTERM'),
});
