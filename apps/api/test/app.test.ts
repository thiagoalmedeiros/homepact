import { HealthStatus } from '@homepact/shared';
import type { Db } from 'mongodb';
import { pino } from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { tenantRepo } from '../src/data/tenant-repo.js';
import { createTenantResolver } from '../src/tenant/resolve-tenant.js';
import { COMPANY_TENANT, mockContext, mockRepo, serveApp, type Harness } from './support/mocks.js';

const { stub } = await vi.hoisted(async () => {
  const { Router } = await import('express');
  return {
    stub: (name: string) => () => {
      const r = Router();
      r.get('/', (req, res) => {
        res.json({ module: name, tenant: req.tenant, repoCompany: req.repo.companyId });
      });
      r.get('/boom', () => {
        throw new Error('internal detail');
      });
      return r;
    },
  };
});

vi.mock('../src/data/tenant-repo.js', () => ({ tenantRepo: vi.fn() }));
vi.mock('../src/tenant/resolve-tenant.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/tenant/resolve-tenant.js')>()),
  createTenantResolver: vi.fn(),
}));
vi.mock('../src/modules/access-keys/routes.js', () => ({
  accessRoutes: stub('access'),
  adminAccessKeyRoutes: stub('admin-access-keys'),
}));
vi.mock('../src/modules/agreement-templates/routes.js', () => ({
  agreementTemplateRoutes: stub('agreement-templates'),
}));
vi.mock('../src/modules/agreements/routes.js', () => ({ agreementRoutes: stub('agreements') }));
vi.mock('../src/modules/auth/routes.js', () => ({ authRoutes: stub('auth') }));
vi.mock('../src/modules/catalog/routes.js', () => ({ catalogRoutes: stub('catalog') }));
vi.mock('../src/modules/companies/routes.js', () => ({ companyRoutes: stub('companies') }));
vi.mock('../src/modules/houses/routes.js', () => ({ adminHouseRoutes: stub('houses') }));
vi.mock('../src/modules/inventory/routes.js', () => ({ inventoryRoutes: stub('inventory') }));
vi.mock('../src/modules/proposals/routes.js', () => ({ proposalRoutes: stub('proposals') }));
vi.mock('../src/modules/market-rates/routes.js', () => ({
  marketRateRoutes: stub('market-rates'),
}));
vi.mock('../src/modules/referrals/routes.js', () => ({
  referralProgramRoutes: stub('referral-programs'),
}));
vi.mock('../src/modules/sales-tax/routes.js', () => ({ taxRateRoutes: stub('tax-rates') }));
vi.mock('../src/modules/tax-presets/routes.js', () => ({
  platformTaxPresetRoutes: stub('platform-tax-presets'),
  taxPresetRoutes: stub('tax-presets'),
}));
vi.mock('../src/modules/users/routes.js', () => ({ userRoutes: stub('users') }));
vi.mock('../src/routes/tenant.js', () => ({ tenantRouter: stub('tenant') }));

const ORIGIN = 'http://a.test';
let h: Harness;
const { resolver } = mockContext();
const pingDatabase = vi.fn();

beforeEach(async () => {
  resolver.resolve.mockImplementation(async (o) => (o === ORIGIN ? COMPANY_TENANT : null));
  vi.mocked(createTenantResolver).mockReturnValue(resolver);
  vi.mocked(tenantRepo).mockImplementation((_db, companyId) => mockRepo(companyId));
  pingDatabase.mockResolvedValue(undefined);
  const app = createApp({
    db: {} as Db,
    logger: pino({ level: 'silent' }),
    pingDatabase,
    platformAdminOrigin: 'http://admin.test',
    jwtSecret: 'test-secret',
  });
  h = await serveApp(app);
});
afterEach(() => h.close());

describe('createApp', () => {
  it('serves health without an Origin', async () => {
    expect(await h.call('GET', '/api/health')).toMatchObject({
      status: 200,
      body: { status: HealthStatus.Ok },
    });
    expect(resolver.resolve).not.toHaveBeenCalled();
  });

  it('refuses API requests from a missing or unknown Origin with 403', async () => {
    expect((await h.call('GET', '/api/')).status).toBe(403);
    expect(await h.call('GET', '/api/', undefined, { origin: 'http://evil.test' })).toMatchObject({
      status: 403,
      body: { error: 'Unknown origin' },
    });
  });

  it('gives every module the Origin tenant and a repo bound to its company', async () => {
    for (const [path, module] of [
      ['/api/tenant', 'tenant'],
      ['/api/auth', 'auth'],
      ['/api/platform/companies', 'companies'],
      ['/api/users', 'users'],
      ['/api/catalog', 'catalog'],
      ['/api/admin/houses', 'houses'],
      ['/api/inventory', 'inventory'],
      ['/api/access', 'access'],
      ['/api/admin/access-keys', 'admin-access-keys'],
      ['/api/proposals', 'proposals'],
      ['/api/agreement-templates', 'agreement-templates'],
      ['/api/agreements', 'agreements'],
      ['/api/platform/tax-presets', 'platform-tax-presets'],
      ['/api/tax-presets', 'tax-presets'],
      ['/api/tax-rates', 'tax-rates'],
      ['/api/referral-programs', 'referral-programs'],
      ['/api/market-rates', 'market-rates'],
    ] as const) {
      const res = await h.call('GET', path, undefined, { origin: ORIGIN });
      expect(res.body, path).toEqual({ module, tenant: COMPANY_TENANT, repoCompany: 'company-a' });
    }
    expect(tenantRepo).toHaveBeenCalledWith(expect.anything(), 'company-a');
  });

  it('describes itself at /api and sends security headers', async () => {
    const res = await h.call('GET', '/api/', undefined, { origin: ORIGIN });
    expect(res.body).toEqual({ name: 'homepact-api', version: '0.1.0' });
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-powered-by')).toBeNull();
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
  });

  it('answers unknown routes with 404 and hides internal errors', async () => {
    expect(await h.call('GET', '/nope')).toMatchObject({
      status: 404,
      body: { error: 'Not found' },
    });
    expect(await h.call('GET', '/api/catalog/boom', undefined, { origin: ORIGIN })).toMatchObject({
      status: 500,
      body: { error: 'Internal server error' },
    });
  });
});
