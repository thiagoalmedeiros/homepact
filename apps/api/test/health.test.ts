import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

let server: Server | undefined;

async function start(pingDatabase: () => Promise<boolean>) {
  const app = createApp({ pingDatabase, version: '9.9.9' });
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

describe('GET /api/health', () => {
  it('returns 200 and ok when the database answers', async () => {
    const base = await start(async () => true);
    const res = await fetch(`${base}/api/health`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ status: 'ok', database: 'up', version: '9.9.9' });
    expect(body.uptimeSeconds).toBeTypeOf('number');
  });

  it('returns 503 and degraded when the database is down', async () => {
    const base = await start(async () => false);
    const res = await fetch(`${base}/api/health`);

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: 'degraded', database: 'down' });
  });

  it('treats a failing ping as down instead of crashing', async () => {
    const base = await start(() => Promise.reject(new Error('boom')));
    const res = await fetch(`${base}/api/health`);

    expect(res.status).toBe(503);
  });
});

describe('unknown routes', () => {
  it('return a JSON 404', async () => {
    const base = await start(async () => true);
    const res = await fetch(`${base}/api/nope`);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });
});
