import { createServer } from 'node:http';

/** The ports the sites are opened on, as in production: one build answers on the company port
 * (localhost and 127.0.0.1 are two companies) and on the platform-admin port. */
export const SITE_PORTS = [process.env.WEB_PORT ?? '4200', process.env.ADMIN_PORT ?? '4300'].map(
  Number,
);

const listen = (port, host, handler, onUpgrade) =>
  new Promise((ok, fail) => {
    const server = createServer(handler);
    if (onUpgrade) server.on('upgrade', onUpgrade);
    server.once('error', fail);
    server.listen(port, host, () => ok(server));
  });

/** Serves `handler` on every site port, on loopback only, and closes on SIGINT/SIGTERM. */
export const serveOnSitePorts = async (handler, { onUpgrade, onClose } = {}) => {
  const servers = [];
  for (const port of SITE_PORTS) {
    servers.push(await listen(port, '127.0.0.1', handler, onUpgrade));
    // localhost may resolve to ::1 first; skip it where IPv6 is off.
    servers.push(await listen(port, '::1', handler, onUpgrade).catch(() => null));
    console.log(`Web  http://localhost:${port}`);
  }
  const stop = () => {
    for (const s of servers) s?.close();
    onClose?.();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
};
