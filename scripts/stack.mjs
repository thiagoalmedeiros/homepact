import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { connect } from 'node:net';
import { join } from 'node:path';

/** The whole app with no Docker and no MongoDB to install: the API on its own MongoDB seeded with
 * the showcase (apps/api `start:memory`, or `dev` with --dev), and the web app on the company and
 * platform-admin ports. Ctrl+C stops it all.
 *
 *   (default)   build the web app and serve the build, as in production (apps/web `preview`)
 *   --dev       API and web restart/reload on change (apps/api `dev`, apps/web `dev`)
 *   --no-build  reuse the last web build
 *
 * The data is in memory and gone on exit unless MONGO_DATA_DIR names a folder to keep it in. */

const dev = process.argv.includes('--dev');
const build = !dev && !process.argv.includes('--no-build');

const repo = join(import.meta.dirname, '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const apiPort = Number(process.env.API_PORT ?? 3000);
const webPorts = [Number(process.env.WEB_PORT ?? 4200), Number(process.env.ADMIN_PORT ?? 4300)];
const env = {
  ...process.env,
  API_PORT: String(apiPort),
  API_PUBLIC_URL: process.env.API_PUBLIC_URL ?? `http://localhost:${apiPort}`,
};
/** First run downloads mongod (~80 MB), so the API gets a while to come up. */
const STARTUP_TIMEOUT_MS = 5 * 60_000;

const portInUse = (port) =>
  new Promise((ok) => {
    const socket = connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.end();
      ok(true);
    });
    socket.once('error', () => ok(false));
  });

const isUp = (url) =>
  fetch(url).then(
    (r) => r.ok,
    () => false,
  );

const waitFor = async (url, child) => {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline && child.exitCode === null) {
    if (await isUp(url)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} did not come up`);
};

const children = [];
let stopping = false;
const stop = async (code) => {
  if (stopping) return;
  stopping = true;
  const running = children.filter((c) => c.exitCode === null && c.signalCode === null);
  for (const c of running) c.kill('SIGTERM');
  await Promise.all(running.map((c) => once(c, 'exit')));
  process.exit(code);
};
const start = (workspace, script) => {
  const child = spawn(npm, ['run', script, '-w', workspace], { cwd: repo, env, stdio: 'inherit' });
  children.push(child);
  child.on('exit', (code) => void stop(code || 1));
  return child;
};
process.on('SIGINT', () => void stop(0));
process.on('SIGTERM', () => void stop(0));

for (const port of [apiPort, ...webPorts]) {
  if (await portInUse(port)) {
    console.error(
      `Port ${port} is in use: stop whatever runs there (or set API_PORT/WEB_PORT/ADMIN_PORT).`,
    );
    process.exit(1);
  }
}

if (build) {
  const { status } = spawnSync(npm, ['run', 'build', '-w', '@homepact/web'], {
    cwd: repo,
    env,
    stdio: 'inherit',
  });
  if (status !== 0) process.exit(status ?? 1);
}

try {
  const api = start('@homepact/api', dev ? 'dev' : 'start:memory');
  await waitFor(`http://localhost:${apiPort}/api/health`, api);
  const web = start('@homepact/web', dev ? 'dev' : 'preview');
  await waitFor(`http://localhost:${webPorts[0]}/`, web);
} catch (err) {
  console.error(err.message);
  await stop(1);
}

console.log(
  `\nUp: http://localhost:${webPorts[0]} (Example Homes), http://127.0.0.1:${webPorts[0]} ` +
    `(Northwind), http://localhost:${webPorts[1]} (platform). Ctrl+C to stop.`,
);
