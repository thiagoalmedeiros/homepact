import express from 'express';
import type { Db } from 'mongodb';
import type { NextFunction, Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { companiesCollection } from '../../src/data/platform-repo.js';
import { tenantCors } from '../../src/tenant/cors.js';
import { createTenantResolver, resolveTenant } from '../../src/tenant/resolve-tenant.js';
import { COMPANY_TENANT, mockContext, serveApp, type Harness } from '../support/mocks.js';

vi.mock('../../src/data/platform-repo.js', () => ({ companiesCollection: vi.fn() }));

const ADMIN_ORIGIN = 'http://admin.test';
const db = {} as Db;
const findOne = vi.fn();

beforeEach(() => {
  vi.mocked(companiesCollection).mockReturnValue({ findOne } as never);
});

describe('createTenantResolver', () => {
  it('resolves the platform admin origin without a lookup', async () => {
    const resolver = createTenantResolver(db, ADMIN_ORIGIN);
    expect(await resolver.resolve('http://ADMIN.test/')).toEqual({
      kind: 'platform',
      companyId: null,
      origin: ADMIN_ORIGIN,
    });
    expect(findOne).not.toHaveBeenCalled();
  });

  it('resolves an active company by its normalized origin', async () => {
    findOne.mockResolvedValue({ _id: 'co-1' });
    const resolver = createTenantResolver(db, ADMIN_ORIGIN);
    expect(await resolver.resolve('http://A.test')).toEqual({
      kind: 'company',
      companyId: 'co-1',
      origin: 'http://a.test',
    });
    expect(companiesCollection).toHaveBeenCalledWith(db);
    expect(findOne).toHaveBeenCalledWith(
      { origins: 'http://a.test', active: true },
      { projection: { _id: 1 } },
    );
  });

  it('returns null for missing, malformed and unknown origins', async () => {
    findOne.mockResolvedValue(null);
    const resolver = createTenantResolver(db, ADMIN_ORIGIN);
    expect(await resolver.resolve(undefined)).toBeNull();
    expect(await resolver.resolve('not an origin')).toBeNull();
    expect(await resolver.resolve('http://unknown.test')).toBeNull();
  });

  it('caches hits for the TTL, never caches misses, and can be invalidated', async () => {
    vi.useFakeTimers({ now: 0 });
    try {
      findOne.mockResolvedValue({ _id: 'co-1' });
      const resolver = createTenantResolver(db, ADMIN_ORIGIN, 1_000);
      await resolver.resolve('http://a.test');
      await resolver.resolve('http://a.test');
      expect(findOne).toHaveBeenCalledTimes(1);

      vi.setSystemTime(1_001);
      await resolver.resolve('http://a.test');
      expect(findOne).toHaveBeenCalledTimes(2);

      resolver.invalidate();
      await resolver.resolve('http://a.test');
      expect(findOne).toHaveBeenCalledTimes(3);

      findOne.mockResolvedValue(null);
      await resolver.resolve('http://miss.test');
      await resolver.resolve('http://miss.test');
      expect(findOne).toHaveBeenCalledTimes(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it('bounds the cache: it is cleared once it holds 1000 origins', async () => {
    findOne.mockImplementation(async (q: { origins: string }) => ({ _id: q.origins }));
    const resolver = createTenantResolver(db, ADMIN_ORIGIN);
    for (let i = 0; i < 1_000; i++) await resolver.resolve(`http://c${i}.test`);
    await resolver.resolve('http://c0.test'); // still cached
    expect(findOne).toHaveBeenCalledTimes(1_000);
    await resolver.resolve('http://c1000.test'); // 1001st origin clears the cache
    await resolver.resolve('http://c0.test');
    expect(findOne).toHaveBeenCalledTimes(1_002);
  });
});

describe('resolveTenant middleware', () => {
  it('attaches the tenant of the Origin header', async () => {
    const { resolver } = mockContext();
    resolver.resolve.mockResolvedValue(COMPANY_TENANT);
    const req = { headers: { origin: 'http://a.test' } } as unknown as Request;
    const next = vi.fn() as NextFunction;
    await resolveTenant(resolver)(req, {} as Response, next);
    expect(resolver.resolve).toHaveBeenCalledWith('http://a.test');
    expect(req.tenant).toEqual(COMPANY_TENANT);
    expect(next).toHaveBeenCalled();
  });

  it('refuses unknown or missing origins with 403', async () => {
    const { resolver } = mockContext();
    const req = { headers: {} } as unknown as Request;
    const next = vi.fn() as NextFunction;
    await expect(resolveTenant(resolver)(req, {} as Response, next)).rejects.toMatchObject({
      status: 403,
      message: 'Unknown origin',
    });
    expect(next).not.toHaveBeenCalled();
  });
});

describe('tenantCors', () => {
  let h: Harness;
  const { resolver } = mockContext();

  beforeEach(async () => {
    resolver.resolve.mockImplementation(async (origin) =>
      origin === 'http://a.test' ? COMPANY_TENANT : null,
    );
    const app = express();
    app.use(tenantCors(resolver));
    app.get('/', (_req, res) => {
      res.json({ ok: true });
    });
    app.use(
      (err: Error, _req: Request, res: Response, _next: NextFunction) =>
        void res.status(500).json({ error: err.message }),
    );
    h = await serveApp(app);
  });
  afterEach(() => h.close());

  it('allows registered origins', async () => {
    const res = await h.call('GET', '/', undefined, { origin: 'http://a.test' });
    expect(res.headers.get('access-control-allow-origin')).toBe('http://a.test');
  });

  it('does not allow unknown origins', async () => {
    const res = await h.call('GET', '/', undefined, { origin: 'http://evil.test' });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('answers preflights with the allowed methods and headers', async () => {
    const res = await h.call('OPTIONS', '/', undefined, {
      origin: 'http://a.test',
      'access-control-request-method': 'PATCH',
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-methods')).toBe('GET,POST,PUT,PATCH,DELETE');
    expect(res.headers.get('access-control-allow-headers')).toBe('Content-Type,Authorization');
    expect(res.headers.get('access-control-max-age')).toBe('600');
  });

  it('passes resolver failures to the error handler', async () => {
    resolver.resolve.mockRejectedValue(new Error('db down'));
    const res = await h.call('GET', '/', undefined, { origin: 'http://a.test' });
    expect(res).toMatchObject({ status: 500, body: { error: 'db down' } });
  });
});
