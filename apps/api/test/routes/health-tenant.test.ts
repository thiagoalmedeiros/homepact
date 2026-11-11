import { HealthStatus, ServiceState } from '@homepact/shared';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findCompany } from '../../src/data/platform-repo.js';
import { healthRouter } from '../../src/routes/health.js';
import { tenantRouter } from '../../src/routes/tenant.js';
import {
  COMPANY_ID,
  COMPANY_TENANT,
  PLATFORM_TENANT,
  mockContext,
  mockRepo,
  serveApp,
  serveRouter,
  type Harness,
} from '../support/mocks.js';

vi.mock('../../src/data/platform-repo.js', () => ({ findCompany: vi.fn() }));

let h: Harness;
afterEach(() => h.close());

describe('GET /api/health', () => {
  const serve = async (pingDatabase: () => Promise<void>) => {
    const app = express();
    app.use(healthRouter({ pingDatabase }));
    h = await serveApp(app);
  };

  it('is ok when the database answers', async () => {
    await serve(vi.fn().mockResolvedValue(undefined));
    expect(await h.call('GET', '/')).toMatchObject({
      status: 200,
      body: { status: HealthStatus.Ok, database: ServiceState.Up },
    });
  });

  it('is degraded (503) when the database is unreachable', async () => {
    await serve(vi.fn().mockRejectedValue(new Error('down')));
    expect(await h.call('GET', '/')).toMatchObject({
      status: 503,
      body: { status: HealthStatus.Degraded, database: ServiceState.Down },
    });
  });
});

describe('GET /api/tenant', () => {
  const { db } = mockContext();

  it('names the platform on the admin origin', async () => {
    h = await serveRouter(tenantRouter(db), { tenant: PLATFORM_TENANT, repo: mockRepo(null) });
    expect((await h.call('GET', '/')).body).toEqual({
      kind: 'platform',
      name: 'Homepact Platform',
    });
    expect(findCompany).not.toHaveBeenCalled();
  });

  it("returns only the public branding of the Origin's company", async () => {
    vi.mocked(findCompany).mockResolvedValue({
      _id: COMPANY_ID,
      name: 'Alpha Homes',
      slug: 'alpha',
      logoUrl: 'https://img.test/logo.png',
      currency: 'CAD',
      origins: ['http://a.test'],
      active: true,
      tagline: 'Built right',
      heroImageUrl: 'https://img.test/hero.jpg',
      contact: { phone: '555' },
      createdAt: 'x',
      updatedAt: 'x',
    });
    h = await serveRouter(tenantRouter(db), { tenant: COMPANY_TENANT, repo: mockRepo() });
    expect((await h.call('GET', '/')).body).toEqual({
      kind: 'company',
      name: 'Alpha Homes',
      logoUrl: 'https://img.test/logo.png',
      currency: 'CAD',
      tagline: 'Built right',
      heroImageUrl: 'https://img.test/hero.jpg',
      contact: { phone: '555' },
    });
    expect(findCompany).toHaveBeenCalledWith(db, COMPANY_ID);
  });

  it('leaves optional branding out and is a 404 for a vanished company', async () => {
    vi.mocked(findCompany).mockResolvedValueOnce({
      name: 'Alpha Homes',
      logoUrl: 'l',
      currency: 'USD',
    } as never);
    h = await serveRouter(tenantRouter(db), { tenant: COMPANY_TENANT, repo: mockRepo() });
    expect((await h.call('GET', '/')).body).toEqual({
      kind: 'company',
      name: 'Alpha Homes',
      logoUrl: 'l',
      currency: 'USD',
    });
    vi.mocked(findCompany).mockResolvedValueOnce(null);
    expect((await h.call('GET', '/')).status).toBe(404);
  });
});
